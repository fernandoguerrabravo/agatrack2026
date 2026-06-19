/**
 * Migración: Crear tablas para módulo de Consentimiento (Ley 21.719)
 *
 * Ejecutar: node scripts/crear-tablas-consentimiento.mjs
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Tabla de finalidades (propósitos del tratamiento de datos)
    await client.query(`
      CREATE TABLE IF NOT EXISTS finalidades (
        id SERIAL PRIMARY KEY,
        codigo TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        activa BOOLEAN DEFAULT true
      )
    `);

    // Tabla principal de consentimientos
    await client.query(`
      CREATE TABLE IF NOT EXISTS consentimientos (
        id SERIAL PRIMARY KEY,
        folio TEXT UNIQUE NOT NULL,
        titular_nombre_enc TEXT,
        titular_rut_enc TEXT,
        titular_rut_idx TEXT,
        titular_email_enc TEXT,
        finalidades_json TEXT,
        texto_version TEXT,
        contenido_hash TEXT,
        estado TEXT DEFAULT 'otorgado',
        ip_hash TEXT,
        user_agent TEXT,
        otorgado_en TIMESTAMP DEFAULT NOW(),
        revocado_en TIMESTAMP
      )
    `);

    // Cadena de bloques local (blockchain anchoring)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cadena (
        indice SERIAL PRIMARY KEY,
        evento TEXT,
        folio TEXT,
        contenido_hash TEXT,
        datos_json TEXT,
        prev_hash TEXT,
        hash TEXT UNIQUE,
        creado_en TEXT
      )
    `);

    // Tabla ARSOP (Acceso, Rectificación, Supresión, Oposición, Portabilidad)
    await client.query(`
      CREATE TABLE IF NOT EXISTS arsop (
        id SERIAL PRIMARY KEY,
        folio TEXT UNIQUE,
        tipo TEXT,
        titular_nombre_enc TEXT,
        titular_rut_enc TEXT,
        titular_rut_idx TEXT,
        titular_email_enc TEXT,
        detalle TEXT,
        canal TEXT,
        estado TEXT DEFAULT 'recibida',
        respuesta TEXT,
        ip_hash TEXT,
        creado_en TIMESTAMP DEFAULT NOW(),
        respondido_en TIMESTAMP
      )
    `);

    // Audit log
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        accion TEXT,
        entidad TEXT,
        entidad_id TEXT,
        actor TEXT,
        detalle TEXT,
        ip_hash TEXT,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);

    // Índices
    await client.query(`CREATE INDEX IF NOT EXISTS idx_consentimientos_rut ON consentimientos (titular_rut_idx)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_consentimientos_estado ON consentimientos (estado)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_arsop_rut ON arsop (titular_rut_idx)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cadena_folio ON cadena (folio)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_entidad ON audit_log (entidad, entidad_id)`);

    // Insertar finalidades por defecto (upsert)
    const finalidades = [
      {
        codigo: "gestion_aduanera",
        nombre: "Gestión Aduanera y Despachos",
        descripcion: "Procesamiento de declaraciones de importación/exportación",
      },
      {
        codigo: "comunicaciones_operativas",
        nombre: "Comunicaciones Operativas",
        descripcion: "Envío de emails de seguimiento, ETA, aprobaciones y notificaciones del despacho",
      },
      {
        codigo: "facturacion",
        nombre: "Facturación y Cobros",
        descripcion: "Emisión de facturas, notas de cobranza y gestión de pagos",
      },
      {
        codigo: "comunicaciones_comerciales",
        nombre: "Comunicaciones Comerciales",
        descripcion: "Envío de información comercial y ofertas de servicios",
      },
      {
        codigo: "cumplimiento_normativo",
        nombre: "Cumplimiento Normativo",
        descripcion: "Reportes a Aduana, SII, TGR y otras entidades regulatorias",
      },
      {
        codigo: "almacenamiento_documentos",
        nombre: "Almacenamiento de Documentos",
        descripcion: "Almacenamiento y procesamiento de documentos comerciales de importación/exportación",
      },
    ];

    for (const f of finalidades) {
      await client.query(
        `INSERT INTO finalidades (codigo, nombre, descripcion)
         VALUES ($1, $2, $3)
         ON CONFLICT (codigo) DO UPDATE SET nombre = $2, descripcion = $3`,
        [f.codigo, f.nombre, f.descripcion]
      );
    }

    await client.query("COMMIT");
    console.log("✅ Tablas de consentimiento creadas correctamente.");
    console.log("✅ Finalidades por defecto insertadas.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error en migración:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
