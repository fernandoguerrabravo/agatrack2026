"use client";

import { useState, useEffect, useCallback } from "react";

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

type OperacionGroup = {
  nro_operacion: string;
  documentos: Documento[];
};

export default function PrealertasPanel() {
  const [nroOperacion, setNroOperacion] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Array<{ nombre: string; tipo: string; resumen: string; error?: string }>>([]);
  const [grupos, setGrupos] = useState<OperacionGroup[]>([]);
  const [filterOp, setFilterOp] = useState("");

  const fetchDocumentos = useCallback(async () => {
    const params = filterOp ? `?nro_operacion=${encodeURIComponent(filterOp)}` : "";
    const res = await fetch(`/api/documentos${params}`);
    if (res.ok) {
      const data = await res.json();
      const docs: Documento[] = data.documentos ?? [];
      // Agrupar por operación
      const map = new Map<string, Documento[]>();
      for (const doc of docs) {
        const key = doc.nro_operacion;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(doc);
      }
      const grouped: OperacionGroup[] = Array.from(map.entries())
        .map(([nro_operacion, documentos]) => ({ nro_operacion, documentos }))
        .sort((a, b) => b.documentos[0].created_at.localeCompare(a.documentos[0].created_at));
      setGrupos(grouped);
    }
  }, [filterOp]);

  useEffect(() => {
    fetchDocumentos();
  }, [fetchDocumentos]);

  async function handleDelete(id: number) {
    if (!confirm("¿Eliminar este documento?")) return;
    const res = await fetch(`/api/documentos/${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchDocumentos();
    }
  }

  async function handleDeleteOperacion(nroOp: string) {
    if (!confirm(`¿Eliminar todos los documentos de la operación ${nroOp}?`)) return;
    const res = await fetch(`/api/documentos?nro_operacion=${encodeURIComponent(nroOp)}`, { method: "DELETE" });
    if (res.ok) {
      fetchDocumentos();
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!nroOperacion.trim() || files.length === 0) return;

    setUploading(true);
    setResults([]);
    setProgress(0);

    const uploadResults: typeof results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(Math.round(((i) / files.length) * 100));

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("nro_operacion", nroOperacion.trim());

        const res = await fetch("/api/documentos/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (res.ok) {
          uploadResults.push({
            nombre: file.name,
            tipo: data.documento?.tipo_documento ?? "Desconocido",
            resumen: data.resumen ?? "",
          });
        } else {
          uploadResults.push({
            nombre: file.name,
            tipo: "Error",
            resumen: "",
            error: data.error ?? "Error desconocido",
          });
        }
      } catch {
        uploadResults.push({
          nombre: file.name,
          tipo: "Error",
          resumen: "",
          error: "Error de conexión",
        });
      }
    }

    setProgress(100);
    setResults(uploadResults);
    setUploading(false);
    setFiles([]);
    fetchDocumentos();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Formulario de subida */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Subir Documentos</h2>
          <form onSubmit={handleUpload} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="form-control w-full">
                <div className="label">
                  <span className="label-text">Número de Operación</span>
                </div>
                <input
                  type="text"
                  placeholder="Ej: 1234567"
                  className="input input-bordered w-full"
                  value={nroOperacion}
                  onChange={(e) => setNroOperacion(e.target.value)}
                  required
                  disabled={uploading}
                />
              </label>

              <label className="form-control w-full">
                <div className="label">
                  <span className="label-text">Archivos (PDF, imágenes)</span>
                </div>
                <input
                  type="file"
                  className="file-input file-input-bordered w-full"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.tiff,.webp"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  disabled={uploading}
                />
              </label>
            </div>

            {files.length > 0 && (
              <div className="text-sm text-base-content/60">
                {files.length} archivo{files.length !== 1 ? "s" : ""} seleccionado{files.length !== 1 ? "s" : ""}:
                {files.map((f, i) => (
                  <span key={i} className="ml-2 badge badge-sm badge-ghost">{f.name}</span>
                ))}
              </div>
            )}

            {uploading && (
              <div className="flex flex-col gap-1">
                <progress className="progress progress-primary w-full" value={progress} max="100" />
                <span className="text-xs text-base-content/50">Procesando documentos con IA... {progress}%</span>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full sm:w-auto"
              disabled={uploading || files.length === 0 || !nroOperacion.trim()}
            >
              {uploading ? (
                <><span className="loading loading-spinner loading-sm" /> Procesando...</>
              ) : (
                <>Subir y Analizar</>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Resultados del upload */}
      {results.length > 0 && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Resultados del Análisis</h2>
            <div className="space-y-3">
              {results.map((r, i) => (
                <div key={i} className={`p-3 rounded-lg ${r.error ? "bg-error/10" : "bg-success/10"}`}>
                  <div className="flex items-center gap-2">
                    {r.error ? (
                      <span className="badge badge-error badge-sm">Error</span>
                    ) : (
                      <span className="badge badge-success badge-sm">{r.tipo}</span>
                    )}
                    <span className="font-medium text-sm">{r.nombre}</span>
                  </div>
                  {r.resumen && <p className="text-sm text-base-content/70 mt-1">{r.resumen}</p>}
                  {r.error && <p className="text-sm text-error mt-1">{r.error}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Documentos agrupados por operación */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="card-title text-lg">Documentos por Operación</h2>
            <input
              type="text"
              placeholder="Filtrar por Nro. Operación..."
              className="input input-bordered input-sm w-48"
              value={filterOp}
              onChange={(e) => setFilterOp(e.target.value)}
            />
          </div>

          {grupos.length === 0 ? (
            <p className="text-base-content/50 text-sm py-4">No hay documentos subidos.</p>
          ) : (
            <div className="space-y-4 mt-3">
              {grupos.map((grupo) => (
                <div key={grupo.nro_operacion} className="bg-base-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-base-300">
                    <div className="flex items-center gap-3">
                      <span className="badge badge-primary badge-sm font-mono">Op. {grupo.nro_operacion}</span>
                      <span className="text-sm text-base-content/60">{grupo.documentos.length} documento{grupo.documentos.length !== 1 ? "s" : ""}</span>
                    </div>
                    <button
                      className="btn btn-error btn-xs"
                      onClick={() => handleDeleteOperacion(grupo.nro_operacion)}
                      title="Eliminar operación completa"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Eliminar todo
                    </button>
                  </div>
                  <details className="group">
                    <summary className="px-4 py-2 cursor-pointer text-xs text-primary hover:text-primary/80 list-none flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      Ver documentos
                    </summary>
                    <div className="px-4 pb-4">
                      <div className="overflow-x-auto">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>Archivo</th>
                            <th>Tipo</th>
                            <th>Datos Extraídos</th>
                            <th>Fecha</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {grupo.documentos.map((doc) => (
                            <tr key={doc.id}>
                              <td className="max-w-[180px] truncate text-sm">
                                {doc.storage_url ? (
                                  <a href={doc.storage_url} target="_blank" rel="noopener noreferrer" className="link link-primary hover:link-hover">
                                    {doc.nombre_archivo}
                                  </a>
                                ) : (
                                  doc.nombre_archivo
                                )}
                              </td>
                              <td>
                                <span className="badge badge-sm badge-outline">{doc.tipo_documento}</span>
                              </td>
                              <td className="max-w-[400px]">
                                {(() => {
                                  const datos = typeof doc.datos_extraidos === "string" ? JSON.parse(doc.datos_extraidos || "{}") : (doc.datos_extraidos || {});
                                  const datosClaude = typeof doc.datos_extraidos_claude === "string" ? JSON.parse(doc.datos_extraidos_claude || "{}") : (doc.datos_extraidos_claude || {});
                                  const hasBoth = Object.keys(datos).length > 0 && Object.keys(datosClaude).length > 0;

                                  // Extraer contenedores y flete para comparación
                                  const gptContainers = datos.contenedores || [];
                                  const claudeContainers = datosClaude.contenedores || [];
                                  const sgRaw = typeof doc.datos_shipsgo === "string" ? JSON.parse(doc.datos_shipsgo || "{}") : (doc.datos_shipsgo || {});
                                  const shipsgoContainers = (sgRaw.containers || []) as Array<Record<string, unknown>>;
                                  const gptFlete = datos.flete_detalle || datos.flete || null;
                                  const claudeFlete = datosClaude.flete_detalle || datosClaude.flete || null;
                                  const gptFleteTotal = datos.flete_total_prepaid || datos.flete_total || null;
                                  const claudeFleteTotal = datosClaude.flete_total_prepaid || datosClaude.flete_total || null;

                                  // Puertos de transbordo
                                  const gptTransbordo = datos.puerto_transbordo || "";
                                  const claudeTransbordo = datosClaude.puerto_transbordo || "";
                                  const sgRoute = sgRaw.route as Record<string, unknown> | undefined;
                                  const sgTransbordo = (() => {
                                    if (!sgRoute || !Number(sgRoute.ts_count)) return "";
                                    const polName = String(((sgRoute.port_of_loading as Record<string, unknown>)?.location as Record<string, unknown>)?.name || "").toUpperCase();
                                    const podName = String(((sgRoute.port_of_discharge as Record<string, unknown>)?.location as Record<string, unknown>)?.name || "").toUpperCase();
                                    // Buscar el último puerto antes del POD en los movimientos del primer contenedor
                                    const firstContainer = (sgRaw.containers || [])[0] as Record<string, unknown> | undefined;
                                    const movements = (firstContainer?.movements || []) as Array<Record<string, unknown>>;
                                    let lastIntermediatePort = "";
                                    for (const m of movements) {
                                      const loc = m.location as Record<string, unknown> | undefined;
                                      const portName = String(loc?.name || "").toUpperCase();
                                      if (portName && portName !== polName && portName !== podName) {
                                        lastIntermediatePort = String(loc?.name || "");
                                      }
                                    }
                                    return lastIntermediatePort;
                                  })();

                                  return Object.keys(datos).length > 0 || Object.keys(datosClaude).length > 0 ? (
                                  <div>
                                    {/* Comparador rápido: Contenedores + Flete */}
                                    {hasBoth && (Array.isArray(gptContainers) || gptFlete || claudeFlete) && (
                                      <details className="text-xs mb-1">
                                        <summary className="cursor-pointer text-warning font-semibold">
                                          ⚡ Comparar Contenedores & Flete
                                        </summary>
                                        <div className="mt-1 p-2 bg-base-100 rounded text-[10px] overflow-auto max-h-60 space-y-3">
                                          {/* Flete */}
                                          <div>
                                            <div className="font-bold text-[11px] mb-1 text-warning">💰 FLETE</div>
                                            <table className="w-full border-collapse border border-gray-200">
                                              <thead><tr className="bg-gray-100"><th className="p-1 text-left border border-gray-200">Campo</th><th className="p-1 text-left border border-gray-200">🟢 GPT-4o</th><th className="p-1 text-left border border-gray-200">🟣 Claude</th><th className="p-1 border border-gray-200">✓</th></tr></thead>
                                              <tbody>
                                                <tr className={gptFleteTotal === claudeFleteTotal ? "bg-green-50" : "bg-yellow-50"}>
                                                  <td className="p-1 font-semibold border border-gray-200">Total Prepaid</td>
                                                  <td className="p-1 border border-gray-200">{JSON.stringify(gptFleteTotal ?? "—")}</td>
                                                  <td className="p-1 border border-gray-200">{JSON.stringify(claudeFleteTotal ?? "—")}</td>
                                                  <td className="p-1 text-center border border-gray-200">{gptFleteTotal === claudeFleteTotal ? "✅" : "❌"}</td>
                                                </tr>
                                                <tr>
                                                  <td colSpan={4} className="p-1 border border-gray-200">
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-[10px] font-semibold">Valor aprobado:</span>
                                                      <input
                                                        type="text"
                                                        className="input input-xs input-bordered w-28 font-mono"
                                                        defaultValue={String(gptFleteTotal || claudeFleteTotal || "")}
                                                        id={`flete-input-${doc.id}`}
                                                      />
                                                      <button
                                                        className="btn btn-xs btn-success"
                                                        onClick={async () => {
                                                          const input = document.getElementById(`flete-input-${doc.id}`) as HTMLInputElement;
                                                          const val = input?.value?.trim();
                                                          if (!val) return;
                                                          const res = await fetch("/api/documentos/update-flete", {
                                                            method: "POST",
                                                            headers: { "Content-Type": "application/json" },
                                                            body: JSON.stringify({ docId: doc.id, fleteTotal: val }),
                                                          });
                                                          if (res.ok) { alert("✅ Flete aprobado"); fetchDocumentos(); }
                                                          else { const d = await res.json(); alert(d.error || "Error"); }
                                                        }}
                                                      >
                                                        ✓ Aprobar
                                                      </button>
                                                      {datos.flete_aprobado && <span className="text-[9px] text-success font-bold">✅ Aprobado</span>}
                                                    </div>
                                                  </td>
                                                </tr>
                                                <tr>
                                                  <td className="p-1 font-semibold border border-gray-200">Detalle</td>
                                                  <td className="p-1 border border-gray-200 break-all">{JSON.stringify(gptFlete ?? "—").substring(0, 100)}</td>
                                                  <td className="p-1 border border-gray-200 break-all">{JSON.stringify(claudeFlete ?? "—").substring(0, 100)}</td>
                                                  <td className="p-1 text-center border border-gray-200">{JSON.stringify(gptFlete) === JSON.stringify(claudeFlete) ? "✅" : "⚠️"}</td>
                                                </tr>
                                              </tbody>
                                            </table>
                                            {/* Detalle línea por línea */}
                                            {(Array.isArray(gptFlete) || Array.isArray(claudeFlete)) && (
                                              <table className="w-full border-collapse border border-gray-200 mt-1">
                                                <thead><tr className="bg-gray-50"><th className="p-1 text-left border border-gray-200">Concepto</th><th className="p-1 text-right border border-gray-200">🟢 GPT</th><th className="p-1 text-right border border-gray-200">🟣 Claude</th></tr></thead>
                                                <tbody>
                                                  {(() => {
                                                    const gptArr = Array.isArray(gptFlete) ? gptFlete : [];
                                                    const claudeArr = Array.isArray(claudeFlete) ? claudeFlete : [];
                                                    const maxLen = Math.max(gptArr.length, claudeArr.length);
                                                    return Array.from({ length: maxLen }).map((_, i) => {
                                                      const g = gptArr[i] as Record<string, unknown> | undefined;
                                                      const c = claudeArr[i] as Record<string, unknown> | undefined;
                                                      const concepto = (g?.concepto || c?.concepto || g?.descripcion || c?.descripcion || `Línea ${i+1}`) as string;
                                                      const gVal = g?.monto ?? g?.valor ?? g?.amount ?? "—";
                                                      const cVal = c?.monto ?? c?.valor ?? c?.amount ?? "—";
                                                      return (
                                                        <tr key={i} className={String(gVal) === String(cVal) ? "bg-green-50" : "bg-yellow-50"}>
                                                          <td className="p-1 border border-gray-200">{concepto}</td>
                                                          <td className="p-1 text-right border border-gray-200 font-mono">{String(gVal)}</td>
                                                          <td className="p-1 text-right border border-gray-200 font-mono">{String(cVal)}</td>
                                                        </tr>
                                                      );
                                                    });
                                                  })()}
                                                </tbody>
                                              </table>
                                            )}
                                          </div>
                                          {/* Puerto de Transbordo */}
                                          {(gptTransbordo || claudeTransbordo || sgTransbordo) && (
                                            <div>
                                              <div className="font-bold text-[11px] mb-1 text-warning">⚓ PUERTO DE TRANSBORDO</div>
                                              <table className="w-full border-collapse border border-gray-200">
                                                <thead><tr className="bg-gray-100"><th className="p-1 text-left border border-gray-200">🟢 GPT</th><th className="p-1 text-left border border-gray-200">🟣 Claude</th><th className="p-1 text-left border border-gray-200">🚢 ShipsGo</th><th className="p-1 border border-gray-200">✓</th></tr></thead>
                                                <tbody>
                                                  <tr className={
                                                    sgTransbordo && (String(gptTransbordo).toUpperCase() === String(sgTransbordo).toUpperCase() || String(claudeTransbordo).toUpperCase() === String(sgTransbordo).toUpperCase())
                                                      ? "bg-green-50" : sgTransbordo ? "bg-yellow-50" : gptTransbordo === claudeTransbordo ? "bg-green-50" : "bg-yellow-50"
                                                  }>
                                                    <td className={`p-1 border border-gray-200 ${sgTransbordo && String(gptTransbordo).toUpperCase() === String(sgTransbordo).toUpperCase() ? "text-green-700" : sgTransbordo ? "text-red-500" : ""}`}>{String(gptTransbordo || "—")}</td>
                                                    <td className={`p-1 border border-gray-200 ${sgTransbordo && String(claudeTransbordo).toUpperCase() === String(sgTransbordo).toUpperCase() ? "text-green-700" : sgTransbordo ? "text-red-500" : ""}`}>{String(claudeTransbordo || "—")}</td>
                                                    <td className="p-1 border border-gray-200 font-bold text-blue-700">{String(sgTransbordo || "—")}</td>
                                                    <td className="p-1 text-center border border-gray-200">{
                                                      sgTransbordo ? "🚢" : (gptTransbordo === claudeTransbordo && gptTransbordo ? "🤝" : "⚠️")
                                                    }</td>
                                                  </tr>
                                                </tbody>
                                              </table>
                                            </div>
                                          )}
                                          {/* Contenedores */}
                                          {(Array.isArray(gptContainers) && gptContainers.length > 0) && (
                                            <div>
                                              <div className="font-bold text-[11px] mb-1 text-warning">📦 CONTENEDORES</div>
                                              <table className="w-full border-collapse border border-gray-200">
                                                <thead><tr className="bg-gray-100"><th className="p-1 text-left border border-gray-200">#</th><th className="p-1 text-left border border-gray-200">🟢 GPT</th><th className="p-1 text-left border border-gray-200">🟣 Claude</th><th className="p-1 text-left border border-gray-200">🚢 ShipsGo</th><th className="p-1 border border-gray-200">✓</th></tr></thead>
                                                <tbody>
                                                  {(() => {
                                                    // Match por similitud: para cada contenedor de ShipsGo, buscar el más similar en GPT y Claude
                                                    const sgList = shipsgoContainers.map(c => String(c.number || ""));
                                                    const gptList = (gptContainers as Array<Record<string, unknown>>).map(c => String(c.numero_contenedor || ""));
                                                    const claudeList = (claudeContainers as Array<Record<string, unknown>>).map(c => String(c.numero_contenedor || ""));
                                                    const maxLen = Math.max(sgList.length, gptList.length, claudeList.length);

                                                    // Función de similitud (caracteres en común)
                                                    const similarity = (a: string, b: string) => {
                                                      if (!a || !b) return 0;
                                                      let match = 0;
                                                      for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i] === b[i]) match++; }
                                                      return match / Math.max(a.length, b.length);
                                                    };

                                                    // Usar ShipsGo como base si tiene datos, sino usar el más largo
                                                    const baseList = sgList.length > 0 ? sgList : (claudeList.length >= gptList.length ? claudeList : gptList);

                                                    return Array.from({ length: maxLen }).map((_, i) => {
                                                      const baseNr = baseList[i] || "—";
                                                      // Buscar mejor match en GPT
                                                      let bestGpt = gptList[i] || "—";
                                                      if (baseNr !== "—" && bestGpt !== baseNr) {
                                                        const found = gptList.find(g => similarity(g, baseNr) > 0.7);
                                                        if (found) bestGpt = found;
                                                      }
                                                      // Buscar mejor match en Claude
                                                      let bestClaude = claudeList[i] || "—";
                                                      if (baseNr !== "—" && bestClaude !== baseNr) {
                                                        const found = claudeList.find(c => similarity(c, baseNr) > 0.7);
                                                        if (found) bestClaude = found;
                                                      }
                                                      // Buscar mejor match en ShipsGo
                                                      const sgNr = sgList.length > 0 ? (sgList[i] || "—") : "—";

                                                      const allMatch = bestGpt === bestClaude && bestClaude === sgNr && sgNr !== "—";
                                                      const sgExists = sgNr !== "—";
                                                      const claudeMatchSg = bestClaude === sgNr;
                                                      const gptMatchSg = bestGpt === sgNr;

                                                      return (
                                                        <tr key={i} className={allMatch ? "bg-green-50" : sgExists ? (claudeMatchSg || gptMatchSg ? "bg-blue-50" : "bg-yellow-50") : "bg-gray-50"}>
                                                          <td className="p-1 border border-gray-200">{i + 1}</td>
                                                          <td className={`p-1 border border-gray-200 font-mono ${gptMatchSg ? "text-green-700" : sgExists ? "text-red-500" : ""}`}>{bestGpt}</td>
                                                          <td className={`p-1 border border-gray-200 font-mono ${claudeMatchSg ? "text-green-700" : sgExists ? "text-red-500" : ""}`}>{bestClaude}</td>
                                                          <td className="p-1 border border-gray-200 font-mono font-bold text-blue-700">{sgNr}</td>
                                                          <td className="p-1 text-center border border-gray-200">{allMatch ? "✅" : sgExists ? "🚢" : (bestGpt === bestClaude ? "🤝" : "⚠️")}</td>
                                                        </tr>
                                                      );
                                                    });
                                                  })()}
                                                </tbody>
                                              </table>
                                              <div className="mt-1 flex gap-2 text-[9px] text-gray-500">
                                                <span>✅ = todos coinciden</span>
                                                <span>🚢 = ShipsGo es verdad</span>
                                                <span>🤝 = GPT y Claude coinciden</span>
                                                <span>⚠️ = todos difieren</span>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </details>
                                    )}

                                    <details className="text-xs mb-1">
                                      <summary className="cursor-pointer text-primary font-semibold">
                                        🟢 GPT-4o ({Object.keys(datos).length} campos)
                                      </summary>
                                      <pre className="mt-1 p-2 bg-base-100 rounded text-[11px] overflow-auto max-h-40">
                                        {JSON.stringify(datos, null, 2)}
                                      </pre>
                                    </details>
                                    {Object.keys(datosClaude).length > 0 && (
                                      <details className="text-xs">
                                        <summary className="cursor-pointer text-secondary font-semibold">
                                          🟣 Claude ({Object.keys(datosClaude).length} campos)
                                        </summary>
                                        <pre className="mt-1 p-2 bg-base-100 rounded text-[11px] overflow-auto max-h-40">
                                          {JSON.stringify(datosClaude, null, 2)}
                                        </pre>
                                      </details>
                                    )}
                                    {/* ShipsGo Tracking */}
                                    {(() => {
                                      const sg = typeof doc.datos_shipsgo === "string" ? JSON.parse(doc.datos_shipsgo || "{}") : (doc.datos_shipsgo || {});
                                      const sgContainers = (sg.containers || []) as Array<Record<string, unknown>>;
                                      const sgRoute = sg.route as Record<string, unknown> | undefined;
                                      return (
                                        <details className="text-xs">
                                          <summary className="cursor-pointer text-info font-semibold">
                                            🚢 ShipsGo {sg.id ? `(${sgContainers.length} contenedores) — ${String(sg.status || "")}` : "(pendiente)"}
                                          </summary>
                                          <div className="mt-1 p-2 bg-base-100 rounded text-[10px] overflow-auto max-h-60 space-y-2">
                                            <button
                                              className="btn btn-xs btn-info"
                                              onClick={async () => {
                                                const res = await fetch("/api/documentos/shipsgo", {
                                                  method: "POST",
                                                  headers: { "Content-Type": "application/json" },
                                                  body: JSON.stringify({ docId: doc.id }),
                                                });
                                                if (res.ok) { fetchDocumentos(); }
                                                else { const d = await res.json(); alert(d.error || "Error"); }
                                              }}
                                            >
                                              🔄 Actualizar ShipsGo
                                            </button>
                                            {sgRoute && (
                                              <div className="flex items-center gap-2 text-[11px] mt-2">
                                                <span>📍 {String((sgRoute.port_of_loading as Record<string, unknown>)?.location && ((sgRoute.port_of_loading as Record<string, unknown>).location as Record<string, unknown>)?.name || "—")}</span>
                                                <span>→</span>
                                                <span>🏁 {String((sgRoute.port_of_discharge as Record<string, unknown>)?.location && ((sgRoute.port_of_discharge as Record<string, unknown>).location as Record<string, unknown>)?.name || "—")}</span>
                                                {sgRoute.transit_percentage && <span className="ml-auto font-bold text-info">{String(sgRoute.transit_percentage)}%</span>}
                                              </div>
                                            )}
                                            {sgContainers.length > 0 && (
                                              <table className="w-full border-collapse border border-gray-200">
                                                <thead><tr className="bg-info/10"><th className="p-1 text-left border border-gray-200">Contenedor</th><th className="p-1 text-left border border-gray-200">Status</th><th className="p-1 text-left border border-gray-200">Tipo</th></tr></thead>
                                                <tbody>
                                                  {sgContainers.map((c, i) => (
                                                    <tr key={i}>
                                                      <td className="p-1 border border-gray-200 font-mono font-bold">{String(c.number)}</td>
                                                      <td className="p-1 border border-gray-200">{String(c.status)}</td>
                                                      <td className="p-1 border border-gray-200">{String(c.size || "")}{String(c.type || "")}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            )}
                                            {/* JSON completo ShipsGo */}
                                            {sg.id && (
                                              <details className="mt-2">
                                                <summary className="cursor-pointer text-[9px] text-gray-400">Ver JSON completo ShipsGo</summary>
                                                <pre className="mt-1 p-2 bg-gray-50 rounded text-[9px] overflow-auto max-h-40">
                                                  {JSON.stringify(sg, null, 2)}
                                                </pre>
                                              </details>
                                            )}
                                          </div>
                                        </details>
                                      );
                                    })()}
                                  </div>
                                ) : (
                                  <span className="text-xs text-base-content/40">Sin datos</span>
                                );
                                })()}
                              </td>
                              <td className="text-xs">{new Date(doc.created_at).toLocaleDateString("es-CL")}</td>
                              <td>
                                <button
                                  className="btn btn-ghost btn-xs text-error"
                                  onClick={() => handleDelete(doc.id)}
                                  title="Eliminar"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
