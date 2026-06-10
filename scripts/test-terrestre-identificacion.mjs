/**
 * Test: Graba Módulo Identificación (consignante) para operación terrestre 190321
 * Consignante = proveedor de la factura: PBBPOLISUR S.R.L. (Dow Argentina)
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
const proveedorKeyword = "PBBPOLISUR"; // De la factura: PBBPOLISUR S.R.L. (Dow Argentina)

console.log("=== Test Identificación Terrestre ===");
console.log("Operación:", nroOperacion);
console.log("Consignante (proveedor factura):", proveedorKeyword);
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

  // Buscar consignante
  console.log("[2] Buscando consignante:", proveedorKeyword);
  const csgUrl = `${BASE_URL}/modulos/general/ventanas/listados/consignante.php?identificador=&fil_csg_nombre=${encodeURIComponent(proveedorKeyword)}`;
  const csgRes = await page.goto(csgUrl, { waitUntil: "networkidle0" });
  const csgHtml = await csgRes.text();
  
  const matches = [...csgHtml.matchAll(/seleccion\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/gi)];
  console.log("  Encontrados:", matches.length, "consignantes");
  
  if (matches.length === 0) {
    console.log("❌ No se encontró consignante para:", proveedorKeyword);
    await browser.close();
    process.exit(1);
  }

  // Tomar el de ID más alto
  let best = matches[0];
  for (const m of matches) {
    if (Number(m[1]) > Number(best[1])) best = m;
  }
  console.log("  Seleccionado: id=" + best[1] + " nombre=" + best[2] + " pais=" + best[3]);

  // Cargar módulo Identificación
  const idUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_identificacion.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("[3] Cargando módulo Identificación...");
  await page.goto(idUrl, { waitUntil: "networkidle0" });

  // Setear consignante y guardar
  console.log("[4] Seteando consignante y guardando...");
  await page.evaluate((csg) => {
    const frm = document.frm;
    frm.csg_id.value = csg.id;
    frm.csg_nombre.value = csg.nombre;
    frm.dus_nombre_consignatario.value = csg.nombre;
    if (frm.csg_direccion) frm.csg_direccion.value = csg.direccion;
    if (frm.pai_id) frm.pai_id.value = csg.pais;
    frm.comando.value = "U";
  }, { id: best[1], nombre: best[2], pais: best[3], direccion: best[6] || "" });

  // Submit
  await page.evaluate(() => {
    document.frm.submit();
  });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});

  console.log("[4] ✅ Consignante grabado:", best[2]);
  
  await browser.close();
  console.log("\n✅ Módulo Identificación grabado para operación", nroOperacion);
} catch (err) {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
}
