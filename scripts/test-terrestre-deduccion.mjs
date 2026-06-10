/**
 * Test: Calcula la deducción del tramo nacional para operación 190321
 * Origen: ALFONSIN SN 0 - SAN MIGUEL DEL MONTE (7220) - Argentina
 * Destino: PLANT B209 AVENIDA MARTA OSSA RUIZ NO 601 9250000 MAIPU CHILE
 * Flete: 3200 USD
 */
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envContent = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const origenDir = "BAHIA BLANCA, Argentina"; // Puerto de embarque (aduana partida MIC)
const destinoDir = "PLANT B209 AVENIDA MARTA OSSA RUIZ NO 601 9250000 MAIPU CHILE";
const flete = 3200;

console.log("=== Test Deducción Tramo Nacional ===");
console.log("Origen:", origenDir);
console.log("Destino:", destinoDir);
console.log("Flete:", flete, "USD");
console.log("");

try {
  const result = await generateText({
    model: openai("gpt-4o-mini"),
    maxOutputTokens: 100,
    messages: [{ role: "user", content: `¿Cuál es la distancia aproximada en kilómetros POR CARRETERA (ruta terrestre, no línea recta) entre "${origenDir}" y "${destinoDir}"? Considera que la ruta cruza la cordillera de los Andes por el paso Los Libertadores/Cristo Redentor. Responde SOLO con el número de kilómetros (sin texto adicional, sin "km"). Ejemplo: 1450` }],
  });

  console.log("Respuesta IA:", result.text);
  const kmStr = result.text.replace(/[^0-9]/g, "");
  const km = parseInt(kmStr) || 0;
  console.log("KM extraídos:", km);

  // Tabla de porcentajes
  let porcentaje = 14;
  if (km > 3300) porcentaje = 7;
  else if (km > 3000) porcentaje = 8;
  else if (km > 2600) porcentaje = 9;
  else if (km > 2300) porcentaje = 10;
  else if (km > 2000) porcentaje = 11;
  else if (km > 1600) porcentaje = 12;
  else if (km > 1300) porcentaje = 13;
  else porcentaje = 14;

  const deduccion = Math.round(flete * porcentaje / 100 * 100) / 100;

  console.log("\n📊 Resultado:");
  console.log("  Distancia:", km, "km");
  console.log("  Porcentaje:", porcentaje + "%");
  console.log("  Deducción:", deduccion, "USD");
  console.log("  (flete", flete, "×", porcentaje + "% =", deduccion + ")");
} catch (err) {
  console.error("❌ Error:", err.message || err);
}
