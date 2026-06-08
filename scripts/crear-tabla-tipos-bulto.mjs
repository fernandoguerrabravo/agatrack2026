#!/usr/bin/env node
/** Crea la tabla tipos_bulto en PostgreSQL con los códigos de AduanaNet/Aduana Chile */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");

const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

// Tabla de tipos de bulto — Anexo 51-23 Compendio Normas Aduaneras Chile
// Fuente: AduanaNet tabla tipo_bulto (67 registros)
const TIPOS_BULTO = [
  { codigo: "1", nombre: "POLVO", keywords: ["polvo", "powder"] },
  { codigo: "2", nombre: "GRANOS", keywords: ["granos", "grain", "granels"] },
  { codigo: "3", nombre: "NODULOS", keywords: ["nodulos", "nodules"] },
  { codigo: "4", nombre: "LIQUIDO", keywords: ["liquido", "liquid", "bulk liquid"] },
  { codigo: "5", nombre: "GAS", keywords: ["gas"] },
  { codigo: "10", nombre: "PIEZA", keywords: ["pieza", "piece", "unit"] },
  { codigo: "11", nombre: "TUBO", keywords: ["tubo", "tube", "pipe"] },
  { codigo: "12", nombre: "CILINDRO", keywords: ["cilindro", "cylinder"] },
  { codigo: "13", nombre: "ROLLO", keywords: ["rollo", "roll", "coil"] },
  { codigo: "16", nombre: "BARRA", keywords: ["barra", "bar", "rod"] },
  { codigo: "17", nombre: "LINGOTE", keywords: ["lingote", "ingot"] },
  { codigo: "18", nombre: "TRONCO", keywords: ["tronco", "log"] },
  { codigo: "19", nombre: "BLOQUE", keywords: ["bloque", "block"] },
  { codigo: "20", nombre: "ROLLIZO", keywords: ["rollizo"] },
  { codigo: "21", nombre: "CAJON", keywords: ["cajon", "crate"] },
  { codigo: "22", nombre: "CAJACARTON", keywords: ["caja carton", "carton", "cardboard box", "carton box", "ctns", "ctn"] },
  { codigo: "23", nombre: "FARDO", keywords: ["fardo", "bale"] },
  { codigo: "24", nombre: "BAUL", keywords: ["baul", "trunk"] },
  { codigo: "25", nombre: "COFRE", keywords: ["cofre", "chest"] },
  { codigo: "26", nombre: "ARMAZON", keywords: ["armazon", "frame", "rack"] },
  { codigo: "27", nombre: "BANDEJA", keywords: ["bandeja", "tray"] },
  { codigo: "28", nombre: "CAJAMADERA", keywords: ["caja madera", "wooden box", "wood case", "wooden case"] },
  { codigo: "29", nombre: "CAJALATA", keywords: ["caja lata", "tin box", "can"] },
  { codigo: "31", nombre: "BOTELLAGAS", keywords: ["botella gas", "gas bottle"] },
  { codigo: "32", nombre: "BOTELLA", keywords: ["botella", "bottle"] },
  { codigo: "33", nombre: "JAULA", keywords: ["jaula", "cage"] },
  { codigo: "34", nombre: "BIDON", keywords: ["bidon", "jerrycan", "jerry can"] },
  { codigo: "35", nombre: "JABA", keywords: ["jaba"] },
  { codigo: "36", nombre: "CESTA", keywords: ["cesta", "basket"] },
  { codigo: "37", nombre: "BARRILETE", keywords: ["barrilete", "keg"] },
  { codigo: "38", nombre: "TONEL", keywords: ["tonel", "cask", "hogshead"] },
  { codigo: "39", nombre: "PIPA", keywords: ["pipa", "pipe cask"] },
  { codigo: "40", nombre: "CAJANOESP", keywords: ["caja no especificada", "box"] },
  { codigo: "41", nombre: "JARRO", keywords: ["jarro", "jar", "jug"] },
  { codigo: "42", nombre: "FRASCO", keywords: ["frasco", "flask", "vial"] },
  { codigo: "43", nombre: "DAMAJUANA", keywords: ["damajuana", "demijohn"] },
  { codigo: "44", nombre: "BARRIL", keywords: ["barril", "barrel"] },
  { codigo: "45", nombre: "TAMBOR", keywords: ["tambor", "drum"] },
  { codigo: "46", nombre: "CUNETE", keywords: ["cunete", "pail", "bucket"] },
  { codigo: "47", nombre: "TARRO", keywords: ["tarro", "tin", "can"] },
  { codigo: "51", nombre: "CUBO", keywords: ["cubo", "cube"] },
  { codigo: "61", nombre: "PAQUETE", keywords: ["paquete", "package", "parcel", "pkg"] },
  { codigo: "62", nombre: "SACO", keywords: ["saco", "sack", "bag"] },
  { codigo: "63", nombre: "MALETA", keywords: ["maleta", "suitcase", "case"] },
  { codigo: "64", nombre: "BOLSA", keywords: ["bolsa", "bag", "pouch"] },
  { codigo: "65", nombre: "BALA", keywords: ["bala", "bale compressed"] },
  { codigo: "66", nombre: "RED", keywords: ["red", "net"] },
  { codigo: "67", nombre: "SOBRE", keywords: ["sobre", "envelope"] },
  { codigo: "73", nombre: "CONT20", keywords: ["contenedor 20", "container 20", "20ft", "20'"] },
  { codigo: "74", nombre: "CONT40", keywords: ["contenedor 40", "container 40", "40ft", "40'", "40' hc", "hc40"] },
  { codigo: "75", nombre: "REEFER20", keywords: ["reefer 20", "refrigerado 20"] },
  { codigo: "76", nombre: "REEFER40", keywords: ["reefer 40", "refrigerado 40"] },
  { codigo: "77", nombre: "ESTANQUE", keywords: ["estanque", "tank", "tanque", "isotank"] },
  { codigo: "78", nombre: "CONTNOESP", keywords: ["contenedor no especificado", "container"] },
  { codigo: "80", nombre: "PALLET", keywords: ["pallet", "paleta", "pallets", "plt", "plts"] },
  { codigo: "81", nombre: "TABLERO", keywords: ["tablero", "board", "panel"] },
  { codigo: "82", nombre: "LAMINA", keywords: ["lamina", "sheet", "plate"] },
  { codigo: "83", nombre: "CARRETE", keywords: ["carrete", "reel", "spool", "bobbin"] },
  { codigo: "85", nombre: "AUTOMOTOR", keywords: ["automotor", "vehicle", "auto", "vehiculo"] },
  { codigo: "86", nombre: "ATAUD", keywords: ["ataud", "coffin"] },
  { codigo: "88", nombre: "MAQUINARIA", keywords: ["maquinaria", "machinery", "machine"] },
  { codigo: "89", nombre: "PLANCHA", keywords: ["plancha", "slab"] },
  { codigo: "90", nombre: "ATADO", keywords: ["atado", "bundle"] },
  { codigo: "91", nombre: "BOBINA", keywords: ["bobina", "coil", "reel"] },
  { codigo: "93", nombre: "BULTONOESP", keywords: ["bulto no especificado", "octabin", "octabins", "ibc", "big bag", "bigbag", "supersack", "jumbo bag", "fibc", "flexitank"] },
  { codigo: "98", nombre: "SIN BULTO", keywords: ["sin bulto", "no package", "unpackaged"] },
  { codigo: "99", nombre: "S/EMBALAR", keywords: ["sin embalar", "sin embalaje", "unpacked", "loose"] },
];

(async () => {
  console.log("=== Crear tabla tipos_bulto ===\n");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tipos_bulto (
      codigo VARCHAR(3) PRIMARY KEY,
      nombre VARCHAR(50) NOT NULL,
      keywords TEXT[] DEFAULT '{}'
    )
  `);
  console.log("✅ Tabla creada/verificada");

  // Insertar/actualizar datos
  let inserted = 0;
  for (const tb of TIPOS_BULTO) {
    await pool.query(
      `INSERT INTO tipos_bulto (codigo, nombre, keywords) VALUES ($1, $2, $3)
       ON CONFLICT (codigo) DO UPDATE SET nombre = $2, keywords = $3`,
      [tb.codigo, tb.nombre, tb.keywords]
    );
    inserted++;
  }
  console.log(`✅ ${inserted} tipos de bulto insertados/actualizados`);

  // Verificar
  const res = await pool.query("SELECT COUNT(*) as total FROM tipos_bulto");
  console.log(`\nTotal en tabla: ${res.rows[0].total}`);

  // Mostrar algunos relevantes
  const check = await pool.query("SELECT * FROM tipos_bulto WHERE codigo IN ('80', '93', '74', '22', '62', '45') ORDER BY codigo::int");
  console.log("\nVerificación:");
  check.rows.forEach(r => console.log(`  ${r.codigo} = ${r.nombre} [${r.keywords.join(", ")}]`));

  await pool.end();
  console.log("\n✅ Listo.");
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
