"use client";

import { useState, useEffect, useCallback } from "react";

type Documento = {
  id: number;
  nro_operacion: string;
  nombre_archivo: string;
  tipo_documento: string;
  datos_extraidos: Record<string, unknown>;
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
                <div key={grupo.nro_operacion} className="collapse collapse-arrow bg-base-200 rounded-lg">
                  <input type="checkbox" defaultChecked />
                  <div className="collapse-title font-medium flex items-center gap-3">
                    <span className="badge badge-primary badge-sm font-mono">Op. {grupo.nro_operacion}</span>
                    <span className="text-sm text-base-content/60">{grupo.documentos.length} documento{grupo.documentos.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="collapse-content">
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
                              <td className="max-w-[180px] truncate text-sm">{doc.nombre_archivo}</td>
                              <td>
                                <span className="badge badge-sm badge-outline">{doc.tipo_documento}</span>
                              </td>
                              <td className="max-w-[300px]">
                                {Object.keys(doc.datos_extraidos).length > 0 ? (
                                  <details className="text-xs">
                                    <summary className="cursor-pointer text-primary">
                                      {Object.keys(doc.datos_extraidos).length} campos
                                    </summary>
                                    <pre className="mt-1 p-2 bg-base-100 rounded text-[11px] overflow-auto max-h-40">
                                      {JSON.stringify(doc.datos_extraidos, null, 2)}
                                    </pre>
                                  </details>
                                ) : (
                                  <span className="text-xs text-base-content/40">Sin datos</span>
                                )}
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
