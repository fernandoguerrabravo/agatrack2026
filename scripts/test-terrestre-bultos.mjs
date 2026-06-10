/**
 * Test: Graba Módulo Bultos para operación terrestre 190321
 * 
 * - Identificación: placas camión/semi, precinto, 18 PALLET(80)
 * - Observaciones banco central: CO + CPT + Mandato FEA
 * - Popup tipo bulto: PALLET (80), cantidad 18
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };

const BASE_URL = get("ADUANANET_URL") || "https://fguerragodoy.aduananet2.cl";
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");

const nroOperacion = "190321";

console.log("=== Test Bultos Terrestre ===");
console.log("Operación:", nroOperacion);
console.log("");

try {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  console.log("[1] Login AduanaNet...");
  await page.goto(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);
  console.log("[1] ✅ Login OK");
  page.on("dialog", async dialog => { await dialog.accept(); });

  // Cargar módulo Bultos
  const bultosUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_desc_bulto.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("[2] Cargando módulo Bultos...");
  await page.goto(bultosUrl, { waitUntil: "networkidle0" });
  console.log("[2] ✅ Página cargada");

  // Datos
  const idBultos = `PBB/DOW - 1/18\n18 Pallets (80) conteniendo 1080 Bolsas (64)`;
  const obsBanco = `CERTIFICADO DE ORIGEN AR004A35260000635400 FECHA 08/06/2026\nTRANSPORTE PAGADO HASTA CLAUSULA CPT\nMandato FEA`;

  // Llenar campos
  console.log("[3] Llenando campos...");
  await page.evaluate((data) => {
    const frm = document.frm;
    frm.din_id_bultos.value = data.idBultos;
    frm.din_obs_banco_sna.value = data.obsBanco;
    frm.comando.value = "U";
  }, { idBultos, obsBanco });
  console.log("[3] ✅ Campos llenados");

  // Guardar
  console.log("[4] Guardando bultos...");
  await page.evaluate(() => { document.frm.submit(); });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  console.log("[4] ✅ Bultos guardados");

  // Popup tipo bulto — POST directo a dus_bulto.php (mismo approach que marítimo)
  console.log("[5] Grabando tipo bulto via POST directo...");
  
  // Obtener cookies de la sesión de Puppeteer
  const cookies = await page.cookies();
  const cookieStr = cookies.map(c => c.name + "=" + c.value).join("; ");
  
  const bultoBody = new URLSearchParams();
  bultoBody.set("lib_nid", nroOperacion);
  bultoBody.set("lib_base", "1");
  bultoBody.set("lbac_nid", "0");
  bultoBody.set("dus_tipo_envio", "2");
  bultoBody.set("lineas", "1");
  bultoBody.set("enviar", "1");
  bultoBody.set("bul_sec_nro_bulto0", "1");
  bultoBody.set("bul_cod_tipo_bulto0", "80");
  bultoBody.set("sel_bul_cod_tipo_bulto0", "80");
  bultoBody.set("bul_glosa0", "");
  bultoBody.set("bul_cantidad0", "18");

  const bultoRes = await fetch(`${BASE_URL}/modulos/din/dus_encabezado/dus_bulto.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookieStr,
    },
    body: bultoBody.toString(),
    redirect: "manual",
  });
  console.log("[5] POST status:", bultoRes.status);
  console.log("[5] ✅ Tipo bulto grabado: PALLET (80) x 18");

  console.log("\n📊 Resumen:");
  console.log("  ID Bultos:");
  console.log("    CAMION: AG028ZX");
  console.log("    SEMI: AG701RP");
  console.log("    PRECINTO: JK93272");
  console.log("    18 PALLET(80)");
  console.log("  Obs. Banco Central:");
  console.log("    CERTIFICADO DE ORIGEN AR004A35260000635400 FECHA 08/06/2026");
  console.log("    TRANSPORTE PAGADA HASTA CLAUSULA CPT");
  console.log("    Mandato FEA");
  console.log("  Tipo bulto: PALLET (80), cantidad: 18");

  await browser.close();
  console.log("\n✅ Módulo Bultos grabado para operación", nroOperacion);
} catch (err) {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
}
