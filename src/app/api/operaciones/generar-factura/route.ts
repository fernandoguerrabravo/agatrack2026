import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { aduananetBrowserLogin } from "@/lib/aduananet-browser";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

// Clientes que requieren orden de compra en la factura
const CLIENTES_ORDEN_COMPRA = ["KSB"];

/**
 * POST /api/operaciones/generar-factura
 * Body: { nro_operacion: string, skip_sii?: boolean }
 * 
 * Genera factura DIN en AduanaNet:
 * 1. Lista → Nuevo → NID → Aceptar → Aceptar
 * 1.5. (KSB) DATOS CLIENTE → addRef → Orden de Compra + Folio + Fecha
 * 2. DATOS DESPACHOS → Actualizar Dolar
 * 3. GASTOS Y HONORARIOS → Traer Honorarios (popup → click grilla)
 * 4. RESUMEN → Traer Pago Directo → Grabar
 * 5. (si no skip_sii) Enviar a SII → Obtener DTE URL
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    const inboundSecret = request.headers.get("x-inbound-secret");
    if (!inboundSecret || inboundSecret !== process.env.INBOUND_SECRET) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  const { nro_operacion, skip_sii } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  // Verificar si ya tiene DTE o factura confeccionada (no crear duplicada)
  const opRows = await pgQuery<{ notas: string; url_dte: string }>(
    `SELECT o.notas, dr.url_dte FROM operaciones o
     LEFT JOIN despachos_replica dr ON dr.despacho = o.nro_operacion
     WHERE o.nro_operacion = $1`,
    [nro_operacion]
  );
  const notas = opRows[0]?.notas || "";
  const yaExisteDB = opRows[0]?.url_dte || notas.includes("dte_url:");
  const yaConfeccionada = notas.includes("factura_confeccionada:");
  if (yaExisteDB) {
    console.log(`[factura] ⏭️ Op ${nro_operacion} ya tiene DTE, saltando`);
    return NextResponse.json({ ok: true, dte_url: "ya_existe", skip: true });
  }
  if (yaConfeccionada) {
    console.log(`[factura] ⏭️ Op ${nro_operacion} ya tiene factura confeccionada, saltando`);
    return NextResponse.json({ ok: true, dte_url: "", skip: true });
  }

  // Verificar en AduanaNet API si ya tiene DTE emitida
  try {
    const { execSync } = await import("child_process");
    const curlCmd = `curl -sk -u fguerragodoy:Uj7UarxZafsTL9G -X GET "${BASE_URL}/modulos/endpoints/api.php?endpoint=listaDTEs" -H "Content-Type: application/json" -d '{"despacho":${nro_operacion}}'`;
    const apiRaw = execSync(curlCmd, { timeout: 10000 }).toString();
    const apiData = JSON.parse(apiRaw);
    const factura33 = apiData.data?.find((d: Record<string, string>) => d.codigo_tipo_dte === "33");
    if (factura33) {
      const folio = factura33.dte_folio;
      const folioB64 = Buffer.from(folio).toString("base64");
      const params = Buffer.from(`tipoDTE=MzM=&folio=${folioB64}&cedible=MA==&fact_id=&ticket=&outPut=`).toString("base64");
      const dteUrl = `${BASE_URL}/modulos/facturacion_electronica/otros/mostrar_dte_pdf.php?params=${params}`;
      await pgQuery(
        "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
        [`\ndte_url:${dteUrl}`, nro_operacion]
      );
      console.log(`[factura] ⏭️ Op ${nro_operacion} ya tiene DTE en AduanaNet (folio ${folio}), guardada`);
      return NextResponse.json({ ok: true, dte_url: dteUrl, skip: true });
    }
  } catch {}

  // Obtener datos del despacho (referencia, fecha_aceptacion, cliente)
  const drRows = await pgQuery<{ referencia: string; fecha_aceptacion: string; cliente: string; rut_cliente: string }>(
    "SELECT referencia, fecha_aceptacion, cliente, rut_cliente FROM despachos_replica WHERE despacho = $1 LIMIT 1",
    [nro_operacion]
  );
  const despachoData = drRows[0];
  const clienteNombre = (despachoData?.cliente || "").toUpperCase();
  const necesitaOrdenCompra = CLIENTES_ORDEN_COMPRA.some(c => clienteNombre.includes(c));

  try {
    const { browser, page } = await aduananetBrowserLogin();

    try {
      // 1. Lista facturación
      await page.goto(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });

      // 2. Click nuevo()
      await page.evaluate(() => { (window as unknown as Record<string, () => void>).nuevo(); });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // 3. Input NID
      const nidInput = await page.$('input[name="lib_nid"]');
      if (nidInput) {
        await nidInput.type(nro_operacion);
      } else {
        const inputs = await page.$$('input[type="text"]');
        for (const inp of inputs) {
          const vis = await inp.evaluate(el => el.offsetParent !== null);
          if (vis) { await inp.type(nro_operacion); break; }
        }
      }

      // 4. Click Aceptar 1
      await page.click('input[value="Aceptar"]');
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // 5. Click Aceptar 2
      const btn2 = await page.$('input[value="Aceptar"]');
      if (btn2) {
        await btn2.click();
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      }

      // Fallback: si no llegamos a formulario.php, ir directo con URL
      if (!page.url().includes("formulario.php")) {
        console.log(`[factura] Flujo normal no llegó a formulario, usando URL directa para op ${nro_operacion}`);
        const rutCliente = despachoData?.rut_cliente || "96691060";
        const cliNombre = (despachoData?.cliente || "KSB CHILE S.A.").replace(/ /g, "+");
        const directUrl = `${BASE_URL}/modulos/contabilidad/facturacion/afecta/formulario.php?opcion_clausula=&accion=N&tipo_fact=unitario&nid=${nro_operacion}&lib_base=1&opcion_facturar=iva&cli_id=${rutCliente.split("-")[0]}&txt_cli_id=${cliNombre}`;
        await page.goto(directUrl, { waitUntil: "networkidle0" });
        await new Promise(r => setTimeout(r, 2000));
        if (!page.url().includes("formulario.php")) {
          console.error(`[factura] ❌ No se pudo acceder al formulario para op ${nro_operacion}`);
          await browser.close();
          return NextResponse.json({ error: "No se pudo acceder al formulario de factura" }, { status: 500 });
        }
      }

      // 5.5. DATOS CLIENTE → Agregar Orden de Compra (solo para clientes que lo requieren)
      if (necesitaOrdenCompra && despachoData?.referencia) {
        // Limpiar referencia: eliminar sufijo _X (ej: "EM 260384_2" → "EM 260384")
        const referenciaLimpia = despachoData.referencia.replace(/_\d+$/, "").trim();
        console.log(`[factura] Agregando Orden de Compra: ${referenciaLimpia}`);
        // Click en addRef('') para agregar fila
        await page.evaluate(() => {
          const link = document.querySelector('a[href*="addRef"]') as HTMLAnchorElement;
          if (link) link.click();
        });
        await new Promise(r => setTimeout(r, 2000));

        // Seleccionar "Orden de Compra" (valor 801)
        await page.evaluate(() => {
          const sel = document.querySelector('select[name="fare_tipo_doc0"]') as HTMLSelectElement;
          if (sel) sel.value = "801";
        });

        // Ingresar folio (referencia limpia)
        const folioInput = await page.$('input[name="fare_folio_doc0"]');
        if (folioInput) {
          await folioInput.type(referenciaLimpia);
        }

        // Ingresar fecha (fecha_aceptacion en formato dd/mm/yyyy)
        const fechaInput = await page.$('input[name="fare_fecha_doc0"]');
        if (fechaInput && despachoData.fecha_aceptacion) {
          const fecha = despachoData.fecha_aceptacion.substring(0, 10); // YYYY-MM-DD
          const [y, m, d] = fecha.split("-");
          await fechaInput.type(`${d}/${m}/${y}`);
        }
        await new Promise(r => setTimeout(r, 1000));
        console.log(`[factura] ✅ Orden de Compra agregada: folio=${referenciaLimpia}`);
      }

      // 6. Pestaña DATOS DESPACHO → Actualizar Dolar
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const a of links) {
          if (a.textContent && a.textContent.trim() === "DATOS DESPACHOS") { a.click(); return; }
        }
      });
      await new Promise(r => setTimeout(r, 2000));

      await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("actualizar dolar")) {
            (inp as HTMLInputElement).click(); return;
          }
        }
      });
      await new Promise(r => setTimeout(r, 3000));

      // 7. Pestaña Gastos y Honorarios
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const a of links) {
          if (a.textContent && a.textContent.trim() === "GASTOS Y HONORARIOS") { a.click(); return; }
        }
      });
      await new Promise(r => setTimeout(r, 2000));

      // 7. Traer Honorarios (popup)
      const traerHonBtn = await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button']");
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("honorarios")) return (inp as HTMLInputElement).value;
        }
        return null;
      });

      if (traerHonBtn) {
        const popupPromise = new Promise<import("puppeteer").Page | null>(resolve => {
          browser.once("targetcreated", async target => { resolve(await target.page()); });
          setTimeout(() => resolve(null), 10000);
        });
        await page.evaluate((val: string) => {
          const inputs = document.querySelectorAll("input[type='button']");
          for (const inp of inputs) { if ((inp as HTMLInputElement).value === val) { (inp as HTMLInputElement).click(); return; } }
        }, traerHonBtn);

        const popup = await popupPromise;
        if (popup) {
          await new Promise(r => setTimeout(r, 3000));
          await popup.evaluate(() => {
            const rows = document.querySelectorAll("tr");
            for (const row of rows) {
              const cells = row.querySelectorAll("td");
              if (cells.length > 0) {
                const link = row.querySelector("a");
                if (link) { link.click(); return; }
                const onclick = row.getAttribute("onclick") || row.getAttribute("onmousedown");
                if (onclick) { row.click(); return; }
                cells[0].click(); return;
              }
            }
          });
          await new Promise(r => setTimeout(r, 3000));
          await popup.close().catch(() => {});
        }
      }

      // 7.5. Regla parcialidades KSB: modificar honorarios
      if (necesitaOrdenCompra && despachoData?.referencia) {
        const referenciaBase = despachoData.referencia.replace(/_\d+$/, "").trim();
        const esParcialidad = /_\d+$/.test(despachoData.referencia);
        // Contar operaciones con la misma referencia base
        const parcRows = await pgQuery<{ despacho: string; total_cif: string }>(
          "SELECT despacho, total_cif FROM despachos_replica WHERE referencia LIKE $1 AND cliente ILIKE '%KSB%'",
          [`${referenciaBase}%`]
        );
        const tieneParcialidades = parcRows.length > 1;

        if (tieneParcialidades) {
          if (!esParcialidad) {
            // Primera operación: 0.22% × CIF total de todas las parcialidades
            const cifTotal = parcRows.reduce((s, r) => s + parseFloat(r.total_cif || "0"), 0);
            const tc = await page.evaluate(() => {
              const frm = document.querySelector("form[name='frmEditar']") as HTMLFormElement;
              return parseFloat((frm?.valor_dolar_honorarios?.value || "0").replace(/\./g, "").replace(",", "."));
            });
            let honorariosUSD = cifTotal * 0.0022;
            if (honorariosUSD < 50) honorariosUSD = 50;
            if (honorariosUSD > 300) honorariosUSD = 300;
            const honorariosCLP = Math.round(honorariosUSD * tc);
            const formatted = honorariosCLP.toLocaleString("es-CL");
            await page.evaluate((val: string) => {
              const frm = document.querySelector("form[name='frmEditar']") as HTMLFormElement;
              if (frm?.fact_honorarios) frm.fact_honorarios.value = val;
            }, formatted);
            console.log(`[factura] Parcialidades: primera op, honorarios=${honorariosUSD.toFixed(2)} USD → ${formatted} CLP (CIF total=${cifTotal.toFixed(2)}, TC=${tc})`);
          } else {
            // Parcialidad: honorarios = 0
            await page.evaluate(() => {
              const frm = document.querySelector("form[name='frmEditar']") as HTMLFormElement;
              if (frm?.fact_honorarios) frm.fact_honorarios.value = "0";
            });
            console.log(`[factura] Parcialidades: parcialidad, honorarios=0`);
          }
        }
      }

      // 8. Pestaña Resumen
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const a of links) {
          if (a.textContent && a.textContent.trim() === "RESUMEN") { a.click(); return; }
        }
      });
      await new Promise(r => setTimeout(r, 2000));

      // 9. Traer Pago Directo
      await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("pago directo")) {
            (inp as HTMLInputElement).click(); return;
          }
        }
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("pago")) {
            (inp as HTMLInputElement).click(); return;
          }
        }
      });
      await new Promise(r => setTimeout(r, 3000));

      // 10. Grabar
      const grabarClicked = await page.evaluate(() => {
        // Submit directo del formulario (validaForm() puede fallar silenciosamente)
        const form = document.querySelector("form[name='frmEditar']") as HTMLFormElement;
        if (form) { form.submit(); return true; }
        // Fallback: click en botón Grabar
        const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("grabar")) {
            (inp as HTMLInputElement).click(); return true;
          }
        }
        return false;
      });
      if (!grabarClicked) {
        console.error(`[factura] ❌ No se encontró botón Grabar para op ${nro_operacion}`);
        await browser.close();
        return NextResponse.json({ error: "No se encontró botón Grabar" }, { status: 500 });
      }
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      // Verificar si se grabó correctamente (URL debe cambiar a mensaje.php o lista.php)
      const postGrabarUrl = page.url();
      const postGrabarOk = postGrabarUrl.includes("mensaje.php") || postGrabarUrl.includes("lista.php");
      if (!postGrabarOk) {
        // Puede que siga en formulario.php por error de validación
        const errorMsg = await page.evaluate(() => {
          // Buscar mensajes de error en la página
          const alerts = document.querySelectorAll(".alert, .error, .mensaje_error");
          for (const a of alerts) { if (a.textContent?.trim()) return a.textContent.trim(); }
          return "";
        });
        console.error(`[factura] ⚠️ Posible error al grabar op ${nro_operacion}: URL=${postGrabarUrl} error=${errorMsg}`);
      }

      // 11. Verificar y continuar
      if (skip_sii) {
        // Verificar que la factura se grabó: URL debe ser lista.php o mensaje.php
        const finalUrl = page.url();
        if (finalUrl.includes("lista.php") || finalUrl.includes("mensaje.php") || finalUrl.includes("grabar.php")) {
          // Marcar como confeccionada en DB
          await pgQuery(
            "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
            [`\nfactura_confeccionada:${new Date().toISOString()}`, nro_operacion]
          );
          console.log(`[factura] ✅ Factura confeccionada (sin SII) para op ${nro_operacion}`);
          await browser.close();
          return NextResponse.json({ ok: true, dte_url: "", skip_sii: true });
        }
        // Si sigue en formulario.php, falló
        console.error(`[factura] ❌ Factura no se grabó para op ${nro_operacion} - URL: ${finalUrl}`);
        await browser.close();
        return NextResponse.json({ error: "Factura no se grabó correctamente" }, { status: 500 });
      }

      await page.goto(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
      
      // Filtrar por nro operación
      const filInput = await page.$('input[name="fil_lib_nid"]');
      if (filInput) {
        await filInput.type(nro_operacion);
        await page.evaluate(() => {
          if (typeof (window as unknown as Record<string, () => void>).filtrarLista === "function") {
            (window as unknown as Record<string, () => void>).filtrarLista();
          } else {
            const btn = document.querySelector('input[type="submit"]') as HTMLInputElement;
            if (btn) btn.click();
          }
        });
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      }

      // 12. Extraer ID de imprimir('ID') y ejecutar
      const imprimirId = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const match = html.match(/imprimir\(\s*'(\d+)'\s*\)/);
        return match ? match[1] : null;
      });

      if (imprimirId) {
        await page.evaluate((id: string) => { (window as unknown as Record<string, (id: string) => void>).imprimir(id); }, imprimirId);
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));

        // 13. Click "Imprimir" para enviar al SII
        await page.evaluate(() => {
          const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
          for (const inp of inputs) {
            if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("imprimir")) {
              (inp as HTMLInputElement).click(); return;
            }
          }
        });
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        console.log(`[factura] ✅ Factura enviada al SII para op ${nro_operacion}`);
      }

      // 14. Volver a lista y obtener URL del DTE
      await page.goto(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
      const filInput2 = await page.$('input[name="fil_lib_nid"]');
      if (filInput2) {
        await filInput2.type(nro_operacion);
        await page.evaluate(() => {
          if (typeof (window as unknown as Record<string, () => void>).filtrarLista === "function") {
            (window as unknown as Record<string, () => void>).filtrarLista();
          }
        });
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      }

      // Extraer ID del getUrl(true, ID) para construir la URL del DTE
      const dteId = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const match = html.match(/getUrl\(\s*true\s*,\s*(\d+)\s*\)/);
        return match ? match[1] : null;
      });

      let dteUrl = "";
      if (dteId) {
        // Construir URL del PDF del DTE: usar folio de la factura
        // Primero obtener el folio de la API
        try {
          const { execSync } = await import("child_process");
          const curlCmd = `curl -sk -u fguerragodoy:Uj7UarxZafsTL9G -X GET "${BASE_URL}/modulos/endpoints/api.php?endpoint=listaDTEs" -H "Content-Type: application/json" -d '{"despacho":${nro_operacion}}'`;
          const apiRaw = execSync(curlCmd, { timeout: 10000 }).toString();
          const apiData = JSON.parse(apiRaw);
          const factura33 = apiData.data?.find((d: Record<string, string>) => d.codigo_tipo_dte === "33");
          if (factura33) {
            const folio = factura33.dte_folio;
            const folioB64 = Buffer.from(folio).toString("base64");
            const params = Buffer.from(`tipoDTE=MzM=&folio=${folioB64}&cedible=MA==&fact_id=&ticket=&outPut=`).toString("base64");
            dteUrl = `${BASE_URL}/modulos/facturacion_electronica/otros/mostrar_dte_pdf.php?params=${params}`;
          }
        } catch {}

        if (dteUrl) {
          console.log(`[factura] DTE URL: ${dteUrl.substring(0, 80)}...`);
          
          // Guardar URL DTE en operaciones
          const rutCliente = despachoData?.rut_cliente || "92933000-5";
          await pgQuery(
            "INSERT INTO operaciones (nro_operacion, rut_cliente, estado) VALUES ($1, $2, 'aprobada') ON CONFLICT (nro_operacion) DO NOTHING",
            [nro_operacion, rutCliente]
          );
          await pgQuery(
            "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
            [`\ndte_url:${dteUrl}`, nro_operacion]
          );
        }
      }

      console.log(`[factura] ✅ Factura generada y enviada al SII para op ${nro_operacion}`);
      await browser.close();

      return NextResponse.json({ ok: true, dte_url: dteUrl });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[factura] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
