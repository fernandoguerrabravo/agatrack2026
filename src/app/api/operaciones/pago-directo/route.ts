import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { aduananetBrowserLogin } from "@/lib/aduananet-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * POST /api/operaciones/pago-directo
 * Body: { nro_operacion: string }
 * 
 * Crea el pago directo en AduanaNet usando Puppeteer:
 * 1. Navega a lista.php → click "Nuevo" → formulario
 * 2. Ingresa nro operación en campo despacho → click Ingresar
 * 3. Busca el comprobante en la lista filtrada → obtiene link PDF
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    const inboundSecret = request.headers.get("x-inbound-secret");
    if (!inboundSecret || inboundSecret !== process.env.INBOUND_SECRET) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  try {
    const { browser, page } = await aduananetBrowserLogin();

    try {
      // Helper: consulta datos_nid_pd.php para saber si el pago directo YA existe.
      // AduanaNet (actualización jul-2026) responde una página que, si el comprobante
      // ya está creado, invoca ya_existe('agno','mes','tipo','corr'); si el despacho es
      // válido para crear, invoca seleccion(...) con los datos a cargar en el formulario.
      const consultarComprobante = async (): Promise<{ agno: string; mes: string; tipo: string; corr: string } | null> => {
        return await page.evaluate(async (op) => {
          try {
            const r = await fetch(`/modulos/general/ventanas/destellantes/datos_nid_pd.php?identificador=1&valor=${op}`, { credentials: "include" });
            const t = await r.text();
            // La invocación real ya_existe('2026','6','E','487922') lleva comillas;
            // la definición de la función usa parámetros sin comillas, así que este
            // patrón solo captura la invocación (comprobante ya creado).
            const m = t.match(/ya_existe\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'([^']+)'\s*,\s*'(\d+)'\s*\)/);
            if (m) return { agno: m[1], mes: m[2], tipo: m[3], corr: m[4] };
            return null;
          } catch { return null; }
        }, nro_operacion);
      };

      // 1. ¿Ya existe el pago directo para este despacho?
      let comp = await consultarComprobante();
      const yaExiste = !!comp;

      if (!comp) {
        // 2. No existe → crearlo.
        // 2a. Abrir formulario "Nuevo"
        await page.goto(`${BASE_URL}/modulos/contabilidad/pago_directo/lista.php`, { waitUntil: "networkidle0" });
        await page.evaluate(() => { (window as unknown as Record<string, () => void>).nuevo(); });
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});

        // 2b. Fecha de pago desde el PDF TGR
        const opRows = await pgQuery<{ notas: string }>(
          "SELECT notas FROM operaciones WHERE nro_operacion = $1",
          [nro_operacion]
        );
        const tgrUrlMatch = (opRows[0]?.notas || "").match(/tgr_url:(https?:\/\/[^\s\n]+)/);
        const tgrUrl = tgrUrlMatch ? tgrUrlMatch[1] : "";
        let fechaPago = "";
        if (tgrUrl) {
          try {
            const pdfRes = await fetch(tgrUrl);
            if (pdfRes.ok) {
              const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
              const pdfParse = require("pdf-parse");
              const pdfData = await pdfParse(pdfBuffer);
              const text = pdfData.text || "";
              const fechaPagoMatch = text.match(/Fecha\s*Pago\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
              if (fechaPagoMatch) {
                fechaPago = `${fechaPagoMatch[1]}/${fechaPagoMatch[2]}/${fechaPagoMatch[3]}`;
              } else {
                const allFechas = text.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g) || [];
                const pick = allFechas.length >= 2 ? allFechas[1] : allFechas[0];
                const parts = pick ? pick.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/) : null;
                if (parts) fechaPago = `${parts[1]}/${parts[2]}/${parts[3]}`;
              }
            }
          } catch (pdfErr) {
            console.error("[pago-directo] Error leyendo PDF TGR:", pdfErr instanceof Error ? pdfErr.message : pdfErr);
          }
        }
        if (!fechaPago) {
          const hoy = new Date();
          fechaPago = `${String(hoy.getDate()).padStart(2, "0")}/${String(hoy.getMonth() + 1).padStart(2, "0")}/${hoy.getFullYear()}`;
        }

        // 2c. Interceptar alerts/confirm
        await page.evaluate(() => {
          (window as unknown as Record<string, string>).__lastAlert = "";
          window.alert = (msg: string) => { (window as unknown as Record<string, string>).__lastAlert = msg; };
          window.confirm = () => true;
        });

        // 2d. Fecha de pago
        const fechaInput = await page.$('input[name="cmp_fecha"]');
        if (fechaInput) { await fechaInput.click({ count: 3 }); await fechaInput.type(fechaPago); }

        // 2e. Despacho + Tab (dispara onblur open_datos_nid_pd que puebla cli/dus_*)
        const libNidInput = await page.$('input[name="lib_nid"]');
        if (libNidInput) {
          await libNidInput.click({ count: 3 });
          await libNidInput.type(nro_operacion);
          await page.keyboard.press("Tab");
          await new Promise(r => setTimeout(r, 3500));
        }

        console.log(`[pago-directo] Creando op=${nro_operacion} fecha=${fechaPago}`);

        // 2f. Guardar
        const ingresarBtn = await page.$('input[name="btnGuardar"]') || await page.$('input[value*="ngresar"]');
        if (ingresarBtn) {
          await ingresarBtn.click();
        } else {
          await page.evaluate(() => {
            const form = (document as unknown as Record<string, HTMLFormElement>).frmEditar;
            if (typeof (window as unknown as Record<string, (f: HTMLFormElement) => boolean>).validaForm === "function") {
              (window as unknown as Record<string, (f: HTMLFormElement) => boolean>).validaForm(form);
            }
          });
        }
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));

        // 2g. Reconsultar para obtener los parámetros del comprobante recién creado
        comp = await consultarComprobante();
      } else {
        console.log(`[pago-directo] Ya existía para op ${nro_operacion}: ${comp.agno}/${comp.mes}/${comp.tipo}/${comp.corr}`);
      }

      // 3. Construir URL del PDF del comprobante
      let pdfUrl = "";
      if (comp) {
        pdfUrl = `${BASE_URL}/modulos/contabilidad/comprobante/imprimir_pdf.php?cmp_agno=${comp.agno}&cmp_mes=${comp.mes}&cmp_tipo_c=${comp.tipo}&cmp_correlativo=${comp.corr}`;
        console.log(`[pago-directo] ✅ PDF: agno=${comp.agno} mes=${comp.mes} tipo=${comp.tipo} corr=${comp.corr}`);
      } else {
        console.log(`[pago-directo] No se pudo obtener comprobante para op ${nro_operacion}`);
      }

      await browser.close();

      // 8. Guardar
      const drRows = await pgQuery<{ rut_cliente: string }>(
        "SELECT rut_cliente FROM despachos_replica WHERE despacho = $1 LIMIT 1",
        [nro_operacion]
      );
      const rutCliente = drRows[0]?.rut_cliente || "";
      await pgQuery(
        "INSERT INTO operaciones (nro_operacion, rut_cliente, estado) VALUES ($1, $2, 'aprobada') ON CONFLICT (nro_operacion) DO NOTHING",
        [nro_operacion, rutCliente]
      );

      // Guardar flag de pago directo (con o sin PDF URL)
      const pago_directo_value = pdfUrl || `${BASE_URL}/modulos/contabilidad/pago_directo/lista.php`;
      const opCheck = await pgQuery<{ notas: string }>("SELECT notas FROM operaciones WHERE nro_operacion = $1", [nro_operacion]);
      const notasActuales = opCheck[0]?.notas || "";
      const tieneReal = /pago_directo_url:https?:\/\/[^\s\n]*imprimir_pdf\.php/.test(notasActuales);
      if (pdfUrl) {
        // Tenemos URL real del comprobante: reemplazar cualquier pago_directo_url previo.
        const notasLimpias = notasActuales.split("\n").filter(l => !l.startsWith("pago_directo_url:")).join("\n").replace(/\n{2,}/g, "\n");
        await pgQuery(
          "UPDATE operaciones SET notas = $1, updated_at = NOW() WHERE nro_operacion = $2",
          [`${notasLimpias}\npago_directo_url:${pago_directo_value}`.trim(), nro_operacion]
        );
      } else if (!notasActuales.includes("pago_directo_url:") && !tieneReal) {
        // Sin URL real y sin registro previo: guardar fallback.
        await pgQuery(
          "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
          [`\npago_directo_url:${pago_directo_value}`, nro_operacion]
        );
      }

      return NextResponse.json({ ok: true, pdf_url: pago_directo_value, ya_existia: yaExiste });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[pago-directo] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
