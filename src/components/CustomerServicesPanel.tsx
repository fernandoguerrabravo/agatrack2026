"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type Documento = {
  id: number;
  nro_operacion: string;
  nombre_archivo: string;
  tipo_documento: string;
  datos_extraidos: Record<string, unknown>;
  datos_extraidos_claude?: Record<string, unknown>;
  datos_shipsgo?: Record<string, unknown>;
  storage_url: string;
  created_at: string;
};

type Operacion = {
  nro_operacion: string;
  rut_cliente: string;
  estado: string;
  fecha_apertura: string;
  fecha_confeccion: string | null;
  cliente_nombre: string | null;
  total_docs: number;
  notas: string;
};

type OperacionConDocs = Operacion & {
  documentos: Documento[];
};

type ProcesoEnCurso = {
  id: string;
  archivos: string[];
  estado: "leyendo" | "creando" | "subiendo" | "listo" | "error";
  referencia?: string;
  nroOperacion?: string;
  progreso: string;
  subidos: number;
  total: number;
};

export default function CustomerServicesPanel() {
  const [operaciones, setOperaciones] = useState<OperacionConDocs[]>([]);
  const [filterOp, setFilterOp] = useState("");
  const [confeccionando, setConfeccionando] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [clientes, setClientes] = useState<Array<{ rut: string; nombre: string }>>([]);
  const [clienteActivo, setClienteActivo] = useState<string>("todos");
  const [tiposDocumento, setTiposDocumento] = useState<string[]>([]);

  // Upload
  const [archivos, setArchivos] = useState<File[]>([]);
  const [procesos, setProcesos] = useState<ProcesoEnCurso[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Collapse state por operación
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  function toggleCollapse(nro: string) {
    setCollapsed(prev => ({ ...prev, [nro]: !prev[nro] }));
  }

  const fetchData = useCallback(async () => {
    setCargando(true);
    const opsRes = await fetch(`/api/operaciones${filterOp ? `?nro_operacion=${encodeURIComponent(filterOp)}` : ""}`);
    if (!opsRes.ok) { setCargando(false); return; }
    const ops: Operacion[] = (await opsRes.json()).operaciones ?? [];

    const docsRes = await fetch(`/api/documentos${filterOp ? `?nro_operacion=${encodeURIComponent(filterOp)}` : ""}`);
    const docs: Documento[] = docsRes.ok ? (await docsRes.json()).documentos ?? [] : [];

    const docsMap = new Map<string, Documento[]>();
    for (const doc of docs) {
      if (!docsMap.has(doc.nro_operacion)) docsMap.set(doc.nro_operacion, []);
      docsMap.get(doc.nro_operacion)!.push(doc);
    }

    const combined: OperacionConDocs[] = ops.map(op => ({ ...op, documentos: docsMap.get(op.nro_operacion) || [] }));
    for (const [nro, opDocs] of docsMap) {
      if (!combined.some(o => o.nro_operacion === nro)) {
        combined.push({ nro_operacion: nro, rut_cliente: "", estado: "abierta", fecha_apertura: opDocs[0]?.created_at || "", fecha_confeccion: null, cliente_nombre: null, total_docs: opDocs.length, notas: "", documentos: opDocs });
      }
    }
    combined.sort((a, b) => (b.documentos[0]?.created_at || b.fecha_apertura || "").localeCompare(a.documentos[0]?.created_at || a.fecha_apertura || ""));
    setOperaciones(combined);
    setCargando(false);
  }, [filterOp]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Obtener lista de clientes asignados
  useEffect(() => {
    fetch("/api/operaciones/clientes").then(r => r.json()).then(data => {
      if (data.clientes) setClientes(data.clientes);
    }).catch(() => {});
    fetch("/api/tipos-documento").then(r => r.json()).then(data => {
      if (data.tipos) setTiposDocumento(data.tipos);
    }).catch(() => {});
  }, []);

  // Verificar aprobaciones al cargar
  useEffect(() => {
    fetch("/api/operaciones/verificar-aprobacion", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(r => r.json())
      .then(data => { if (data.aprobadas?.length > 0) fetchData(); })
      .catch(() => {});

    // Polling cada 60s para detectar aprobaciones
    const interval = setInterval(() => {
      fetch("/api/operaciones/verificar-aprobacion", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(r => r.json())
        .then(data => { if (data.aprobadas?.length > 0) fetchData(); })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── SUBIR DOCUMENTOS ──
  function handleSubir() {
    if (archivos.length === 0) return alert("Seleccione al menos un archivo.");

    const procesoId = Date.now().toString(36);
    const nuevoProceso: ProcesoEnCurso = {
      id: procesoId,
      archivos: archivos.map(f => f.name),
      estado: "leyendo",
      progreso: "Leyendo factura para obtener referencia...",
      subidos: 0,
      total: archivos.length,
    };

    const archivosParaProcesar = [...archivos];
    setProcesos(prev => [nuevoProceso, ...prev]);
    setArchivos([]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    procesarEnBackground(procesoId, archivosParaProcesar);
  }

  async function procesarEnBackground(procesoId: string, files: File[]) {
    const update = (u: Partial<ProcesoEnCurso>) => setProcesos(prev => prev.map(p => p.id === procesoId ? { ...p, ...u } : p));

    try {
      // PASO 1: Subir la factura o packing list primero para obtener la referencia
      // Identificar la factura por nombre (invoice, factura, inv) o packing list
      const invoiceIdx = files.findIndex(f => /invoice|factura|inv/i.test(f.name));
      const packingIdx = files.findIndex(f => /packing|empaque|lista/i.test(f.name));
      const firstFile = invoiceIdx >= 0 ? files[invoiceIdx] : (packingIdx >= 0 ? files[packingIdx] : files[0]);

      update({ estado: "leyendo", progreso: `Leyendo ${firstFile.name} para obtener referencia...` });

      // Subir a un nro_operacion temporal "TEMP" — usaremos la respuesta para obtener la referencia
      // Mejor: subimos sin nro_operacion fijo y usamos los datos extraídos
      const tempForm = new FormData();
      tempForm.append("file", firstFile);
      tempForm.append("nro_operacion", "TEMP_" + procesoId);
      tempForm.append("rut_cliente", "92933000-5");

      const tempRes = await fetch("/api/documentos/upload", { method: "POST", body: tempForm });
      if (!tempRes.ok) {
        const err = await tempRes.json().catch(() => ({ error: "Error leyendo documento" }));
        update({ estado: "error", progreso: err.error });
        return;
      }

      const tempData = await tempRes.json();
      const datos = tempData.documento?.datos_extraidos;
      const datosObj = typeof datos === "string" ? JSON.parse(datos) : datos;

      // Extraer referencia: internal_document_number, customer_order_number, orden, etc.
      let referencia = datosObj?.customer_order_number || datosObj?.internal_document_number || datosObj?.orden || datosObj?.our_reference || datosObj?.orden_compra || datosObj?.po_number || "";
      
      // Para terrestres: referencia viene del order_number del packing list (10 dígitos)
      if (!referencia && datosObj?.order_number) {
        referencia = String(datosObj.order_number).replace(/\s*\/.*$/, "").trim().substring(0, 10);
      }
      
      // Último fallback: numero_factura
      if (!referencia) {
        referencia = datosObj?.numero_factura || ""
      }

      if (!referencia) {
        update({ estado: "error", progreso: "No se encontró referencia (Customer Order Number) en el documento." });
        return;
      }

      update({ estado: "creando", referencia, progreso: `Ref: ${referencia} — Creando operación en AduanaNet...` });

      // PASO 2: Crear operación en AduanaNet con la referencia
      // Detectar cliente por consignatario de la factura
      const consignatarioNombre = String(datosObj?.comprador_sold_to?.nombre || datosObj?.comprador?.nombre || datosObj?.ship_to?.nombre || datosObj?.consignee?.nombre || datosObj?.comprador || "");
      // Detectar cliente via API
      let clienteDetectado = { cli_id: "2710", rut_cliente: "92933000-5" }; // default Petroquímica
      if (consignatarioNombre) {
        try {
          const detectRes = await fetch(`/api/operaciones/detectar-cliente?nombre=${encodeURIComponent(consignatarioNombre)}`);
          if (detectRes.ok) {
            const detectData = await detectRes.json();
            if (detectData.cli_id && detectData.rut) {
              clienteDetectado = { cli_id: detectData.cli_id, rut_cliente: detectData.rut };
            }
          }
        } catch {}
      }

      // Detectar si es terrestre por transport_mode de la factura
      const isTerrestre = /cami[oó]n|terrestre|truck|carretera/i.test(String(datosObj?.transport_mode || datosObj?.tipo_transporte || ""));
      const puertoDesembarque = isTerrestre ? "LOS ANDES" : "SAN ANTONIO";
      
      const crearRes = await fetch("/api/aduananet-operaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cli_id: clienteDetectado.cli_id, rut_cliente: clienteDetectado.rut_cliente, referencia, puerto_desembarque: puertoDesembarque, tio_id: "151" }),
      });
      const crearData = await crearRes.json();

      if (!crearRes.ok || !crearData.nro_operacion) {
        update({ estado: "error", progreso: crearData.error || "Error creando operación" });
        return;
      }

      const nroOp = crearData.nro_operacion;
      update({ estado: "subiendo", nroOperacion: nroOp, progreso: `Op. ${nroOp} creada (ref: ${referencia}). Subiendo docs...` });

      // PASO 3: Mover el doc temporal al nro_operacion correcto
      // Actualizar el nro_operacion del documento ya subido
      const tempDocId = tempData.documento?.id;
      if (tempDocId) {
        await fetch(`/api/documentos/${tempDocId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nro_operacion: nroOp }),
        });
      }
      let subidos = 1; // El primero ya se subió
      update({ subidos });

      // PASO 4: Subir el resto de documentos
      const firstIdx = invoiceIdx >= 0 ? invoiceIdx : (packingIdx >= 0 ? packingIdx : 0);
      const restantes = files.filter((_, i) => i !== firstIdx);
      for (const archivo of restantes) {
        update({ progreso: `Op. ${nroOp} — ${archivo.name} (${subidos + 1}/${files.length})`, subidos });
        const formData = new FormData();
        formData.append("file", archivo);
        formData.append("nro_operacion", nroOp);
        formData.append("rut_cliente", "92933000-5");
        const uploadRes = await fetch("/api/documentos/upload", { method: "POST", body: formData });
        if (uploadRes.ok) subidos++;
      }

      update({ estado: "listo", subidos, progreso: `Op. ${nroOp} — ${subidos}/${files.length} docs ✓ (ref: ${referencia})` });
      fetchData();
    } catch (err) {
      update({ estado: "error", progreso: `Error: ${err instanceof Error ? err.message : "desconocido"}` });
    }
  }

  function dismissProceso(id: string) {
    setProcesos(prev => prev.filter(p => p.id !== id));
  }

  // Upload a operación existente
  const [uploadingOp, setUploadingOp] = useState<string | null>(null);
  const [uploadingProgress, setUploadingProgress] = useState<Record<string, string>>({});
  const opFileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubirAOperacion(nroOp: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingOp(nroOp);
    const fileArr = Array.from(files);
    let subidos = 0;

    for (const archivo of fileArr) {
      setUploadingProgress(prev => ({ ...prev, [nroOp]: `${archivo.name} (${subidos + 1}/${fileArr.length})` }));
      const formData = new FormData();
      formData.append("file", archivo);
      formData.append("nro_operacion", nroOp);
      formData.append("rut_cliente", "92933000-5");
      const res = await fetch("/api/documentos/upload", { method: "POST", body: formData });
      if (res.ok) subidos++;
    }

    setUploadingOp(null);
    setUploadingProgress(prev => { const n = { ...prev }; delete n[nroOp]; return n; });
    fetchData();
  }

  async function handleCambiarTipo(docId: number, nuevoTipo: string) {
    const res = await fetch(`/api/documentos/${docId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo_documento: nuevoTipo }) });
    if (res.ok) fetchData();
  }

  async function handleDeleteDoc(id: number) {
    if (!confirm("¿Eliminar este documento?")) return;
    await fetch(`/api/documentos/${id}`, { method: "DELETE" });
    fetchData();
  }

  async function handleDeleteAllDocs(nroOp: string) {
    if (!confirm(`¿Eliminar todos los documentos de la operación ${nroOp}?`)) return;
    await fetch(`/api/documentos?nro_operacion=${encodeURIComponent(nroOp)}`, { method: "DELETE" });
    fetchData();
  }

  async function handleCerrarOperacion(nroOp: string) {
    if (!confirm(`¿Cerrar la operación ${nroOp}?`)) return;
    await fetch(`/api/operaciones?nro_operacion=${encodeURIComponent(nroOp)}`, { method: "DELETE" });
    fetchData();
  }

  async function handleConfeccionar(nroOp: string) {
    const Swal = (await import("sweetalert2")).default;
    // Detect terrestrial: has CRT/MIC but no BL
    const op = operaciones.find(o => o.nro_operacion === nroOp);
    const tieneBL = op?.documentos.some(d => d.tipo_documento === "Bill of Lading (BL)");
    const tieneCRT = op?.documentos.some(d => d.tipo_documento === "Carta de Porte Internacional (CRT)" || d.tipo_documento === "MIC/DTA");
    const esTerrestre = tieneCRT && !tieneBL;

    if (!esTerrestre) {
      const c1 = await Swal.fire({ title: "¿BL corregido?", text: "Confirma que el BL tiene datos de nave/viaje corregidos.", icon: "question", showCancelButton: true, confirmButtonText: "Sí", confirmButtonColor: "#f59e0b" });
      if (!c1.isConfirmed) return;
    }
    const c2 = await Swal.fire({ title: "¿Confeccionar?", html: `DIN ${esTerrestre ? "terrestre" : "marítima"} para <b>${nroOp}</b>`, icon: "warning", showCancelButton: true, confirmButtonText: "Confeccionar", confirmButtonColor: "#f59e0b" });
    if (!c2.isConfirmed) return;

    setConfeccionando(nroOp);
    Swal.fire({ title: "Confeccionando...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
      const res = await fetch("/api/confeccionar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nro_operacion: nroOp }) });
      const data = await res.json();
      if (res.ok) {
        await Swal.fire({ title: "✅ Éxito", html: `<b>Op ${nroOp}</b><br>${Object.entries(data.resultado || {}).map(([k, v]) => `${k}: ${v}`).join("<br>")}`, icon: "success" });
        fetchData();
      } else await Swal.fire({ title: "Error", text: data.error, icon: "error" });
    } catch (err) {
      await Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Error", icon: "error" });
    } finally { setConfeccionando(null); }
  }

  async function handleActualizarShipsgo(docId: number) {
    const res = await fetch("/api/documentos/shipsgo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId }) });
    if (res.ok) fetchData();
    else { const d = await res.json().catch(() => ({ error: "Error" })); alert(d.error || "Error actualizando ShipsGo"); }
  }

  const [actualizandoShipsgo, setActualizandoShipsgo] = useState(false);
  async function handleActualizarTodos() {
    setActualizandoShipsgo(true);
    const docsConShipsgo = operaciones.flatMap(op => op.documentos.filter(d => d.tipo_documento === "Bill of Lading (BL)" && (d.datos_shipsgo || (typeof d.datos_extraidos === "object" && (d.datos_extraidos as Record<string,unknown>)?.mbl_shipsgo)))).map(d => d.id);
    for (const docId of docsConShipsgo) {
      await fetch("/api/documentos/shipsgo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId }) }).catch(() => {});
    }
    setActualizandoShipsgo(false);
    fetchData();
  }

  async function handleProvisionFondos(nroOp: string) {
    const Swal = (await import("sweetalert2")).default;
    const c = await Swal.fire({ title: "¿Generar Provisión de Fondos?", html: `Se creará la provisión para <b>${nroOp}</b>, se generará el PDF y se enviará por correo.`, icon: "question", showCancelButton: true, confirmButtonText: "Generar", confirmButtonColor: "#7c3aed" });
    if (!c.isConfirmed) return;
    Swal.fire({ title: "Generando provisión...", html: "Creando en AduanaNet y descargando PDF.", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await fetch("/api/operaciones/provision-fondos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nro_operacion: nroOp }) });
      const data = await res.json();
      if (res.ok) {
        await Swal.fire({ title: "✅ Provisión generada", html: `<b>Op ${nroOp}</b><br>Total: $${data.total || ""}<br>PDF guardado y enviado por correo.`, icon: "success" });
        fetchData();
      } else {
        await Swal.fire({ title: "Error", text: data.error, icon: "error" });
      }
    } catch (err) { await Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  }

  async function handleVerificarConsistencia(nroOp: string) {
    const Swal = (await import("sweetalert2")).default;
    Swal.fire({ title: "Verificando consistencia...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await fetch("/api/operaciones/verificar-consistencia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nro_operacion: nroOp }) });
      const data = await res.json();
      if (data.consistente) {
        await Swal.fire({ title: "✅ Consistente", text: data.resumen || "Sin inconsistencias detectadas.", icon: "success" });
      } else {
        const alertasHtml = (data.alertas || []).map((a: { tipo: string; campo: string; detalle: string }) => 
          `<div style="text-align:left;margin:8px 0;padding:8px;background:${a.tipo === "error" ? "#fef2f2" : "#fffbeb"};border-radius:4px;"><b>${a.tipo === "error" ? "❌" : "⚠️"} ${a.campo}</b>: ${a.detalle}</div>`
        ).join("");
        await Swal.fire({ title: "Inconsistencias detectadas", html: alertasHtml || data.resumen, icon: "warning", width: 600 });
      }
    } catch (err) {
      await Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Error", icon: "error" });
    }
  }

  async function handleEnviarTTE(nroOp: string) {
    const Swal = (await import("sweetalert2")).default;
    const c = await Swal.fire({ title: "¿Enviar solicitud de transporte?", html: `Se enviará email con BL adjunto para la operación <b>${nroOp}</b>`, icon: "question", showCancelButton: true, confirmButtonText: "Enviar", confirmButtonColor: "#6366f1" });
    if (!c.isConfirmed) return;
    Swal.fire({ title: "Enviando...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await fetch("/api/operaciones/enviar-tte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nro_operacion: nroOp }) });
      const data = await res.json();
      if (res.ok) { await Swal.fire({ title: "✅ Enviado", text: "Solicitud de transporte enviada por email.", icon: "success" }); fetchData(); }
      else await Swal.fire({ title: "Error", text: data.error, icon: "error" });
    } catch (err) { await Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  }

  function renderOperacion(op: OperacionConDocs) {
    const isCollapsed = collapsed[op.nro_operacion] ?? true;
    // Extract ShipsGo summary for header
    const blDoc = op.documentos.find(d => d.tipo_documento === "Bill of Lading (BL)");
    const blDatos = blDoc ? (typeof blDoc.datos_extraidos === "string" ? JSON.parse(blDoc.datos_extraidos || "{}") : (blDoc.datos_extraidos || {})) : {};
    const sg = blDoc?.datos_shipsgo ? (typeof blDoc.datos_shipsgo === "string" ? JSON.parse(blDoc.datos_shipsgo as string) : blDoc.datos_shipsgo) as Record<string, unknown> : null;
    const route = sg?.route as Record<string, unknown> | undefined;
    const pod = (route?.port_of_discharge as Record<string, unknown>)?.location as Record<string, unknown> | undefined;
    const podDate = (route?.port_of_discharge as Record<string, unknown>)?.date_of_discharge ? new Date(String((route?.port_of_discharge as Record<string, unknown>).date_of_discharge)).toLocaleDateString("es-CL") : "";
    const naveShipsgo = blDatos.nave_corregida || blDatos.nave || "";
    const viajeShipsgo = blDatos.viaje_corregido || blDatos.viaje || "";

    return (
      <div key={op.nro_operacion} className="bg-base-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-300 cursor-pointer" onClick={() => toggleCollapse(op.nro_operacion)}>
          <div className="flex items-center gap-3">
            <span className="text-xs">{isCollapsed ? "▶" : "▼"}</span>
            <span className="badge badge-primary badge-sm font-mono">{op.nro_operacion}</span>
            {op.cliente_nombre && <span className="text-xs text-base-content/60">{op.cliente_nombre}</span>}
            {op.notas?.match(/ref:\s*([^\s|\n]+)/i) && <span className="text-xs text-base-content/50 font-mono">REF: {op.notas.match(/ref:\s*([^\s|\n]+)/i)?.[1]}</span>}
            {sg && <span className="text-xs text-base-content/50">| {naveShipsgo} {viajeShipsgo} → {String(pod?.name || "")} ETA: {podDate}</span>}
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {op.estado !== "aprobada" && (() => {
              const tieneBL = op.documentos.some(d => d.tipo_documento === "Bill of Lading (BL)");
              const tieneCRT = op.documentos.some(d => d.tipo_documento === "Carta de Porte Internacional (CRT)");
              const tieneMIC = op.documentos.some(d => d.tipo_documento === "MIC/DTA");
              const tieneFactura = op.documentos.some(d => d.tipo_documento === "Invoice (Factura Comercial)");
              const esTerrestre = (tieneCRT || tieneMIC) && !tieneBL;
              const blCorregido = op.documentos.some(d => { if (d.tipo_documento !== "Bill of Lading (BL)") return false; const datos = typeof d.datos_extraidos === "string" ? JSON.parse(d.datos_extraidos || "{}") : (d.datos_extraidos || {}); return !!(datos._nave_corregida_shipsgo || datos.nave_corregida || datos.viaje_corregido || d.datos_shipsgo); });
              const puede = tieneFactura && (esTerrestre || (tieneBL && blCorregido));
              return <button className={`btn btn-xs ${puede ? "btn-warning" : "btn-disabled"}`} disabled={!puede || confeccionando === op.nro_operacion} onClick={() => handleConfeccionar(op.nro_operacion)}>{confeccionando === op.nro_operacion ? <span className="loading loading-spinner loading-xs"></span> : "Enviar a Confeccionar"}</button>;
            })()}
            {op.estado === "abierta" && (() => {
              const tieneBLShipsgo = op.documentos.some(d => d.tipo_documento === "Bill of Lading (BL)" && d.datos_shipsgo);
              return tieneBLShipsgo ? <button className="btn btn-xs btn-accent" onClick={() => handleEnviarTTE(op.nro_operacion)}>Enviar Sol. TTE</button> : null;
            })()}
            <a href={op.estado === "aprobada"
              ? `https://fguerragodoy.aduananet2.cl/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${op.nro_operacion}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`
              : `https://fguerragodoy.aduananet2.cl/modulos/din/dus_encabezado/din.php?lib_base=1&lib_nid=${op.nro_operacion}&lbac_nid=0&dus_tipo_envio=2&pagno=0&tipo=&copias=1&borrador=1&ref=1&dolar=1&imp_masiva=0&comando=U`
            } target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline btn-info">{op.estado === "aprobada" ? "DIN Aprobada" : "Borrador"}</a>
            <a href={`/api/operaciones/caratula?nro_operacion=${op.nro_operacion}`} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline btn-accent">Carátula</a>
            <a href={`/api/operaciones/${op.nro_operacion}/descargar-todos`} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline">📑 Carpeta Despacho</a>
            {op.estado !== "aprobada" && <button className="btn btn-xs btn-outline btn-warning" onClick={() => handleVerificarConsistencia(op.nro_operacion)}>🔍 Verificar</button>}
            {op.estado === "aprobada" && <button className="btn btn-xs btn-secondary" onClick={() => handleProvisionFondos(op.nro_operacion)}>Provisión de Fondos</button>}
            {op.estado === "aprobada" && op.notas?.includes("provision_url:") && (
              <a href={op.notas.match(/provision_url:(https?:\/\/[^\s\n]+)/)?.[1] || "#"} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline btn-secondary">Ver Provisión</a>
            )}
            {op.estado === "abierta" && <button className="btn btn-ghost btn-xs text-warning" onClick={() => handleCerrarOperacion(op.nro_operacion)}>✓</button>}
          </div>
        </div>
        {!isCollapsed && (
        <div className="px-4 py-3">
          {op.estado !== "aprobada" && (
            <div className="flex items-center gap-2 mb-3">
              <input type="file" multiple accept=".pdf" className="file-input file-input-bordered file-input-xs flex-1" disabled={uploadingOp === op.nro_operacion} onChange={(e) => handleSubirAOperacion(op.nro_operacion, e.target.files)} />
              {uploadingOp === op.nro_operacion && (
                <div className="flex items-center gap-1"><span className="loading loading-spinner loading-xs"></span><span className="text-xs text-info">{uploadingProgress[op.nro_operacion]}</span></div>
              )}
            </div>
          )}
          {op.documentos.length === 0 ? <p className="text-xs text-base-content/40 italic">Sin documentos</p> : (
            <>
              {/* ShipsGo tracking info */}
              {(() => {
                const blDoc = op.documentos.find(d => d.tipo_documento === "Bill of Lading (BL)");
                if (!blDoc) return null;
                const datos = typeof blDoc.datos_extraidos === "string" ? JSON.parse(blDoc.datos_extraidos || "{}") : (blDoc.datos_extraidos || {});
                const sg = blDoc.datos_shipsgo ? (typeof blDoc.datos_shipsgo === "string" ? JSON.parse(blDoc.datos_shipsgo as string) : blDoc.datos_shipsgo) as Record<string, unknown> : null;
                if (!sg) return null;
                const blNum = datos.mbl_shipsgo || datos.numero_bl_master || datos.numero_bl || "";
                const route = sg.route as Record<string, unknown> | undefined;
                const pol = (route?.port_of_loading as Record<string, unknown>)?.location as Record<string, unknown> | undefined;
                const pod = (route?.port_of_discharge as Record<string, unknown>)?.location as Record<string, unknown> | undefined;
                const polDate = (route?.port_of_loading as Record<string, unknown>)?.date_of_loading ? new Date(String((route?.port_of_loading as Record<string, unknown>).date_of_loading)).toLocaleDateString("es-CL") : "";
                const podDate = (route?.port_of_discharge as Record<string, unknown>)?.date_of_discharge ? new Date(String((route?.port_of_discharge as Record<string, unknown>).date_of_discharge)).toLocaleDateString("es-CL") : "";
                const containers = (sg.containers || []) as Array<Record<string, unknown>>;
                const cont = containers[0] || {};
                const movements = (cont.movements || []) as Array<Record<string, unknown>>;

                return (
                  <div className="mb-3 bg-base-100 rounded p-3 text-xs space-y-2">
                    <div className="flex flex-wrap gap-4">
                      <span><b>BL:</b> {blNum}</span>
                      <span><b>Nave:</b> {datos.nave_corregida || datos.nave || ""}</span>
                      <span><b>Ruta:</b> {String(pol?.name || "")} ({polDate}) → {String(pod?.name || "")} ({podDate})</span>
                      <span><b>Tránsito:</b> {String(route?.transit_time || "")} días ({String(route?.transit_percentage || 0)}%)</span>
                      <span><b>CO₂:</b> {String((route as Record<string, unknown>)?.co2_emission || "N/D")} ton</span>
                    </div>
                    {movements.length > 0 && (
                      <table className="table table-xs w-full">
                        <thead><tr><th>Evento</th><th>Fecha</th><th>Nave</th><th></th></tr></thead>
                        <tbody>
                          {movements.map((m, i) => (
                            <tr key={i}>
                              <td><span className="badge badge-xs badge-ghost">{String(m.event || "")}</span></td>
                              <td>{m.timestamp ? new Date(String(m.timestamp)).toLocaleDateString("es-CL") : ""}</td>
                              <td>{String((m.vessel as Record<string, unknown>)?.name || "-")}{m.voyage ? " " + String(m.voyage) : ""}</td>
                              <td>{m.status === "ACT" ? "✅" : "⏳"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })()}
              <table className="table table-sm">
                <thead><tr><th>Archivo</th><th>Tipo</th><th>Fecha</th>{op.estado !== "aprobada" && <th></th>}</tr></thead>
                <tbody>
                  {op.documentos.map((doc) => (
                    <tr key={doc.id}>
                      <td className="max-w-[200px] truncate text-sm">{doc.storage_url ? <a href={doc.storage_url} target="_blank" rel="noopener noreferrer" className="link link-primary">{doc.nombre_archivo}</a> : doc.nombre_archivo}</td>
                      <td>
                        {op.estado === "aprobada" ? <span className="text-xs">{doc.tipo_documento}</span> : (
                          <select className="select select-xs select-bordered w-full max-w-[180px]" value={doc.tipo_documento} onChange={(e) => handleCambiarTipo(doc.id, e.target.value)}>
                            {tiposDocumento.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="text-xs text-base-content/50">{new Date(doc.created_at).toLocaleDateString("es-CL")}</td>
                      {op.estado !== "aprobada" && <td><button className="btn btn-ghost btn-xs text-error" onClick={() => handleDeleteDoc(doc.id)}>✕</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {op.estado !== "aprobada" && (
                <div className="flex justify-end mt-1"><button className="btn btn-ghost btn-xs text-error/60" onClick={() => handleDeleteAllDocs(op.nro_operacion)}>Eliminar todos</button></div>
              )}
            </>
          )}
        </div>
        )}
      </div>
    );
  }

  // Filtrar operaciones por cliente activo
  const operacionesFiltradas = clienteActivo === "todos"
    ? operaciones
    : operaciones.filter(op => op.rut_cliente === clienteActivo);

  return (
    <div className="space-y-4">
      {/* Nueva Operación (independiente del tab - detecta cliente automáticamente) */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Nueva Operación</h2>
          <p className="text-xs text-base-content/60 mb-3">
            Sube los documentos (incluir factura) → se detecta el cliente y referencia automáticamente → se crea la operación en AduanaNet
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf"
              className="file-input file-input-bordered file-input-sm flex-1"
              onChange={(e) => setArchivos(Array.from(e.target.files || []))}
            />
            <button className="btn btn-sm btn-primary" onClick={handleSubir} disabled={archivos.length === 0}>
              Subir {archivos.length > 0 ? `(${archivos.length} archivos)` : ""}
            </button>
          </div>
          {archivos.length > 0 && (
            <div className="mt-2 text-xs text-base-content/50">{archivos.map(f => f.name).join(", ")}</div>
          )}
        </div>
      </div>

      {/* Procesos en curso */}
      {procesos.length > 0 && (
        <div className="space-y-2">
          {procesos.map((p) => (
            <div key={p.id} className={`alert ${p.estado === "error" ? "alert-error" : p.estado === "listo" ? "alert-success" : "alert-info"} py-2`}>
              <div className="flex items-center gap-2 w-full">
                {(p.estado === "leyendo" || p.estado === "creando" || p.estado === "subiendo") && <span className="loading loading-spinner loading-xs"></span>}
                {p.estado === "listo" && <span>✅</span>}
                {p.estado === "error" && <span>❌</span>}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{p.progreso}</div>
                  {p.estado === "subiendo" && <progress className="progress progress-info w-full h-1 mt-1" value={p.subidos} max={p.total}></progress>}
                </div>
                {(p.estado === "listo" || p.estado === "error") && (
                  <button className="btn btn-ghost btn-xs" onClick={() => dismissProceso(p.id)}>✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Operaciones */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="card-title text-lg">Operaciones</h2>
            <div className="flex items-center gap-2">
              <button className={`btn btn-sm btn-ghost ${actualizandoShipsgo ? "loading" : ""}`} onClick={handleActualizarTodos} disabled={actualizandoShipsgo} title="Actualizar ETA de todas las operaciones">
                {!actualizandoShipsgo && "🔄"} Actualizar ETA
              </button>
              <input type="text" placeholder="Filtrar..." className="input input-bordered input-sm w-48" value={filterOp} onChange={(e) => setFilterOp(e.target.value)} />
            </div>
          </div>

          {/* Tabs por cliente */}
          {clientes.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              <button className={`badge badge-lg cursor-pointer ${clienteActivo === "todos" ? "badge-success text-white" : "badge-neutral badge-outline"}`} onClick={() => setClienteActivo("todos")}>Todos</button>
              {clientes.map(c => (
                <button key={c.rut} className={`badge badge-lg cursor-pointer ${clienteActivo === c.rut ? "badge-success text-white" : "badge-neutral badge-outline"}`} onClick={() => setClienteActivo(c.rut)}>
                  {c.nombre}
                </button>
              ))}
            </div>
          )}

          {/* Pestañas por estado */}
          {cargando ? (
            <div className="flex items-center justify-center py-8 gap-3">
              <span className="loading loading-spinner loading-md"></span>
              <span className="text-base-content/60">Cargando operaciones...</span>
            </div>
          ) : ((() => {
            const abiertas = operacionesFiltradas.filter(o => o.estado === "abierta");
            const tteEnviado = operacionesFiltradas.filter(o => o.estado === "tte_enviado");
            const confeccionadas = operacionesFiltradas.filter(o => o.estado === "confeccionada");
            const aprobadas = operacionesFiltradas.filter(o => o.estado === "aprobada");

            return (
              <div className="mt-3">
                <div role="tablist" className="tabs tabs-boxed">
                  <input type="radio" name="op_tabs" role="tab" className="tab checked:bg-info checked:text-info-content font-semibold" aria-label={`📂 Abiertas (${abiertas.length})`} defaultChecked />
                  <div role="tabpanel" className="tab-content pt-4">
                    {abiertas.length === 0 ? <p className="text-base-content/50 text-sm py-2">Sin operaciones abiertas.</p> : (
                      <div className="space-y-4">{abiertas.map(op => renderOperacion(op))}</div>
                    )}
                  </div>

                  <input type="radio" name="op_tabs" role="tab" className="tab checked:bg-accent checked:text-accent-content font-semibold" aria-label={`📧 TTE Enviado (${tteEnviado.length})`} />
                  <div role="tabpanel" className="tab-content pt-4">
                    {tteEnviado.length === 0 ? <p className="text-base-content/50 text-sm py-2">Sin solicitudes de transporte enviadas.</p> : (
                      <div className="space-y-4">{tteEnviado.map(op => renderOperacion(op))}</div>
                    )}
                  </div>

                  <input type="radio" name="op_tabs" role="tab" className="tab checked:bg-warning checked:text-warning-content font-semibold" aria-label={`📤 Enviadas (${confeccionadas.length})`} />
                  <div role="tabpanel" className="tab-content pt-4">
                    {confeccionadas.length === 0 ? <p className="text-base-content/50 text-sm py-2">Sin operaciones enviadas a confección.</p> : (
                      <div className="space-y-4">{confeccionadas.map(op => renderOperacion(op))}</div>
                    )}
                  </div>

                  <input type="radio" name="op_tabs" role="tab" className="tab checked:bg-success checked:text-success-content font-semibold" aria-label={`✅ Aprobadas (${aprobadas.length})`} />
                  <div role="tabpanel" className="tab-content pt-4">
                    {aprobadas.length === 0 ? <p className="text-base-content/50 text-sm py-2">Sin operaciones aprobadas.</p> : (
                      <div className="space-y-4">{aprobadas.map(op => renderOperacion(op))}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })())}
        </div>
      </div>
    </div>
  );
}
