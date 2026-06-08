#!/usr/bin/env node
/**
 * Explora el módulo de ÍTEMS (partidas arancelarias) de una operación en AduanaNet.
 * 
 * USAGE: node scripts/explorar-items.mjs [OP_NUMBER]
 * 
 * Requiere .env con:
 *   ADUANANET_URL=https://fguerragodoy.aduananet2.cl
 *   ADUANANET_LOGIN=...
 *   ADUANANET_CLAVE=...
 * 
 * Explora:
 *   1. Lista de ítems existentes (si hay)
 *   2. Formulario de creación/edición de un ítem
 *   3. Popup de arancel (búsqueda por código)
 *   4. Estructura de gravámenes
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const OP = process.argv[2] || "190248";

// --- Helpers ---
function pc(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const j = {};
  for (const l of raw) {
    const f = l.split(";")[0];
    const e = f.indexOf("=");
    if (e > 0) { const k = f.slice(0, e).trim(); const v = f.slice(e + 1).trim(); if (v && v !== "deleted") j[k] = v; }
  }
  return Object.entries(j).map(([k, v]) => k + "=" + v).join("; ");
}

async function login() {
  const lp = await fetch(`${BASE}/modulos/usuarios/login.php?status=-1`, { redirect: "manual" });
  const bc = pc(lp);
  const b = new URLSearchParams();
  b.set("login", LOGIN); b.set("clave", CLAVE);
  const v = await fetch(`${BASE}/modulos/usuarios/validar.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/modulos/usuarios/login.php?status=-1`, Cookie: bc },
    body: b.toString(), redirect: "manual"
  });
  return [bc, pc(v)].filter(Boolean).join("; ");
}

function extractFields(html) {
  const f = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (type === "checkbox" || type === "radio") {
      if (/checked/i.test(tag)) f[name] = value || "1";
    } else {
      f[name] = value;
    }
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const selected = (m[2].match(/<option\s+value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
    const opts = [...m[2].matchAll(/<option\s+value\s*=\s*["']?([^"'>]*)["']?[^>]*>([^<]*)/gi)]
      .map(o => ({ value: o[1], text: o[2].trim() }));
    f[name] = { selected, options: opts.slice(0, 15), totalOptions: opts.length };
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (name) f[name] = m[2].trim().slice(0, 200);
  }
  return f;
}

function extractLinks(html) {
  return [...html.matchAll(/href\s*=\s*["']([^"']*item[^"']*|[^"']*partida[^"']*|[^"']*arancel[^"']*)/gi)]
    .map(m => m[1]).slice(0, 20);
}

function extractJSFunctions(html) {
  return [...html.matchAll(/function\s+(\w+)\s*\([^)]*\)/gi)]
    .map(m => m[1]).slice(0, 30);
}

// --- Main ---
(async () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  EXPLORAR MÓDULO ÍTEMS — Op ${OP}`);
  console.log(`${"=".repeat(60)}\n`);

  const ck = await login();
  console.log("✅ Login OK\n");

  // ============================================================
  // 1. LISTA DE ÍTEMS (página principal de ítems)
  // ============================================================
  // Posibles URLs del módulo de ítems:
  const urlsItems = [
    `/modulos/din/dus_item/dus_item.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`,
    `/modulos/din/dus_item/dus_item.php?lib_nid=${OP}&comando=L&pagno=0`,
    `/modulos/din/dus_item/lista_items.php?lib_nid=${OP}&lib_base=1&lbac_nid=0&dus_tipo_envio=2`,
  ];

  console.log("--- 1. BUSCANDO LISTA DE ÍTEMS ---\n");
  let itemsHtml = "";
  for (const url of urlsItems) {
    try {
      const r = await fetch(`${BASE}${url}`, { headers: { Cookie: ck }, redirect: "follow" });
      const t = await r.text();
      console.log(`  ${url}`);
      console.log(`    status: ${r.status} | len: ${t.length}`);
      if (t.length > 500 && !/login\.php/i.test(t)) {
        itemsHtml = t;
        console.log(`    ✅ Respuesta válida`);
        break;
      } else {
        console.log(`    ⚠️ Respuesta vacía o redirige a login`);
      }
    } catch (e) {
      console.log(`    ❌ Error: ${e.message}`);
    }
  }

  if (itemsHtml) {
    // Extraer tabla de ítems (si existe listado)
    const rows = [...itemsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(c => c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()))
      .filter(c => c.length >= 3);
    console.log(`\n  Filas de tabla: ${rows.length}`);
    rows.slice(0, 10).forEach((r, i) => console.log(`    [${i}] ${r.join(" | ").slice(0, 150)}`));

    // Links relevantes
    const links = extractLinks(itemsHtml);
    if (links.length) {
      console.log(`\n  Links relevantes (${links.length}):`);
      links.forEach(l => console.log(`    ${l.slice(0, 120)}`));
    }

    // JS functions
    const fns = extractJSFunctions(itemsHtml);
    if (fns.length) console.log(`\n  JS Functions: ${fns.join(", ")}`);

    // Campos del form
    const fields = extractFields(itemsHtml);
    const fieldNames = Object.keys(fields);
    console.log(`\n  Campos del form: ${fieldNames.length}`);
    for (const [name, val] of Object.entries(fields)) {
      if (typeof val === "object" && val.options) {
        console.log(`    [select] ${name} = "${val.selected}" (${val.totalOptions} opciones: ${val.options.slice(0, 5).map(o => o.value + "=" + o.text).join(", ")}...)`);
      } else {
        console.log(`    ${name} = "${String(val).slice(0, 60)}"`);
      }
    }
  }

  // ============================================================
  // 2. FORMULARIO DE UN ÍTEM INDIVIDUAL
  // ============================================================
  console.log("\n\n--- 2. FORMULARIO DE ÍTEM INDIVIDUAL ---\n");
  const urlsItemForm = [
    `/modulos/din/dus_item/dus_item.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0&item=1`,
    `/modulos/din/dus_item/item_detalle.php?lib_nid=${OP}&item=1&comando=M`,
    `/modulos/din/dus_item/din_item.php?lib_nid=${OP}&item_nro=1&comando=M`,
    `/modulos/din/dus_item/din_item.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&item_nro=1`,
  ];

  let itemFormHtml = "";
  for (const url of urlsItemForm) {
    try {
      const r = await fetch(`${BASE}${url}`, { headers: { Cookie: ck }, redirect: "follow" });
      const t = await r.text();
      console.log(`  ${url}`);
      console.log(`    status: ${r.status} | len: ${t.length}`);
      if (t.length > 500 && !/login\.php/i.test(t)) {
        itemFormHtml = t;
        console.log(`    ✅ Respuesta válida`);
        break;
      }
    } catch (e) {
      console.log(`    ❌ Error: ${e.message}`);
    }
  }

  if (itemFormHtml) {
    const fields = extractFields(itemFormHtml);
    const fieldNames = Object.keys(fields);
    console.log(`\n  Campos del form: ${fieldNames.length}`);
    for (const [name, val] of Object.entries(fields)) {
      if (typeof val === "object" && val.options) {
        console.log(`    [select] ${name} = "${val.selected}" (${val.totalOptions} opciones: ${val.options.slice(0, 5).map(o => o.value + "=" + o.text).join(", ")}...)`);
      } else {
        console.log(`    ${name} = "${String(val).slice(0, 80)}"`);
      }
    }

    const fns = extractJSFunctions(itemFormHtml);
    if (fns.length) console.log(`\n  JS Functions: ${fns.join(", ")}`);

    const links = extractLinks(itemFormHtml);
    if (links.length) {
      console.log(`\n  Links (items/arancel):`);
      links.forEach(l => console.log(`    ${l.slice(0, 120)}`));
    }
  }

  // ============================================================
  // 3. POPUP DE ARANCEL (búsqueda por código)
  // ============================================================
  console.log("\n\n--- 3. POPUP ARANCEL ---\n");
  // Probar el popup de aranceles con un código conocido
  const codigosArancel = ["8481.80.90", "84818090", "8481"];
  for (const cod of codigosArancel) {
    const urlArancel = `/modulos/general/ventanas/listados/arancel.php?identificador=ara_id&valor=${encodeURIComponent(cod)}`;
    try {
      const r = await fetch(`${BASE}${urlArancel}`, { headers: { Cookie: ck }, redirect: "follow" });
      const t = await r.text();
      console.log(`  Código "${cod}": status ${r.status}, len ${t.length}`);
      // Buscar filas con seleccion()
      const sels = [...t.matchAll(/seleccion\(([^)]{0,200})\)/gi)].slice(0, 5);
      if (sels.length) {
        sels.forEach(m => console.log(`    ${m[0].slice(0, 150)}`));
      } else {
        // Mostrar snippet de la respuesta
        const clean = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        console.log(`    Contenido: ${clean.slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`    ❌ Error: ${e.message}`);
    }
  }

  // ============================================================
  // 4. GRAVÁMENES (derechos, IVA, sobretasas)
  // ============================================================
  console.log("\n\n--- 4. GRAVÁMENES / DERECHOS ---\n");
  const urlsGrav = [
    `/modulos/din/dus_item/gravamenes.php?lib_nid=${OP}&item_nro=1`,
    `/modulos/din/dus_item/din_gravamenes.php?lib_nid=${OP}&item_nro=1`,
    `/modulos/din/dus_item/dus_gravamenes.php?lib_nid=${OP}&item_nro=1&comando=M`,
  ];
  for (const url of urlsGrav) {
    try {
      const r = await fetch(`${BASE}${url}`, { headers: { Cookie: ck }, redirect: "follow" });
      const t = await r.text();
      console.log(`  ${url}`);
      console.log(`    status: ${r.status} | len: ${t.length}`);
      if (t.length > 300 && !/login\.php/i.test(t)) {
        const fields = extractFields(t);
        const fieldNames = Object.keys(fields);
        if (fieldNames.length) {
          console.log(`    Campos: ${fieldNames.length}`);
          for (const [name, val] of Object.entries(fields)) {
            if (typeof val === "object" && val.options) {
              console.log(`      [select] ${name} = "${val.selected}" (${val.totalOptions} opts)`);
            } else {
              console.log(`      ${name} = "${String(val).slice(0, 60)}"`);
            }
          }
        } else {
          const clean = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          console.log(`    Contenido: ${clean.slice(0, 400)}`);
        }
      }
    } catch (e) {
      console.log(`    ❌ Error: ${e.message}`);
    }
  }

  // ============================================================
  // 5. EXPLORAR MÓDULO DE OBSERVACIONES (si existe)
  // ============================================================
  console.log("\n\n--- 5. OBSERVACIONES / OTROS MÓDULOS ---\n");
  const urlsOtros = [
    `/modulos/din/dus_encabezado/dus_observaciones.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`,
    `/modulos/din/dus_encabezado/dus_liquidacion.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`,
    `/modulos/din/dus_encabezado/dus_resumen.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`,
  ];
  for (const url of urlsOtros) {
    try {
      const r = await fetch(`${BASE}${url}`, { headers: { Cookie: ck }, redirect: "follow" });
      const t = await r.text();
      const modName = url.split("/").pop().split("?")[0];
      console.log(`  ${modName}: status ${r.status}, len ${t.length}`);
      if (t.length > 300 && !/login\.php/i.test(t)) {
        const fields = extractFields(t);
        const fieldNames = Object.keys(fields);
        console.log(`    Campos: ${fieldNames.length}`);
        fieldNames.slice(0, 15).forEach(n => {
          const v = fields[n];
          if (typeof v === "object" && v.options) {
            console.log(`      [select] ${n} = "${v.selected}" (${v.totalOptions} opts)`);
          } else {
            console.log(`      ${n} = "${String(v).slice(0, 60)}"`);
          }
        });
        if (fieldNames.length > 15) console.log(`      ... y ${fieldNames.length - 15} más`);
      }
    } catch (e) {
      console.log(`    ❌ ${e.message}`);
    }
  }

  console.log("\n\n✅ Exploración completa.\n");
})().catch((e) => { console.error("\n❌ ERROR:", e.message); process.exit(1); });
