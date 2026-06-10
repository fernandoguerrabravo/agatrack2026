import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { aduananetLogin } from "@/lib/aduananet";
import { clientesVisibles } from "@/lib/permisos";
import { pgQuery } from "@/lib/postgres";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * Mapeo de puerto de desembarque → código de aduana en AduanaNet.
 */
const PUERTO_ADUANA_MAP: Record<string, string> = {
  "SAN ANTONIO": "39",
  "VALPARAISO": "34",
  "VALPARAÍSO": "34",
  "TALCAHUANO": "55",
  "SAN VICENTE": "55",
  "ARICA": "3",
  "IQUIQUE": "7",
  "TOCOPILLA": "10",
  "ANTOFAGASTA": "14",
  "COQUIMBO": "25",
  "LA SERENA": "25",
  "LOS ANDES": "33",
  "SANTIAGO": "48",
  "METROPOLITANA": "48",
  "CONCEPCION": "55",
  "CORONEL": "55",
  "TEMUCO": "56",
  "OSORNO": "67",
  "PUERTO MONTT": "69",
  "COYHAIQUE": "83",
  "PUNTA ARENAS": "92",
};

function resolverAduana(puertoDesembarque: string): string {
  if (!puertoDesembarque) return "39"; // default SAN ANTONIO
  const puerto = puertoDesembarque.toUpperCase().trim();
  // Buscar coincidencia exacta primero
  if (PUERTO_ADUANA_MAP[puerto]) return PUERTO_ADUANA_MAP[puerto];
  // Buscar parcial
  for (const [key, val] of Object.entries(PUERTO_ADUANA_MAP)) {
    if (puerto.includes(key) || key.includes(puerto)) return val;
  }
  return "39"; // default SAN ANTONIO
}

/**
 * POST /api/aduananet-operaciones — Crear nueva operación (carpeta) en AduanaNet
 * 
 * Body: {
 *   cli_id: string,           // ID del cliente en AduanaNet (ej: "2710")
 *   rut_cliente: string,      // RUT del cliente para nuestra BD
 *   referencia?: string,      // Referencia (ej: "PO-12345")
 *   puerto_desembarque?: string, // Para determinar la aduana
 *   tio_id?: string,          // Tipo operación (default: "101" = IMPORT. CTDO/NORMAL)
 *   ejecutivo_id?: string,    // ID del ejecutivo asignado
 * }
 * 
 * Returns: { ok: true, nro_operacion: "190311", orc_id: "33625" }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    // Permitir acceso via inbound_secret (para webhook de email inbound)
    const inboundSecret = request.headers.get("x-inbound-secret");
    if (!inboundSecret || inboundSecret !== process.env.INBOUND_SECRET) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  } else {
    // Solo ejecutivos/admin pueden crear operaciones
    if (session.rol === "cliente") {
      return NextResponse.json({ error: "Sin permisos para crear operaciones." }, { status: 403 });
    }
  }

  const body = await request.json();
  const { cli_id, rut_cliente, referencia, puerto_desembarque, tio_id, ejecutivo_id } = body;

  if (!cli_id) {
    return NextResponse.json({ error: "cli_id (cliente AduanaNet) requerido." }, { status: 400 });
  }

  const aduId = resolverAduana(puerto_desembarque || "");
  // Generar referencia única para poder buscar esta operación exacta después
  const refUnica = referencia || `AGT-${Date.now().toString(36).toUpperCase()}`;

  try {
    const cookies = await aduananetLogin();

    // POST a grabar.php para crear la carpeta
    const grabarBody = new URLSearchParams();
    grabarBody.set("accion", "N");
    grabarBody.set("cli_id", cli_id);
    grabarBody.set("txt_cli_id", "");
    grabarBody.set("orc_tio", "DIN");
    grabarBody.set("tipo_doc", "IMPO");
    grabarBody.set("tio_id", tio_id || "101");
    grabarBody.set("sel_tio_id", tio_id || "101");
    grabarBody.set("emp_id", "C69"); // Fernando Guerra Godoy
    grabarBody.set("sel_emp_id", "C69");
    grabarBody.set("ejecutivo_id", ejecutivo_id || "");
    grabarBody.set("sel_ejecutivo_id", ejecutivo_id || "");
    grabarBody.set("adu_id", aduId);
    grabarBody.set("sel_adu_id", aduId);
    grabarBody.set("fpa_id", "");
    grabarBody.set("sel_fpa_id", "");
    grabarBody.set("mon_id", "13"); // USD
    grabarBody.set("sel_mon_id", "13");
    grabarBody.set("cvt_id", "");
    grabarBody.set("sel_cvt_id", "");
    grabarBody.set("reg_id", "");
    grabarBody.set("sel_reg_id", "");
    grabarBody.set("sel_tna_id", "");
    grabarBody.set("nro_libro", "");
    grabarBody.set("orc_referencia", refUnica);
    grabarBody.set("orc_bodega", "");
    grabarBody.set("usua_id", "100");
    grabarBody.set("lineas", "0");
    grabarBody.set("ineditable", "false");
    grabarBody.set("generar_despacho", "1");
    grabarBody.set("email", "1");

    const grabarRes = await fetch(`${BASE_URL}/modulos/comex/orden_compra/grabar.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookies,
        "Referer": `${BASE_URL}/modulos/comex/orden_compra/formulario.php`,
      },
      body: grabarBody.toString(),
      redirect: "manual",
    });

    // Después de crear, buscar por el orc_id generado.
    // Obtenemos el listado filtrado por cli_id y buscamos el orc_id más alto (el recién creado).
    const filterBody = new URLSearchParams();
    filterBody.set("accion", "F");
    filterBody.set("fil_cli_id", cli_id);

    const listaRes = await fetch(`${BASE_URL}/modulos/comex/orden_compra/lista.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
      body: filterBody.toString(),
    });
    const listaHtml = await listaRes.text();

    // Extraer todos los orc_id del listado y tomar el máximo (el más reciente)
    const allOrcIds = [...listaHtml.matchAll(/agregar\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
    const maxOrcId = allOrcIds.length > 0 ? Math.max(...allOrcIds) : 0;

    let nroOperacion = "";
    let orcId = maxOrcId ? String(maxOrcId) : "";

    // Buscar por fil_orc_id del máximo para obtener el lib_nid exacto
    if (maxOrcId) {
      const filter2 = new URLSearchParams();
      filter2.set("accion", "F");
      filter2.set("fil_orc_id", String(maxOrcId));
      const res2 = await fetch(`${BASE_URL}/modulos/comex/orden_compra/lista.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
        body: filter2.toString(),
      });
      const html2 = await res2.text();
      const libNidLink = html2.match(/lib_nid=(\d+)/);
      if (libNidLink) {
        nroOperacion = libNidLink[1];
      }
    }

    // Si no encontramos lib_nid, la carpeta se creó pero aún no tiene despacho
    // En ese caso usamos el orc_id como referencia temporal
    if (!nroOperacion && orcId) {
      // La operación se creó pero el nro_operacion (lib_nid) se genera al crear el DIN
      // Por ahora guardamos con el orc_id como identificador
      console.log(`[aduananet-ops] Carpeta creada orc_id=${orcId}, sin lib_nid aún`);
    }

    // Guardar en nuestra BD si tenemos nro_operacion
    if (nroOperacion && rut_cliente) {
      await pgQuery(
        `INSERT INTO operaciones (nro_operacion, rut_cliente, estado, notas)
         VALUES ($1, $2, 'abierta', $3)
         ON CONFLICT (nro_operacion) DO NOTHING`,
        [nroOperacion, rut_cliente, `ref: ${referencia || ""}`]
      );

      // Enviar email de notificación de nuevo despacho
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const CONTACTOS_PROVISION = [
          "BARomanini@dow.com",
          "HZachariotto@dow.com",
          "LNuez@dow.com",
          "MLIbarraRocha@dow.com",
          "jfernandez@agenciaguerra.com",
          "losandes@agenciaguerra.com",
          "hector@agenciaguerra.com",
          "boris@agenciaguerra.com",
          "bdpcl.dow@bdpint.com",
          "isabel.riveros@psabdp.com",
          "roberto.santibanez@psabdp.com",
          "sara.arcos@psabdp.com",
          "bastian.monsalve@agenciaguerra.com",
          "ehenriquez@agenciaguerra.com",
          "fguerrab@agenciaguerra.com",
        ];
        await resend.emails.send({
          from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.agenciaguerra.com>",
          to: CONTACTOS_PROVISION,
          subject: `Nuevo Despacho ${nroOperacion} - REF: ${referencia || "S/R"}`,
          html: `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Se ha creado un nuevo despacho en AduanaNet:</p>
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;width:180px;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;">${nroOperacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia || "S/R"}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Puerto Desembarque</td><td style="padding:8px 12px;border:1px solid #ddd;">${puerto_desembarque || "SAN ANTONIO"}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Aduana</td><td style="padding:8px 12px;border:1px solid #ddd;">${aduId}</td></tr>
  </table>
  <p style="color:#666;font-size:12px;">Este correo fue generado automáticamente por AgaTrack.</p>
</div>`,
        });
        console.log(`[aduananet-ops] Email notificación enviado para op ${nroOperacion}`);
      } catch (emailErr) {
        console.error("[aduananet-ops] Error enviando email:", emailErr instanceof Error ? emailErr.message : emailErr);
      }
    }

    return NextResponse.json({
      ok: true,
      nro_operacion: nroOperacion || null,
      orc_id: orcId || null,
      aduana: aduId,
      mensaje: nroOperacion
        ? `Operación ${nroOperacion} creada exitosamente`
        : `Carpeta creada (orc_id: ${orcId}). El nro de operación se asignará al crear el DIN.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[aduananet-ops] Error creando operación:", msg);
    return NextResponse.json({ error: `Error al crear operación: ${msg}` }, { status: 500 });
  }
}

/**
 * GET /api/aduananet-operaciones — Listar operaciones recientes desde AduanaNet
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (session.rol === "cliente") {
    return NextResponse.json({ error: "Sin permisos." }, { status: 403 });
  }

  try {
    const cookies = await aduananetLogin();
    const listaHtml = await (await fetch(`${BASE_URL}/modulos/comex/orden_compra/lista.php`, {
      headers: { Cookie: cookies },
    })).text();

    const operaciones: Array<{
      orc_id: string;
      nro_operacion: string;
      fecha: string;
      cli_id: string;
      cliente: string;
      referencia: string;
    }> = [];

    const rows = [...listaHtml.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (const row of rows.slice(0, 30)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
        c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
      );
      const agregarMatch = row[1].match(/agregar\(\s*['"]?(\d+)['"]?\s*\)/);
      const orcId = agregarMatch ? agregarMatch[1] : "";

      if (cells.length >= 4 && orcId) {
        const fecha = cells[0] || "";
        const cliId = cells[1] || "";
        const cliente = cells[2] || "";
        // lib_nid puede estar en cells[3] o cells[4]
        let nroOp = "";
        let referencia = "";
        for (const cell of cells.slice(3)) {
          if (/^\d{5,7}$/.test(cell) && (cell.startsWith("19") || cell.startsWith("20"))) {
            nroOp = cell;
          } else if (cell && !nroOp) {
            referencia = cell;
          } else if (cell && nroOp && !referencia) {
            referencia = cell;
          }
        }

        operaciones.push({ orc_id: orcId, nro_operacion: nroOp, fecha, cli_id: cliId, cliente, referencia });
      }
    }

    return NextResponse.json({ operaciones });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
