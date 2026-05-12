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

export default function PrealertasPanel() {
  const [nroOperacion, setNroOperacion] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Array<{ nombre: string; tipo: string; resumen: string; error?: string }>>([]);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [filterOp, setFilterOp] = useState("");

  const fetchDocumentos = useCallback(async () => {
    const params = filterOp ? `?nro_operacion=${encodeURIComponent(filterOp)}` : "";
    const res = await fetch(`/api/documentos${params}`);
    if (res.ok) {
      const data = await res.json();
      setDocumentos(data.documentos ?? []);
    }
  }, [filterOp]);

  useEffect(() => {
    fetchDocumentos();
  }, [fetchDocumentos]);

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

      {/* Lista de documentos */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="card-title text-lg">Documentos Subidos</h2>
            <input
              type="text"
              placeholder="Filtrar por Nro. Operación..."
              className="input input-bordered input-sm w-48"
              value={filterOp}
              onChange={(e) => setFilterOp(e.target.value)}
            />
          </div>

          {documentos.length === 0 ? (
            <p className="text-base-content/50 text-sm py-4">No hay documentos subidos.</p>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>Nro. Operación</th>
                    <th>Archivo</th>
                    <th>Tipo Documento</th>
                    <th>Datos Extraídos</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {documentos.map((doc) => (
                    <tr key={doc.id}>
                      <td className="font-mono">{doc.nro_operacion}</td>
                      <td className="max-w-[200px] truncate">{doc.nombre_archivo}</td>
                      <td><span className="badge badge-sm badge-primary badge-outline">{doc.tipo_documento}</span></td>
                      <td className="max-w-[300px]">
                        <details className="text-xs">
                          <summary className="cursor-pointer text-primary">Ver datos</summary>
                          <pre className="mt-1 p-2 bg-base-200 rounded text-[11px] overflow-auto max-h-40">
                            {JSON.stringify(doc.datos_extraidos, null, 2)}
                          </pre>
                        </details>
                      </td>
                      <td className="text-xs">{new Date(doc.created_at).toLocaleDateString("es-CL")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
