#!/usr/bin/env node
/**
 * Cron: Verifica operaciones aprobadas consultando AduanaNet directamente.
 * Complementa al cron de despachos_replica — busca en lista de DIN terminadas.
 * 
 * Uso: node scripts/cron-verificar-aduananet.mjs
 * Cron: 0 * * * * cd /opt/agatrack2026 && /usr/bin/node scripts/cron-verificar-aduananet.mjs >> /var/log/agatrack-verificar-aduananet.log 2>&1
 * (cada hora, minuto 0)
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); if (v.startsWith("'")) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

const BASE_URL = get("ADUANANET_URL") || "https://fguerragodoy.aduananet2.cl";
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");

(async () => {
  const start = Date.now();

  // Obtener operaciones pendientes (no aprobadas)
  const { rows: pendientes } = await pool.query(
    "SELECT nro_operacion, rut_cliente, notas FROM operaciones WHERE estado NOT IN ('aprobada', 'cerrada')"
  );

  if (pendientes.length === 0) {
    await pool.end();
    return;
  }

  console.log(`[${new Date().toISOString()}] Verificando ${pendientes.length} operaciones en AduanaNet...`);

  // Login AduanaNet
  const loginRes = await fetch(BASE_URL + "/modulos/usuarios/login.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "login=" + encodeURIComponent(LOGIN) + "&clave=" + encodeURIComponent(CLAVE),
    redirect: "manual",
  });
  const cookies = loginRes.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");

  let aprobadas = 0;

  for (const op of pendientes) {
    try {
      // Buscar en lista de DIN terminadas
      const filterBody = new URLSearchParams();
      filterBody.set("accion", "F");
      filterBody.set("fil_lib_nid", op.nro_operacion);

      const res = await fetch(`${BASE_URL}/modulos/din/dus_encabezado/lista.php?term=1`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
        body: filterBody.toString(),
      });
      const html = await res.text();

      // Buscar nro_aceptacion (10 dígitos) y fecha (DD/MM/YYYY)
      const nroAceptacion = (html.match(/\b(\d{10})\b/) || [])[1] || "";
      const fechaAceptacion = (html.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || "";

      if (nroAceptacion) {
        // Actualizar estado
        const updated = await pool.query(
          `UPDATE operaciones SET estado = 'aprobada', fecha_cierre = NOW(), updated_at = NOW(),
           notas = COALESCE(notas, '') || $1
           WHERE nro_operacion = $2 AND estado != 'aprobada' RETURNING rut_cliente, notas`,
          [`\nAprobada (aduananet): ${nroAceptacion} (${fechaAceptacion})`, op.nro_operacion]
        );

        if (updated.rowCount > 0) {
          aprobadas++;
          console.log(`[${new Date().toISOString()}] ✅ ${op.nro_operacion} aprobada: ${nroAceptacion} (${fechaAceptacion})`);

          // Enviar correo notificación
          try {
            const rutCliente = updated.rows[0]?.rut_cliente || "";
            const notas = updated.rows[0]?.notas || "";
            const refMatch = notas.match(/ref:\s*([^\s|\n]+)/i);
            const referencia = refMatch ? refMatch[1] : "";

            const ejecutivos = await pool.query(
              "SELECT u.email FROM usuarios u INNER JOIN asignaciones_ejecutivo a ON u.rut = a.rut_ejecutivo WHERE a.rut_cliente = $1 AND u.email IS NOT NULL",
              [rutCliente]
            );
            const ccEmails = ejecutivos.rows.map(r => r.email).filter(Boolean);

            // Descargar DIN PDF
            let dinPdf = null;
            try {
              const dinUrl = `${BASE_URL}/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${op.nro_operacion}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`;
              const dinRes = await fetch(dinUrl, { headers: { Cookie: cookies } });
              if (dinRes.ok) {
                const buf = Buffer.from(await dinRes.arrayBuffer());
                if (buf.length > 1000) dinPdf = buf;
              }
            } catch {}

            const { Resend } = await import("resend");
            const resend = new Resend(get("RESEND_API_KEY"));
            await resend.emails.send({
              from: get("RESEND_FROM") || "AgaTrack <reportes@agatrack.com>",
              to: [
                "oscar@agenciaguerra.com",
                "pbalmaceda@agenciaguerra.com",
                "daviles@agenciaguerra.com",
                "transmision@agenciaguerra.com",
                "comercial@agenciaguerra.com",
                "fguerrab@agenciaguerra.com",
              ],
              cc: ccEmails.length > 0 ? ccEmails : undefined,
              subject: `✅ Despacho Aprobado ${op.nro_operacion} - Aceptación: ${nroAceptacion} - ${fechaAceptacion}${referencia ? " - REF: " + referencia : ""}`,
              html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>El despacho <b>${op.nro_operacion}</b> ha sido <span style="color:#16a34a;font-weight:bold;">APROBADO</span>.</p>
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;width:180px;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${op.nro_operacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Aceptación</td><td style="padding:8px 12px;border:1px solid #ddd;">${nroAceptacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Fecha Aceptación</td><td style="padding:8px 12px;border:1px solid #ddd;">${fechaAceptacion}</td></tr>
    ${referencia ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>` : ""}
  </table>
  <p style="color:#666;font-size:12px;margin-top:20px;">Detectado via AduanaNet. Notificación automática de AgaTrack.</p>
</div>`,
              attachments: dinPdf ? [{ filename: `DIN_Aprobada_${op.nro_operacion}.pdf`, content: dinPdf }] : [],
            });
            console.log(`[${new Date().toISOString()}] Email aprobación enviado para ${op.nro_operacion}`);
          } catch (emailErr) {
            console.error(`[${new Date().toISOString()}] Error email:`, emailErr.message || emailErr);
          }
        }
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error verificando ${op.nro_operacion}:`, err.message || err);
    }
  }

  if (aprobadas > 0) {
    console.log(`[${new Date().toISOString()}] ${aprobadas} operaciones aprobadas detectadas via AduanaNet (${Date.now() - start}ms)`);
  }

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
