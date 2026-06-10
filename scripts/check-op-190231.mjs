import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const url = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const docs = await pool.query("SELECT id, tipo_documento, datos_extraidos FROM documentos WHERE nro_operacion = '190231' ORDER BY tipo_documento");
console.log("=== Documentos operación 190231 ===");
console.log("Total:", docs.rows.length);

for (const doc of docs.rows) {
  const d = typeof doc.datos_extraidos === "string" ? JSON.parse(doc.datos_extraidos) : doc.datos_extraidos;
  console.log(`\n--- ${doc.tipo_documento} (id=${doc.id}) ---`);
  
  if (doc.tipo_documento === "Carta de Porte Internacional (CRT)" || doc.tipo_documento === "MIC/DTA") {
    console.log("  nro_documento:", d.numero_documento || d.nro_documento || d.numero_carta_porte || d.numero);
    console.log("  fecha_emision:", d.fecha_emision || d.fecha);
    console.log("  transportista:", d.transportista || d.nombre_transportador || d.portador);
    console.log("  remitente:", JSON.stringify(d.remitente || d.exportador));
    console.log("  destinatario:", JSON.stringify(d.destinatario || d.consignatario));
    console.log("  origen:", d.origen || d.lugar_origen || d.aduana_origen || d.pais_origen);
    console.log("  destino:", d.destino || d.aduana_destino);
    console.log("  camion:", d.camion || d.placa_camion || d.vehiculo);
    console.log("  conductor:", d.conductor || d.nombre_conductor);
    console.log("  bultos:", d.total_bultos || d.cantidad_bultos);
    console.log("  tipo_bulto:", d.tipo_bulto || d.tipo_embalaje);
    console.log("  peso_bruto:", d.peso_bruto || d.peso_bruto_total);
    console.log("  flete:", d.flete || d.flete_total || d.valor_flete);
    console.log("  valor:", d.valor || d.valor_mercancia || d.valor_fob);
    console.log("  precintos:", d.precintos || d.numero_precintos);
    console.log("  incoterm:", d.incoterm);
    console.log("  nro_manifiesto:", d.nro_manifiesto || d.doc_transporte_manifiesto);
  } else if (doc.tipo_documento === "Invoice (Factura Comercial)") {
    console.log("  numero_factura:", d.numero_factura);
    console.log("  monto_total:", d.monto_total);
    console.log("  incoterm:", d.incoterm);
    console.log("  customer_order:", d.customer_order_number || d.orden_compra);
    console.log("  pais_origen:", d.pais_origen);
    console.log("  items:", (d.items || []).length, "items");
    if (d.items?.[0]) console.log("  item1:", JSON.stringify(d.items[0]).substring(0, 150));
  } else if (doc.tipo_documento === "Póliza de Seguro") {
    console.log("  prima:", d.prima);
    console.log("  monto_asegurado:", d.monto_asegurado);
  } else {
    // Mostrar keys principales
    const keys = Object.keys(d).filter(k => !k.startsWith("_")).slice(0, 15);
    console.log("  keys:", keys.join(", "));
  }
}

await pool.end();
