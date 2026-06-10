/**
 * Test: Graba Módulo Destino y Transporte para operación terrestre 190321
 * 
 * Reglas terrestres:
 * - País origen/adquisición = 224 (ARGENTINA)
 * - Via = 7 (terrestre/carretero)
 * - Puerto embarque = BAHIA BLANCA (aduana_partida del MIC)
 * - Puerto desembarque = LOS ANDES
 * - Sin nave
 * - Manifiesto = "ENVIOS PARCIALES"
 * - Transportista = EMPRESA DE TTES. DON PEDRO S.R.L. (porteador CRT)
 * - Documento transporte = CRT 003AR4490010673, fecha 05/06/2026
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

console.log("=== Test Destino Terrestre ===");
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

  // Buscar puerto embarque BAHIA BLANCA (extranjero)
  console.log("[2] Buscando puerto embarque BAHIA BLANCA...");
  const pueExtUrl = `${BASE_URL}/modulos/general/otros_puertos.php?identificador=pue_id&modo=desc&valor=BAHIA%20BLANCA&via=&nacional=0`;
  const pueExtRes = await page.goto(pueExtUrl, { waitUntil: "networkidle0" });
  const pueExtHtml = await pueExtRes.text();
  const pueExtMatch = pueExtHtml.match(/seleccion\(\s*'([^']*)'\s*,\s*'([^']*)'/);
  const pueEmbCod = pueExtMatch ? pueExtMatch[1] : "";
  const pueEmbNombre = pueExtMatch ? pueExtMatch[2] : "BAHIA BLANCA";
  console.log("  Puerto embarque:", pueEmbCod, pueEmbNombre);

  // Buscar transportista DON PEDRO
  console.log("[3] Buscando transportista...");
  const destPage = await page.goto(`${BASE_URL}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { waitUntil: "networkidle0" });
  const destHtml = await destPage.text();
  
  // Buscar en el array arrcia_id de la página
  const ciaMatch = destHtml.match(/arrcia_id\s*=\s*new\s*Array\(([\s\S]*?)\);/);
  let ciaId = "";
  let ciaNombre = "";
  if (ciaMatch) {
    // Buscar DON PEDRO en el array
    const donPedroMatch = ciaMatch[1].match(/"(\d+)"\s*,\s*"([^"]*DON PEDRO[^"]*)"/i);
    if (donPedroMatch) {
      ciaId = donPedroMatch[1];
      ciaNombre = donPedroMatch[2];
    }
  }
  console.log("  Transportista:", ciaId, ciaNombre || "(no encontrado en array)");

  // Obtener datos del transportista (país, rut)
  let ciaPais = "224"; // Argentina default
  let ciaRut = "";

  // Si no encontrado en array, buscar via popup transportista
  if (!ciaId) {
    console.log("  Buscando via popup transportista...");
    const traUrl = `${BASE_URL}/modulos/general/ventanas/listados/transportista.php?identificador=&fil_tra_nombre=DON%20PEDRO`;
    const traRes = await page.goto(traUrl, { waitUntil: "networkidle0" });
    const traHtml = await traRes.text();
    const traMatches = [...traHtml.matchAll(/seleccion\(\s*'([^']*)'\s*,\s*'([^']*)'(?:\s*,\s*'([^']*)')?\s*\)/gi)];
    console.log("  Encontrados:", traMatches.length, "resultados");
    if (traMatches.length === 0) {
      // Intentar regex más permisiva
      const traMatches2 = [...traHtml.matchAll(/seleccion\(\s*'([^']*)'\s*,\s*'([^']*)'/gi)];
      console.log("  Retry regex encontrados:", traMatches2.length);
      for (const m of traMatches2) traMatches.push(m);
    }
    for (const m of traMatches) {
      console.log("    id=" + m[1] + " nombre=" + m[2] + " rut=" + (m[3]||""));
    }
    
    // Preferir el que tenga RUT válido (tercer parámetro no vacío), y de esos el último creado (ID más alto)
    if (traMatches.length > 0) {
      let best = traMatches[0];
      for (const m of traMatches) {
        const rut = (m[3] || "").trim();
        if (rut && rut.length > 3) {
          if (!best || !(best[3] || "").trim() || Number(m[1]) > Number(best[1])) {
            best = m;
          }
        }
      }
      // Si ninguno tiene RUT, tomar el de ID más alto
      if (!(best[3] || "").trim()) {
        for (const m of traMatches) {
          if (Number(m[1]) > Number(best[1])) best = m;
        }
      }
      ciaId = best[1];
      ciaNombre = best[2];
      ciaRut = (best[3] || "").trim();
    }
    console.log("  Seleccionado:", ciaId, ciaNombre, "rut=" + ciaRut);
    
    // Volver a cargar destino
    await page.goto(`${BASE_URL}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { waitUntil: "networkidle0" });
  }

  if (ciaId && !ciaRut) {
    console.log("[4] Obteniendo datos transportista id=" + ciaId + "...");
    // Fetch XML via node fetch (no via page.evaluate que no descomprime bien)
    const traXmlUrl = `${BASE_URL}/modulos/general/getXML/transportista.php?tra_id=${ciaId}`;
    const cookies = await page.evaluate(() => document.cookie);
    // Use page cookies to fetch
    const traXmlRes = await page.evaluate(async (url) => {
      const r = await fetch(url);
      const buf = await r.arrayBuffer();
      // Return as array for node to decompress
      return Array.from(new Uint8Array(buf));
    }, traXmlUrl);
    const zlib = await import("zlib");
    const buf = Buffer.from(traXmlRes);
    let xml;
    if (buf.slice(0,2).toString("hex") === "1f8b") {
      xml = zlib.gunzipSync(buf).toString("latin1");
    } else {
      try { xml = zlib.inflateSync(buf).toString("latin1"); } catch { xml = buf.toString("latin1"); }
    }
    const rutMatch = xml.match(/<tra_rut>([^<]*)<\/tra_rut>/);
    const paisMatch = xml.match(/<pai_id>([^<]*)<\/pai_id>/);
    if (rutMatch && rutMatch[1] && /\d+-[\dkK]/.test(rutMatch[1])) {
      ciaRut = rutMatch[1];
    }
    if (paisMatch) ciaPais = paisMatch[1];
    console.log("  País:", ciaPais, "RUT:", ciaRut || "(sin RUT válido)");
    
    // Si no tiene RUT válido, buscar otro registro que sí tenga
    if (!ciaRut) {
      console.log("  Buscando otro registro con RUT válido...");
      const traUrl2 = `${BASE_URL}/modulos/general/ventanas/listados/transportista.php?identificador=&fil_tra_nombre=DON%20PEDRO`;
      const traRes2 = await page.goto(traUrl2, { waitUntil: "networkidle0" });
      const traHtml2 = await traRes2.text();
      const allIds = [...traHtml2.matchAll(/seleccion\(\s*'([^']*)'\s*,\s*'([^']*)'/gi)];
      
      for (const m of allIds.sort((a, b) => Number(b[1]) - Number(a[1]))) {
        if (m[1] === ciaId) continue; // ya probamos este
        const xmlRes2 = await page.evaluate(async (url) => {
          const r = await fetch(url);
          const buf = await r.arrayBuffer();
          return Array.from(new Uint8Array(buf));
        }, `${BASE_URL}/modulos/general/getXML/transportista.php?tra_id=${m[1]}`);
        const buf2 = Buffer.from(xmlRes2);
        let xml2;
        if (buf2.slice(0,2).toString("hex") === "1f8b") {
          xml2 = zlib.gunzipSync(buf2).toString("latin1");
        } else {
          try { xml2 = zlib.inflateSync(buf2).toString("latin1"); } catch { xml2 = buf2.toString("latin1"); }
        }
        const rut2 = (xml2.match(/<tra_rut>([^<]*)<\/tra_rut>/) || [])[1] || "";
        if (rut2 && /\d+-[\dkK]/.test(rut2)) {
          ciaId = m[1];
          ciaNombre = m[2];
          ciaRut = rut2;
          const p2 = (xml2.match(/<pai_id>([^<]*)<\/pai_id>/) || [])[1];
          if (p2) ciaPais = p2;
          console.log("  ✅ Encontrado:", ciaId, ciaNombre, "RUT:", ciaRut);
          break;
        }
      }
      
      // Volver a cargar destino
      await page.goto(`${BASE_URL}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { waitUntil: "networkidle0" });
    }
  }

  // Llenar campos del formulario de destino
  console.log("[5] Llenando módulo Destino...");
  await page.evaluate((data) => {
    const frm = document.frm;
    // País origen/adquisición
    frm.pai_id_origen.value = "224";
    frm.pai_id_adquisicion.value = "224";
    // Via terrestre
    frm.via_id.value = "7";
    // Puerto embarque
    if (data.pueEmbCod) frm.pue_id.value = data.pueEmbCod;
    frm.pue_nombre.value = data.pueEmbNombre;
    frm.dus_puerto_embarque_glosa.value = data.pueEmbNombre;
    if (frm.pue_adic) frm.pue_adic.value = "0";
    // Puerto desembarque: siempre 997 LOS ANDES para terrestre
    if (frm.pue_id2) frm.pue_id2.value = "997";
    if (frm.pue_nombre2) frm.pue_nombre2.value = "LOS ANDES";
    if (frm.dus_puerto_desembarque_glosa) frm.dus_puerto_desembarque_glosa.value = "LOS ANDES";
    // Transbordo: no
    if (frm.din_transbordo) frm.din_transbordo.value = "";
    // Nave: vacío (terrestre)
    if (frm.nav_id) frm.nav_id.value = "";
    if (frm.nav_nombre) frm.nav_nombre.value = "";
    if (frm.dus_nombre_nave) frm.dus_nombre_nave.value = "";
    // Transportista
    if (data.ciaId) {
      frm.cia_id.value = data.ciaId;
      frm.dus_nombre_cia_transp.value = data.ciaNombre;
      if (frm.pai_idcia) frm.pai_idcia.value = data.ciaPais;
      if (frm.dus_rut_cia_transp) frm.dus_rut_cia_transp.value = data.ciaRut;
    }
    // Emisor doc transporte = mismo transportista
    if (frm.cia_id_emisora) frm.cia_id_emisora.value = data.ciaId;
    if (frm.dus_emisor_docto_transp) frm.dus_emisor_docto_transp.value = data.ciaNombre;
    if (frm.cia_emisora_rut) frm.cia_emisora_rut.value = data.ciaRut;
    // Manifiesto: ENVIOS PARCIALES
    if (frm.din_manifiesto1) frm.din_manifiesto1.value = "ENVIOS PARCIALES";
    if (frm.din_fec_manifiesto) frm.din_fec_manifiesto.value = "";
    // Documento transporte = CRT
    frm.din_nro_docto_transp.value = "003AR4490010673";
    frm.din_fec_docto_transp.value = "05/06/2026";
    // Tipo carga
    if (frm.tic_id) frm.tic_id.value = "R";
    // Comando
    frm.comando.value = "U";
  }, { pueEmbCod, pueEmbNombre, ciaId, ciaNombre, ciaPais, ciaRut });

  // Submit
  console.log("[6] Guardando...");
  await page.evaluate(() => { document.frm.submit(); });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});

  console.log("[6] ✅ Módulo Destino grabado");
  console.log("  País: ARGENTINA (224)");
  console.log("  Via: 7 (terrestre)");
  console.log("  Puerto embarque:", pueEmbNombre, "(" + pueEmbCod + ")");
  console.log("  Puerto desembarque: LOS ANDES (ya viene de la apertura)");
  console.log("  Manifiesto: ENVIOS PARCIALES");
  console.log("  Transportista:", ciaNombre, "(" + ciaId + ")");
  console.log("  Doc. transporte: CRT 003AR4490010673, 05/06/2026");

  await browser.close();
  console.log("\n✅ Módulo Destino grabado para operación", nroOperacion);
} catch (err) {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
}
