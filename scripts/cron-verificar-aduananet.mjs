#!/usr/bin/env node
/**
 * Cron: Verifica en AduanaNet (UI en vivo, vía Puppeteer) si un despacho ya está
 * ACEPTADO/legalizado, para adelantarse al refresco de 3h de la réplica (out_despacho_fguerra).
 *
 * MÉTODO CONFIABLE (reescrito 2026-07-21 tras incidente):
 *  - Se filtra la lista de DIN terminadas por el lib_nid EXACTO.
 *  - Se considera aprobado SOLO si existe una fila de datos cuya 1ª celda (NºDesp)
 *    es exactamente el despacho, y de ESA fila se extrae Nro.Aceptación y Fecha.
 *  - NO se toma "cualquier número de 10 dígitos" (ese bug causaba falsas aprobaciones).
 *
 * Seguridad de carga: un solo navegador, operaciones en serie, tope MAX_OPS por corrida.
 *
 * Uso: node scripts/cron-verificar-aduananet.mjs           (aplica cambios)
 *      DRY_RUN=1 node scripts/cron-verificar-aduananet.mjs (solo reporta, no escribe)
 * Cron sugerido: cada 20 minutos.
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); if (v.startsWith("'")) v = v.slice(1, -1); return v; };

const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });
const BASE_URL = get("ADUANANET_URL") || "https://fguerragodoy.aduananet2.cl";
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");

const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_OPS = Number(process.env.MAX_OPS || 40);
// Correos + auto-provisión: true para enviar; se controla con env ENVIAR_CORREOS.
const ENVIAR_CORREOS = process.env.ENVIAR_CORREOS !== "0";

function sweepTmp() {
  try {
    require("child_process").execSync(
      "find /tmp/snap-private-tmp/snap.chromium/tmp -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' -type d -mmin +15 -exec rm -rf {} + 2>/dev/null; " +
      "find /tmp -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' -mmin +15 -exec rm -rf {} + 2>/dev/null",
      { timeout: 20000, shell: "/bin/bash" }
    );
  } catch {}
}

async function loginBrowser(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.on("dialog", async d => { try { await d.accept(); } catch {} });
  await page.goto(`${BASE_URL}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => /entrar/i.test(x.textContent || "") || (x.getAttribute("onclick") || "").includes("myFunction")); if (b) b.click(); }),
  ]);
  if (!/dashboard/i.test(page.url())) throw new Error("Login AduanaNet falló (no llegó a dashboard)");
  return page;
}

/**
 * Consulta la lista de DIN terminadas filtrada por el despacho exacto.
 * Devuelve { nroAceptacion, fecha, referencia } si hay una fila con NºDesp == op, si no null.
 */
async function consultarAceptacion(page, op) {
  await page.goto(`${BASE_URL}/modulos/din/dus_encabezado/lista.php?term=1`, { waitUntil: "networkidle0" });
  const inp = await page.$('input[name="fil_lib_nid"]');
  if (!inp) return null;
  await inp.click({ clickCount: 3 });
  await inp.type(String(op));
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    page.keyboard.press("Enter"),
  ]);
  await new Promise(r => setTimeout(r, 1500));

  return await page.evaluate((op) => {
    for (const tr of document.querySelectorAll("tr")) {
      const cells = [...tr.querySelectorAll("td")].map(td => (td.innerText || "").replace(/\s+/g, " ").trim());
      // Fila de datos: 1ª celda = NºDesp exacto; estructura NºDesp|TipoOp|Aduana|Ref|NroAcep|Fecha|Cliente
      if (cells.length >= 7 && cells[0] === String(op)) {
        const nroAceptacion = cells[4] || "";
        const fecha = cells[5] || "";
        const referencia = cells[3] || "";
        // Validar: aceptación numérica y fecha dd/mm/yyyy
        if (/^\d{6,}$/.test(nroAceptacion) && /^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
          return { nroAceptacion, fecha, referencia };
        }
      }
    }
    return null;
  }, op);
}

async function enviarCorreoAprobacion(op, nroAceptacion, fecha, referencia, rutCliente) {
  const { Resend } = await import("resend");
  const resend = new Resend(get("RESEND_API_KEY"));
  const ej = await pool.query(
    "SELECT u.email FROM usuarios u INNER JOIN asignaciones_ejecutivo a ON u.rut = a.rut_ejecutivo WHERE a.rut_cliente = $1 AND u.email IS NOT NULL",
    [rutCliente]
  );
  const cc = ej.rows.map(r => r.email).filter(Boolean);
  await resend.emails.send({
    from: get("RESEND_FROM") || "AgaTrack <reportes@agatrack.com>",
    to: ["oscar@agenciaguerra.com","pbalmaceda@agenciaguerra.com","daviles@agenciaguerra.com","transmision@agenciaguerra.com","comercial@agenciaguerra.com","fguerrab@agenciaguerra.com"],
    cc: cc.length ? cc : undefined,
    subject: `✅ Despacho Aprobado ${op} - Aceptación: ${nroAceptacion} - ${fecha}${referencia ? " - REF: " + referencia : ""}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;"><p>Estimados,</p><p>El despacho <b>${op}</b> ha sido <span style="color:#16a34a;font-weight:bold;">APROBADO</span>.</p><table style="border-collapse:collapse;margin:16px 0;"><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${op}</td></tr><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Aceptación</td><td style="padding:8px 12px;border:1px solid #ddd;">${nroAceptacion}</td></tr><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Fecha</td><td style="padding:8px 12px;border:1px solid #ddd;">${fecha}</td></tr>${referencia ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>` : ""}</table><p style="color:#666;font-size:12px;">Detectado vía AduanaNet (verificación en vivo). Notificación automática de AgaTrack.</p></div>`,
  });
}

(async () => {
  const start = Date.now();
  // Candidatos: no aprobadas/cerradas, con actividad reciente. Tope MAX_OPS.
  const { rows: pendientes } = await pool.query(
    `SELECT nro_operacion, rut_cliente FROM operaciones
     WHERE estado NOT IN ('aprobada','cerrada')
       AND nro_operacion ~ '^[0-9]+$'
       AND updated_at >= NOW() - INTERVAL '21 days'
     ORDER BY updated_at DESC
     LIMIT ${MAX_OPS}`
  );
  if (pendientes.length === 0) { await pool.end(); return; }
  console.log(`[${new Date().toISOString()}] aduananet-check: ${pendientes.length} pendientes (DRY_RUN=${DRY_RUN})`);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"] });
  let aprobadas = 0;
  try {
    const page = await loginBrowser(browser);
    for (const op of pendientes) {
      let acep = null;
      try { acep = await consultarAceptacion(page, op.nro_operacion); }
      catch (e) { console.error(`  ${op.nro_operacion} error:`, e.message); continue; }
      if (!acep) continue;

      console.log(`  ✅ ${op.nro_operacion} ACEPTADO: ${acep.nroAceptacion} (${acep.fecha}) ref=${acep.referencia}${DRY_RUN ? "  [DRY_RUN]" : ""}`);
      aprobadas++;
      if (DRY_RUN) continue;

      const updated = await pool.query(
        `UPDATE operaciones SET estado='aprobada', fecha_cierre=NOW(), updated_at=NOW(),
         notas = COALESCE(notas,'') || $1
         WHERE nro_operacion=$2 AND estado != 'aprobada' RETURNING rut_cliente`,
        [`\nAprobada (aduananet): ${acep.nroAceptacion} (${acep.fecha})`, op.nro_operacion]
      );
      if (updated.rowCount === 0) continue;

      if (ENVIAR_CORREOS) {
        const rut = updated.rows[0].rut_cliente || "";
        try { await enviarCorreoAprobacion(op.nro_operacion, acep.nroAceptacion, acep.fecha, acep.referencia, rut); }
        catch (e) { console.error(`  ${op.nro_operacion} email err:`, e.message); }
        // Auto-provisión Petroquímica (en serie, awaited, para no saturar)
        if (rut === "92933000-5") {
          try {
            const r = await fetch(`http://localhost:${process.env.PORT || 3000}/api/operaciones/provision-fondos`, {
              method: "POST", headers: { "Content-Type": "application/json", "x-inbound-secret": get("INBOUND_SECRET") || "" },
              body: JSON.stringify({ nro_operacion: op.nro_operacion }),
            });
            console.log(`  ${op.nro_operacion} provisión: HTTP ${r.status}`);
          } catch (e) { console.error(`  ${op.nro_operacion} provisión err:`, e.message); }
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    sweepTmp();
  }
  console.log(`[${new Date().toISOString()}] aduananet-check listo: ${aprobadas} aceptadas${DRY_RUN ? " (dry-run)" : ""} en ${((Date.now()-start)/1000).toFixed(1)}s`);
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end().catch(()=>{}); process.exit(1); });
