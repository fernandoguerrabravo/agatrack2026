#!/usr/bin/env node
/**
 * Demonio/Cron: Verifica operaciones aprobadas comparando con despachos_replica.
 * Si el nro_operacion aparece en la columna "despacho" de despachos_replica, se marca como aprobada.
 * 
 * Uso: node scripts/cron-verificar-aprobadas.mjs
 * Cron: */5 * * * * cd /opt/agatrack2026 && /usr/bin/node scripts/cron-verificar-aprobadas.mjs >> /var/log/agatrack-aprobadas.log 2>&1
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

// ⛔ Correos automáticos de aprobación + auto-provisión DESHABILITADOS (2026-07-21).
// Poner en true para reactivar el envío de correo "Despacho Aprobado" y la provisión auto.
const ENVIAR_CORREOS = false;

(async () => {
  const start = Date.now();

  // Obtener operaciones no aprobadas
  const { rows: pendientes } = await pool.query(
    "SELECT nro_operacion FROM operaciones WHERE estado NOT IN ('aprobada', 'cerrada')"
  );

  if (pendientes.length === 0) {
    await pool.end();
    return;
  }

  const nros = pendientes.map(r => r.nro_operacion);

  // Buscar cuáles aparecen en despachos_replica COMO APROBADAS.
  // IMPORTANTE: solo estado 'C' (Cursada/legalizada) = aprobado.
  // estado 'I' (Ingresada) = DIN en trámite / no legalizada → NO aprobar
  // (evita marcar aprobados y enviar correos de despachos aún en curso).
  const { rows: aprobadas } = await pool.query(
    `SELECT despacho, nro_aceptacion, fecha_aceptacion 
     FROM despachos_replica 
     WHERE despacho = ANY($1) AND estado = 'C'`,
    [nros]
  );

  if (aprobadas.length === 0) {
    await pool.end();
    return;
  }

  // Actualizar estado y enviar notificación
  let actualizadas = 0;
  for (const ap of aprobadas) {
    const fecha = ap.fecha_aceptacion ? new Date(ap.fecha_aceptacion).toLocaleDateString("es-CL") : "";
    const updated = await pool.query(
      `UPDATE operaciones SET estado = 'aprobada', fecha_cierre = NOW(), updated_at = NOW(),
       notas = COALESCE(notas, '') || $1
       WHERE nro_operacion = $2 AND estado != 'aprobada' RETURNING rut_cliente, notas`,
      [`\nAprobada (replica): ${ap.nro_aceptacion} (${fecha})`, ap.despacho]
    );
    if (updated.rowCount > 0) {
      actualizadas++;
      // Correos automáticos + provisión deshabilitados: solo se marca el estado.
      if (!ENVIAR_CORREOS) continue;
      // Enviar correo de notificación de aprobación
      try {
        const rutCliente = updated.rows[0]?.rut_cliente || "";
        const notas = updated.rows[0]?.notas || "";
        const refMatch = notas.match(/ref:\s*([^\s|\n]+)/i);
        const referencia = refMatch ? refMatch[1] : "";
        
        // Obtener ejecutivos asignados
        const ejecutivos = await pool.query(
          "SELECT u.email FROM usuarios u INNER JOIN asignaciones_ejecutivo a ON u.rut = a.rut_ejecutivo WHERE a.rut_cliente = $1 AND u.email IS NOT NULL",
          [rutCliente]
        );
        const ccEmails = ejecutivos.rows.map(r => r.email).filter(Boolean);

        const { Resend } = await import("resend");
        const resend = new Resend(get("RESEND_API_KEY"));
        
        // Descargar PDF de la DIN aprobada de AduanaNet
        let dinPdfBuffer = null;
        try {
          const BASE_URL = get("ADUANANET_URL") || "https://fguerragodoy.aduananet2.cl";
          const loginBody = "login=" + encodeURIComponent(get("ADUANANET_LOGIN")) + "&clave=" + encodeURIComponent(get("ADUANANET_CLAVE"));
          const loginRes = await fetch(BASE_URL + "/modulos/usuarios/login.php", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: loginBody, redirect: "manual"
          });
          const cookies = loginRes.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
          const dinUrl = `${BASE_URL}/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${ap.despacho}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`;
          const dinRes = await fetch(dinUrl, { headers: { Cookie: cookies } });
          if (dinRes.ok) {
            const ct = dinRes.headers.get("content-type") || "";
            if (ct.includes("pdf") || ct.includes("octet")) {
              dinPdfBuffer = Buffer.from(await dinRes.arrayBuffer());
              console.log(`[${new Date().toISOString()}] DIN PDF descargado: ${dinPdfBuffer.length} bytes`);
            }
          }
        } catch (pdfErr) {
          console.error(`[${new Date().toISOString()}] Error descargando DIN PDF:`, pdfErr.message || pdfErr);
        }

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
          subject: `✅ Despacho Aprobado ${ap.despacho} - Aceptación: ${ap.nro_aceptacion} - ${fecha}${referencia ? " - REF: " + referencia : ""}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>El despacho <b>${ap.despacho}</b> ha sido <span style="color:#16a34a;font-weight:bold;">APROBADO</span>.</p>
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;width:180px;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${ap.despacho}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Aceptación</td><td style="padding:8px 12px;border:1px solid #ddd;">${ap.nro_aceptacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Fecha Aceptación</td><td style="padding:8px 12px;border:1px solid #ddd;">${fecha}</td></tr>
    ${referencia ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>` : ""}
  </table>
  <p style="color:#666;font-size:12px;margin-top:20px;">Notificación automática de AgaTrack.</p>
</div>`,
          attachments: dinPdfBuffer ? [{ filename: `DIN_Aprobada_${ap.despacho}.pdf`, content: dinPdfBuffer }] : [],
        });
        console.log(`[${new Date().toISOString()}] Email aprobación enviado para ${ap.despacho}`);
      } catch (emailErr) {
        console.error(`[${new Date().toISOString()}] Error email aprobación ${ap.despacho}:`, emailErr.message || emailErr);
      }

      // Auto-generar provisión de fondos para Petroquímica DOW
      if (rutCliente === "92933000-5") {
        try {
          console.log(`[${new Date().toISOString()}] Auto-generando provisión de fondos para ${ap.despacho}...`);
          const provRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/operaciones/provision-fondos`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-inbound-secret": get("INBOUND_SECRET") || "" },
            body: JSON.stringify({ nro_operacion: ap.despacho }),
          });
          if (provRes.ok) {
            const provData = await provRes.json();
            console.log(`[${new Date().toISOString()}] ✅ Provisión generada para ${ap.despacho}: total=${provData.total}`);
          } else {
            const errText = await provRes.text().catch(() => "");
            console.error(`[${new Date().toISOString()}] Error provisión ${ap.despacho}: ${provRes.status} ${errText.substring(0, 100)}`);
          }
        } catch (provErr) {
          console.error(`[${new Date().toISOString()}] Error auto-provisión ${ap.despacho}:`, provErr.message || provErr);
        }
      }
    }
  }

  if (actualizadas > 0) {
    console.log(`[${new Date().toISOString()}] ${actualizadas} operaciones aprobadas: ${aprobadas.map(a => a.despacho).join(", ")} (${Date.now() - start}ms)`);
  }

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
