#!/usr/bin/env node
/**
 * Ejecutar módulo Bultos para 189696 (terrestre)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require2 = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=[\"']?([^\"'\\n]+)", "m")); return m ? m[1] : ""; };

const BASE = get("ADUANANET_URL");
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");
const NRO_OP = "189696";

const ID_BULTOS = `PBB/DOW - 1/18 PETROQUIMICA DOW S.A.\n18 PALLET (80) conteniendo 1080 Bolsas (64)`;
const OBS_BANCO = `COD.-ARG. AR004A35260000662100 FECHA 16-06-2026\nTRANSPORTE PAGADO HASTA CLAUSULA CPT\nMandato FEA`;

(async () => {
  const puppeteer = require2("puppeteer");
  const execPath = fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(execPath ? { executablePath: execPath } : {}),
  });
  const page = await browser.newPage();
  page.on("dialog", async d => { console.log("[dialog]", d.message()); await d.accept(); });

  // Login
  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
  console.log("Login OK");

  // 1. Ir al módulo de bultos
  const bultosUrl = `${BASE}/modulos/din/dus_encabezado/dus_desc_bulto.php?lib_base=1&lib_nid=${NRO_OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("\n1. Navegando a módulo Bultos...");
  await page.goto(bultosUrl, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  // 2. Llenar campos
  console.log("2. Llenando campos...");
  console.log("   din_id_bultos:", ID_BULTOS.replace(/\n/g, " | "));
  console.log("   din_obs_banco_sna:", OBS_BANCO.replace(/\n/g, " | "));

  await page.evaluate((data) => {
    const frm = document.frm || document.forms[0];
    if (frm.din_id_bultos) frm.din_id_bultos.value = data.idBultos;
    if (frm.din_obs_banco_sna) frm.din_obs_banco_sna.value = data.obsBanco;
    if (frm.comando) frm.comando.value = "U";
  }, { idBultos: ID_BULTOS, obsBanco: OBS_BANCO });

  // 3. Grabar formulario principal
  console.log("3. Grabando formulario principal...");
  await page.evaluate(() => {
    const frm = document.frm || document.forms[0];
    frm.submit();
  });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  console.log("   ✅ Formulario bultos grabado");

  // 4. Grabar popup bultos (tipo + cantidad)
  console.log("4. Grabando popup bultos (18 PALLET)...");
  // Login cookies para fetch
  const cookies = await page.evaluate(() => document.cookie);
  const popupUrl = `${BASE}/modulos/din/dus_encabezado/dus_bulto.php`;
  const body = new URLSearchParams({
    lib_nid: NRO_OP,
    lib_base: "1",
    lbac_nid: "0",
    dus_tipo_envio: "2",
    lineas: "1",
    enviar: "1",
    bul_sec_nro_bulto0: "1",
    bul_cod_tipo_bulto0: "80",
    sel_bul_cod_tipo_bulto0: "80",
    bul_glosa0: "",
    bul_cantidad0: "18",
  });

  await page.goto(`${popupUrl}?${body.toString()}`, { waitUntil: "networkidle0" });
  // También enviar como POST
  await page.evaluate((url, params) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    for (const [k, v] of Object.entries(params)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = k;
      input.value = v;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }, popupUrl, Object.fromEntries(body));
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  console.log("   ✅ Popup bultos grabado: 18 PALLET (80)");

  console.log("\n✅ Módulo Bultos completo para op " + NRO_OP);

  await browser.close();
})();
