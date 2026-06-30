import "server-only";
import { pgQuery } from "@/lib/postgres";
import { aduananetBrowserLogin } from "@/lib/aduananet-browser";
import { aduananetLogin } from "@/lib/aduananet";
import { parseRemesaTabla } from "@/lib/remesas/parse";
import { crearIngresoRemesa } from "@/lib/aduananet-ingreso";

export const REMESAS_INBOUND_ADDR = "remesas@agatrack.agenciaguerra.com";
const REMITENTES_PERMITIDOS = ["@agenciaguerra.com"];
const LIVE = process.env.REMESAS_LIVE === "true"; // si no, dry-run (no graba)

async function ensureTable() {
  await pgQuery(`CREATE TABLE IF NOT EXISTS remesas_ingresos (
    id SERIAL PRIMARY KEY,
    email_id VARCHAR(80) UNIQUE,
    "from" VARCHAR(200) DEFAULT '',
    subject VARCHAR(300) DEFAULT '',
    total NUMERIC DEFAULT 0,
    num_lineas INTEGER DEFAULT 0,
    lineas JSONB,
    estado VARCHAR(20) DEFAULT 'pendiente',
    comprobante_url TEXT DEFAULT '',
    error TEXT DEFAULT '',
    dry_run BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

async function getEmailHtml(data: Record<string, unknown>, emailId: string): Promise<string> {
  if (typeof data.html === "string" && data.html) return data.html;
  if (typeof data.text === "string" && data.text) return data.text;
  if (typeof data.body === "string" && data.body) return data.body;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (res.ok) {
      const j = await res.json();
      return String(j.html || j.text || j.data?.html || j.data?.text || "");
    }
  } catch {}
  return "";
}

async function responderRemitente(
  from: string,
  subjectOrig: string,
  parsed: { lineas: { despacho: string; monto: number }[]; total: number },
  result: { comprobanteNro?: string; pdfUrl?: string }
) {
  try {
    let pdfBuffer: Buffer | null = null;
    if (result.pdfUrl) {
      try {
        const cookies = await aduananetLogin();
        const res = await fetch(result.pdfUrl, { headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0 (AgaTrack)" } });
        if (res.ok && /pdf/i.test(res.headers.get("content-type") || "")) pdfBuffer = Buffer.from(await res.arrayBuffer());
      } catch (e) { console.error("[remesas] no se pudo bajar PDF:", e instanceof Error ? e.message : e); }
    }
    const filasHtml = parsed.lineas.map(l => `<tr><td style="padding:4px 10px;border:1px solid #ddd;">${l.despacho}</td><td style="padding:4px 10px;border:1px solid #ddd;text-align:right;">${l.monto.toLocaleString("es-CL")}</td></tr>`).join("");
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
      to: [from],
      subject: `Comprobante de Ingreso de Remesa generado${result.comprobanteNro ? " N° " + result.comprobanteNro : ""}${subjectOrig ? " — " + subjectOrig : ""}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
        <p>Estimados,</p>
        <p>Se generó el comprobante de <b>Ingreso de Remesa</b> en AduanaNet${result.comprobanteNro ? ` (N° <b>${result.comprobanteNro}</b>)` : ""}.</p>
        <table style="border-collapse:collapse;border:1px solid #ddd;margin:12px 0;">
          <thead><tr style="background:#f5f5f5;"><th style="padding:6px 10px;border:1px solid #ddd;">N° Despacho</th><th style="padding:6px 10px;border:1px solid #ddd;">Monto</th></tr></thead>
          <tbody>${filasHtml}</tbody>
          <tfoot><tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:bold;">TOTAL</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:bold;">${parsed.total.toLocaleString("es-CL")}</td></tr></tfoot>
        </table>
        ${pdfBuffer ? "<p>Se adjunta el comprobante en PDF.</p>" : "<p style='color:#a15c00;'>(El PDF no pudo adjuntarse automáticamente; queda disponible en AduanaNet.)</p>"}
        <p style="color:#666;font-size:12px;">Generado automáticamente por AgaTrack.</p>
      </div>`,
      attachments: pdfBuffer ? [{ filename: `comprobante_remesa${result.comprobanteNro ? "_" + result.comprobanteNro : ""}.pdf`, content: pdfBuffer }] : undefined,
    });
    console.log(`[remesas] Respuesta enviada a ${from}${pdfBuffer ? " con PDF" : " sin PDF"}`);
  } catch (err) {
    console.error("[remesas] Error respondiendo al remitente:", err instanceof Error ? err.message : err);
  }
}

/** Procesa un correo de remesas (validación, parseo, grabado en AduanaNet, respuesta). */
export async function procesarRemesa(emailId: string, from: string, subject: string, data: Record<string, unknown>) {
  const fromLower = String(from).toLowerCase();
  if (!REMITENTES_PERMITIDOS.some(d => fromLower.endsWith(d))) {
    console.log(`[remesas] Remitente no autorizado: ${from}`);
    return { ok: true, message: "Remitente no autorizado" };
  }
  await ensureTable();
  const insertResult = await pgQuery<{ email_id: string }>(
    `INSERT INTO remesas_ingresos (email_id, "from", subject, estado) VALUES ($1,$2,$3,'procesando')
     ON CONFLICT (email_id) DO NOTHING RETURNING email_id`,
    [emailId, String(from), String(subject || "")]
  );
  if (insertResult.length === 0) {
    console.log(`[remesas] Email ${emailId} ya procesado/en proceso`);
    return { ok: true, message: "Ya procesado" };
  }

  const html = await getEmailHtml(data, emailId);
  const parsed = parseRemesaTabla(html);
  console.log(`[remesas] ${parsed.lineas.length} líneas, total ${parsed.total}, cuadra=${parsed.cuadra}`);
  if (parsed.lineas.length === 0) {
    await pgQuery("UPDATE remesas_ingresos SET estado='error', error=$1 WHERE email_id=$2", ["No se detectaron líneas en la tabla del correo", emailId]);
    return { ok: false, error: "Tabla sin líneas" };
  }
  if (!parsed.cuadra) console.warn(`[remesas] ⚠️ suma líneas (${parsed.sumaLineas}) != total (${parsed.total})`);

  const { browser, page } = await aduananetBrowserLogin();
  let result;
  try {
    result = await crearIngresoRemesa(page, { lineas: parsed.lineas, total: parsed.total, dryRun: !LIVE });
  } finally {
    await browser.close().catch(() => {});
  }

  await pgQuery(
    `UPDATE remesas_ingresos SET total=$1, num_lineas=$2, lineas=$3, estado=$4, comprobante_url=$5, dry_run=$6, error=$7 WHERE email_id=$8`,
    [parsed.total, parsed.lineas.length, JSON.stringify(parsed.lineas), result.ok ? (LIVE ? "creado" : "dry_run") : "error", result.comprobanteUrl || "", !LIVE, result.ok ? "" : (result.mensaje || ""), emailId]
  );

  if (LIVE && result.ok) await responderRemitente(String(from), String(subject || ""), parsed, result);

  console.log(`[remesas] ${result.ok ? "✅" : "❌"} ${result.mensaje} (live=${LIVE})`);
  return { ok: result.ok, live: LIVE, lineas: parsed.lineas.length, total: parsed.total, cuadra: parsed.cuadra, comprobante: result.comprobanteNro, mensaje: result.mensaje };
}
