import { NextResponse } from "next/server";
import { pgQuery } from "@/lib/postgres";
import { aduananetBrowserLogin } from "@/lib/aduananet-browser";
import { aduananetLogin } from "@/lib/aduananet";
import { parseRemesaTabla } from "@/lib/remesas/parse";
import { crearIngresoRemesa } from "@/lib/aduananet-ingreso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INBOUND_ADDR = "remesas@agatrack.agenciaguerra.com";
const REMITENTES_PERMITIDOS = ["@agenciaguerra.com"]; // ajustar si el remitente es externo
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

/** Obtiene el HTML del correo desde el payload o la API de Resend. */
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

/** Descarga el PDF del comprobante (autenticado) y responde al remitente con el adjunto. */
async function responderRemitente(
  from: string,
  subjectOrig: string,
  parsed: { lineas: { despacho: string; monto: number }[]; total: number },
  result: { comprobanteNro?: string; pdfUrl?: string; mensaje?: string }
) {
  try {
    let pdfBuffer: Buffer | null = null;
    if (result.pdfUrl) {
      try {
        const cookies = await aduananetLogin();
        const res = await fetch(result.pdfUrl, { headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0 (AgaTrack)" } });
        if (res.ok) {
          const ct = res.headers.get("content-type") || "";
          if (/pdf/i.test(ct)) pdfBuffer = Buffer.from(await res.arrayBuffer());
        }
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
        ${pdfBuffer ? "<p>Se adjunta el comprobante en PDF.</p>" : "<p style='color:#a15c00;'>(El PDF del comprobante no pudo adjuntarse automáticamente; queda disponible en AduanaNet.)</p>"}
        <p style="color:#666;font-size:12px;">Generado automáticamente por AgaTrack.</p>
      </div>`,
      attachments: pdfBuffer ? [{ filename: `comprobante_remesa${result.comprobanteNro ? "_" + result.comprobanteNro : ""}.pdf`, content: pdfBuffer }] : undefined,
    });
    console.log(`[remesas] Respuesta enviada a ${from}${pdfBuffer ? " con PDF" : " sin PDF"}`);
  } catch (err) {
    console.error("[remesas] Error respondiendo al remitente:", err instanceof Error ? err.message : err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.text();

    // Verificar firma webhook (svix) — igual que inbound-email
    if (process.env.RESEND_WEBHOOK_SECRET) {
      const svixId = request.headers.get("svix-id");
      const svixTimestamp = request.headers.get("svix-timestamp");
      const svixSignature = request.headers.get("svix-signature");
      if (!svixId || !svixTimestamp || !svixSignature) {
        return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
      }
      const { Webhook } = await import("svix");
      try {
        new Webhook(process.env.RESEND_WEBHOOK_SECRET).verify(body, { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": svixSignature });
      } catch {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = JSON.parse(body);
    if (payload.type !== "email.received") return NextResponse.json({ ok: true, message: "Evento ignorado" });

    const { email_id, from, to, subject } = payload.data;
    const toAddr = (Array.isArray(to) ? to[0] : to || "").toLowerCase();
    if (toAddr !== INBOUND_ADDR) return NextResponse.json({ ok: true, message: "Dirección no es de remesas" });

    const fromLower = String(from).toLowerCase();
    if (!REMITENTES_PERMITIDOS.some(d => fromLower.endsWith(d))) {
      console.log(`[remesas] Remitente no autorizado: ${from}`);
      return NextResponse.json({ ok: true, message: "Remitente no autorizado" });
    }

    await ensureTable();

    // Idempotencia por email_id
    const insertResult = await pgQuery<{ email_id: string }>(
      `INSERT INTO remesas_ingresos (email_id, "from", subject, estado) VALUES ($1,$2,$3,'procesando')
       ON CONFLICT (email_id) DO NOTHING RETURNING email_id`,
      [email_id, String(from), String(subject || "")]
    );
    if (insertResult.length === 0) {
      console.log(`[remesas] Email ${email_id} ya procesado/en proceso`);
      return NextResponse.json({ ok: true, message: "Ya procesado" });
    }

    // Parsear la tabla del cuerpo
    const html = await getEmailHtml(payload.data, email_id);
    const parsed = parseRemesaTabla(html);
    console.log(`[remesas] ${parsed.lineas.length} líneas, total ${parsed.total}, cuadra=${parsed.cuadra}`);

    if (parsed.lineas.length === 0) {
      await pgQuery("UPDATE remesas_ingresos SET estado='error', error=$1 WHERE email_id=$2", ["No se detectaron líneas en la tabla del correo", email_id]);
      return NextResponse.json({ ok: false, error: "Tabla sin líneas" });
    }
    if (!parsed.cuadra) {
      console.warn(`[remesas] ⚠️ suma líneas (${parsed.sumaLineas}) != total (${parsed.total})`);
    }

    // Crear el comprobante en AduanaNet (o dry-run según REMESAS_LIVE)
    const { browser, page } = await aduananetBrowserLogin();
    let result;
    try {
      result = await crearIngresoRemesa(page, { lineas: parsed.lineas, total: parsed.total, dryRun: !LIVE });
    } finally {
      await browser.close().catch(() => {});
    }

    await pgQuery(
      `UPDATE remesas_ingresos SET total=$1, num_lineas=$2, lineas=$3, estado=$4, comprobante_url=$5, dry_run=$6, error=$7 WHERE email_id=$8`,
      [parsed.total, parsed.lineas.length, JSON.stringify(parsed.lineas), result.ok ? (LIVE ? "creado" : "dry_run") : "error", result.comprobanteUrl || "", !LIVE, result.ok ? "" : (result.mensaje || ""), email_id]
    );

    // Responder al remitente con el PDF del comprobante (solo si grabó de verdad y OK)
    if (LIVE && result.ok) {
      await responderRemitente(String(from), String(subject || ""), parsed, result);
    }

    console.log(`[remesas] ${result.ok ? "✅" : "❌"} ${result.mensaje} (live=${LIVE})`);
    return NextResponse.json({ ok: result.ok, live: LIVE, lineas: parsed.lineas.length, total: parsed.total, cuadra: parsed.cuadra, comprobante: result.comprobanteNro, mensaje: result.mensaje });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[remesas] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
