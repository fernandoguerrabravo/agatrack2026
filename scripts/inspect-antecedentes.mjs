#!/usr/bin/env node
/**
 * Inspecciona el formulario ANTECEDENTES FINANCIEROS (dus_antecedentes.php)
 * de AduanaNet para la operación 190248.
 * Extrae TODOS los campos (inputs, selects con opciones, textareas).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  let v = m ? m[1].trim() : "";
  if (v.startsWith('"')) v = v.slice(1, -1);
  return v;
};
const BASE = get("ADUANANET_URL"),
  LOGIN = get("ADUANANET_LOGIN"),
  CLAVE = get("ADUANANET_CLAVE");
const OP = "190248";

function pc(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  const j = {};
  for (const l of raw) {
    const f = l.split(";")[0];
    const e = f.indexOf("=");
    if (e > 0) {
      const k = f.slice(0, e).trim();
      const v = f.slice(e + 1).trim();
      if (v && v !== "deleted") j[k] = v;
    }
  }
  return Object.entries(j)
    .map(([k, v]) => k + "=" + v)
    .join("; ");
}

async function login() {
  const lp = await fetch(`${BASE}/modulos/usuarios/login.php?status=-1`, {
    redirect: "manual",
  });
  const bc = pc(lp);
  const b = new URLSearchParams();
  b.set("login", LOGIN);
  b.set("clave", CLAVE);
  const v = await fetch(`${BASE}/modulos/usuarios/validar.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/modulos/usuarios/login.php?status=-1`,
      Cookie: bc,
    },
    body: b.toString(),
    redirect: "manual",
  });
  return [bc, pc(v)].filter(Boolean).join("; ");
}

function extractFullForm(html) {
  const fields = [];

  // Extract inputs
  for (const m of html.matchAll(/<input\b([^>]*)>/gi)) {
    const tag = m[1];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const type = (
      (tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text"
    ).toLowerCase();
    const value =
      (tag.match(/value\s*=\s*["']([^"']*?)["']/i) || [])[1] || "";
    const readonly = /readonly/i.test(tag);
    const disabled = /disabled/i.test(tag);
    const checked = /checked/i.test(tag);
    fields.push({ name, type, value, readonly, disabled, checked });
  }

  // Extract selects with options
  for (const m of html.matchAll(
    /<select\b([^>]*)>([\s\S]*?)<\/select>/gi
  )) {
    const attrs = m[1];
    const inner = m[2];
    const name = (attrs.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const disabled = /disabled/i.test(attrs);

    const options = [];
    for (const opt of inner.matchAll(
      /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
    )) {
      const optAttrs = opt[1];
      const optText = opt[2].replace(/<[^>]+>/g, "").trim();
      const optValue =
        (optAttrs.match(/value\s*=\s*["']?([^"'>]*)/i) || [])[1] || "";
      const selected = /selected/i.test(optAttrs);
      options.push({ value: optValue, text: optText, selected });
    }

    const selectedOpt = options.find((o) => o.selected);
    fields.push({
      name,
      type: "select",
      value: selectedOpt ? selectedOpt.value : "",
      selectedText: selectedOpt ? selectedOpt.text : "",
      disabled,
      options,
    });
  }

  // Extract textareas
  for (const m of html.matchAll(
    /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi
  )) {
    const attrs = m[1];
    const value = m[2].replace(/<[^>]+>/g, "").trim();
    const name = (attrs.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name) continue;
    fields.push({ name, type: "textarea", value });
  }

  return fields;
}

// Extract labels/context near fields
function extractLabels(html) {
  const labels = {};
  // Look for patterns like: text followed by input/select
  for (const m of html.matchAll(
    /(?:<td[^>]*>|<b>|<font[^>]*>)\s*([^<]{2,40})\s*(?:<\/\w+>)*\s*(?:<\/td>[\s\S]{0,50})?<(?:input|select)\b[^>]*name\s*=\s*["']?([^"'\s>]+)/gi
  )) {
    const label = m[1].replace(/&nbsp;/g, " ").trim();
    const name = m[2];
    if (label && name && !labels[name]) labels[name] = label;
  }
  return labels;
}

(async () => {
  console.log("=== INSPECCIÓN ANTECEDENTES FINANCIEROS — Op", OP, "===\n");
  const ck = await login();
  console.log("Login OK\n");

  const url = `${BASE}/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await (await fetch(url, { headers: { Cookie: ck } })).text();

  // Guardar HTML para referencia
  fs.writeFileSync(
    path.join(__dirname, "antecedentes-form.html"),
    html,
    "utf-8"
  );
  console.log("HTML guardado en scripts/antecedentes-form.html\n");

  const fields = extractFullForm(html);
  const labels = extractLabels(html);

  console.log(`Total campos encontrados: ${fields.length}\n`);
  console.log("=".repeat(80));

  // Separar por tipo
  const inputs = fields.filter(
    (f) => f.type !== "select" && f.type !== "textarea"
  );
  const selects = fields.filter((f) => f.type === "select");
  const textareas = fields.filter((f) => f.type === "textarea");

  console.log("\n📋 INPUTS (" + inputs.length + "):");
  console.log("-".repeat(80));
  for (const f of inputs) {
    const label = labels[f.name] || "";
    const flags = [
      f.readonly ? "READONLY" : "",
      f.disabled ? "DISABLED" : "",
      f.checked ? "CHECKED" : "",
    ]
      .filter(Boolean)
      .join(",");
    console.log(
      `  [${f.type.padEnd(8)}] ${f.name.padEnd(35)} = "${f.value}"${flags ? " (" + flags + ")" : ""}${label ? "  ← " + label : ""}`
    );
  }

  console.log("\n📋 SELECTS (" + selects.length + "):");
  console.log("-".repeat(80));
  for (const f of selects) {
    const label = labels[f.name] || "";
    console.log(
      `  ${f.name.padEnd(35)} = "${f.value}" (${f.selectedText || "?"})${f.disabled ? " DISABLED" : ""}${label ? "  ← " + label : ""}`
    );
    // Show all options
    if (f.options && f.options.length <= 120) {
      for (const opt of f.options) {
        const sel = opt.selected ? " ✓" : "";
        console.log(
          `      ${opt.value.padEnd(8)} → ${opt.text}${sel}`
        );
      }
    } else if (f.options) {
      console.log(`      (${f.options.length} opciones — mostrando primeras 20)`);
      for (const opt of f.options.slice(0, 20)) {
        const sel = opt.selected ? " ✓" : "";
        console.log(
          `      ${opt.value.padEnd(8)} → ${opt.text}${sel}`
        );
      }
    }
  }

  if (textareas.length) {
    console.log("\n📋 TEXTAREAS (" + textareas.length + "):");
    console.log("-".repeat(80));
    for (const f of textareas) {
      console.log(`  ${f.name.padEnd(35)} = "${f.value.slice(0, 80)}"`);
    }
  }

  // Resumen de valores actuales (campos con valor)
  console.log("\n\n📊 VALORES ACTUALES (campos con datos):");
  console.log("=".repeat(80));
  for (const f of fields) {
    if (f.value && f.value !== "0" && f.value !== "0.00" && f.value !== "") {
      const label = labels[f.name] || "";
      if (f.type === "select") {
        console.log(
          `  ${f.name.padEnd(35)} = ${f.value} (${f.selectedText})${label ? "  ← " + label : ""}`
        );
      } else {
        console.log(
          `  ${f.name.padEnd(35)} = ${f.value}${label ? "  ← " + label : ""}`
        );
      }
    }
  }

  // JavaScript relevante (funciones del form)
  console.log("\n\n🔧 FUNCIONES JAVASCRIPT RELEVANTES:");
  console.log("=".repeat(80));
  const jsFns = html.match(/function\s+\w+\s*\([^)]*\)\s*\{[^}]{0,500}\}/g) || [];
  for (const fn of jsFns) {
    const fnName = (fn.match(/function\s+(\w+)/) || [])[1];
    if (fnName && /aceptar|validar|grabar|calcul|submit|guardar/i.test(fnName)) {
      console.log(`\n  ${fnName}():`);
      console.log("  " + fn.slice(0, 400).replace(/\n/g, "\n  "));
    }
  }

  // form action
  const formAction = (html.match(/<form[^>]*action\s*=\s*["']?([^"'\s>]*)/i) || [])[1];
  const formMethod = (html.match(/<form[^>]*method\s*=\s*["']?([^"'\s>]*)/i) || [])[1];
  console.log(`\n\n📤 FORM ACTION: ${formAction || "(vacío/mismo)"} | METHOD: ${formMethod || "GET"}`);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
