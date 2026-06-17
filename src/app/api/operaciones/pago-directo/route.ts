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
      // 1. Ir a la lista de pago directo
      await page.goto(`${BASE_URL}/modulos/contabilidad/pago_directo/lista.php`, { waitUntil: "networkidle0" });

      // 2. Click en "Nuevo" — ejecutar función nuevo() de la página
      await page.evaluate(() => { (window as unknown as Record<string, () => void>).nuevo(); });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});

      // 3. Obtener fecha de pago del PDF TGR
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
            // Buscar "Fecha Pago" seguido de una fecha dd-mm-yyyy o dd/mm/yyyy
            const fechaPagoMatch = text.match(/Fecha\s*Pago\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
            if (fechaPagoMatch) {
              fechaPago = `${fechaPagoMatch[1]}/${fechaPagoMatch[2]}/${fechaPagoMatch[3]}`;
            } else {
              // Fallback: segunda fecha (la primera suele ser vencimiento)
              const allFechas = text.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g) || [];
              if (allFechas.length >= 2) {
                const parts = allFechas[1].match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
                if (parts) fechaPago = `${parts[1]}/${parts[2]}/${parts[3]}`;
              } else if (allFechas.length === 1) {
                const parts = allFechas[0].match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
                if (parts) fechaPago = `${parts[1]}/${parts[2]}/${parts[3]}`;
              }
            }
          }
        } catch (pdfErr) {
          console.error("[pago-directo] Error leyendo PDF TGR:", pdfErr instanceof Error ? pdfErr.message : pdfErr);
        }
      }
      if (!fechaPago) {
        // Fallback: fecha de hoy
        const hoy = new Date();
        fechaPago = `${String(hoy.getDate()).padStart(2, "0")}/${String(hoy.getMonth() + 1).padStart(2, "0")}/${hoy.getFullYear()}`;
      }

      // 4. Ingresar fecha y despacho con Tab
      // Interceptar alerts y confirm
      await page.evaluate(() => {
        (window as unknown as Record<string, string>).__lastAlert = "";
        window.alert = (msg: string) => { (window as unknown as Record<string, string>).__lastAlert = msg; };
        window.confirm = () => true; // Auto-aceptar confirms
      });

      // Campo cmp_fecha (fecha de pago)
      const fechaInput = await page.$('input[name="cmp_fecha"]');
      if (fechaInput) {
        await fechaInput.click({ count: 3 });
        await fechaInput.type(fechaPago);
      }

      // Campo lib_nid (despacho) + Tab
      const libNidInput = await page.$('input[name="lib_nid"]');
      if (libNidInput) {
        await libNidInput.click({ count: 3 });
        await libNidInput.type(nro_operacion);
        await page.keyboard.press("Tab");
        // Esperar que onblur cargue datos
        await new Promise(r => setTimeout(r, 3000));
      }

      console.log(`[pago-directo] Op=${nro_operacion} fecha=${fechaPago}`);

      // 5. Click Ingresar via validaForm + aceptar dialogs
      // Override confirm para aceptar el sweet alert
      await page.evaluate(() => {
        window.confirm = () => true;
      });

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

      // 5. Verificar resultado
      const alertMsg = await page.evaluate(() => (window as unknown as Record<string, string>).__lastAlert || "");
      const bodyText = await page.evaluate(() => document.body.innerText?.substring(0, 500) || "");
      const yaExiste = (alertMsg + bodyText).toLowerCase().includes("ya fue") || 
                       (alertMsg + bodyText).toLowerCase().includes("ya existe") ||
                       (alertMsg + bodyText).toLowerCase().includes("ya se encuentra");

      if (yaExiste) {
        console.log(`[pago-directo] Ya existe para op ${nro_operacion}: "${alertMsg}"`);
      } else {
        console.log(`[pago-directo] Creado para op ${nro_operacion}${alertMsg ? " (alert: " + alertMsg + ")" : ""}`);
      }

      // 6. Ir a la lista y filtrar por despacho
      await page.goto(`${BASE_URL}/modulos/contabilidad/pago_directo/lista.php`, { waitUntil: "networkidle0" });
      const filInput = await page.$('input[name="fil_lib_nid"]');
      if (filInput) {
        await filInput.evaluate(el => (el as HTMLInputElement).value = "");
        await filInput.type(nro_operacion);
        // Click filtrar via filtrarLista()
        await page.evaluate(() => {
          if (typeof (window as unknown as Record<string, () => void>).filtrarLista === "function") {
            (window as unknown as Record<string, () => void>).filtrarLista();
          }
        });
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      }

      // 7. Extraer parámetros del comprobante desde la función ver('año','mes','tipo','correlativo')
      const pageHtml = await page.content();
      const verMatch = pageHtml.match(/ver\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'(\w+)'\s*,\s*'(\d+)'\s*\)/);
      let pdfUrl = "";
      if (verMatch) {
        const [, agno, mes, tipo, correlativo] = verMatch;
        pdfUrl = `${BASE_URL}/modulos/contabilidad/comprobante/imprimir_pdf.php?cmp_agno=${agno}&cmp_mes=${mes}&cmp_tipo_c=${tipo}&cmp_correlativo=${correlativo}`;
        console.log(`[pago-directo] ✅ PDF: agno=${agno} mes=${mes} tipo=${tipo} corr=${correlativo}`);
      } else {
        console.log(`[pago-directo] No se encontró comprobante en lista para op ${nro_operacion}`);
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

      // Guardar flag de pago directo creado (con o sin PDF URL)
      const pago_directo_value = pdfUrl || `${BASE_URL}/modulos/contabilidad/pago_directo/lista.php`;
      // Solo guardar si no tenía ya pago_directo_url
      const opCheck = await pgQuery<{ notas: string }>("SELECT notas FROM operaciones WHERE nro_operacion = $1", [nro_operacion]);
      if (!(opCheck[0]?.notas || "").includes("pago_directo_url:")) {
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
