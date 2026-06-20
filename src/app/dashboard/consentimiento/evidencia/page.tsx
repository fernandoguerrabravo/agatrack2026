"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

type Evidencia = {
  meta: Record<string, string>;
  consentimiento: Record<string, unknown>;
  cadena: { bloque_del_consentimiento: Record<string, unknown>; todos_los_eventos_del_folio: Array<Record<string, unknown>>; segmento_hasta_cabeza_sellada: Array<Record<string, unknown>>; integridad: { valido: boolean; longitud: number } };
  bitcoin: Record<string, unknown>;
  ots_individual: Record<string, unknown>;
  auditoria: Array<Record<string, string>>;
  instrucciones_verificacion: Record<string, string>;
};

export default function EvidenciaPage() {
  const searchParams = useSearchParams();
  const folio = searchParams.get("folio") || "";
  const [data, setData] = useState<Evidencia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!folio) { setLoading(false); setError("Folio no especificado"); return; }
    fetch(`/api/consentimiento/admin?tipo=evidencia&folio=${encodeURIComponent(folio)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Error cargando evidencia"))
      .finally(() => setLoading(false));
  }, [folio]);

  if (loading) return <div className="flex justify-center py-20"><span className="loading loading-spinner loading-lg"></span></div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return null;

  const c = data.consentimiento;
  const cadena = data.cadena;
  const btc = data.bitcoin;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📋 Evidencia Judicial</h1>
      </div>

      {/* Meta */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <h2 className="card-title text-sm">Información del Paquete</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="font-semibold">Generado:</span> {data.meta.generadoEn}</div>
            <div><span className="font-semibold">Ley:</span> {data.meta.ley}</div>
            <div><span className="font-semibold">Esquema Hash:</span> {data.meta.esquemaHash}</div>
            <div><span className="font-semibold">Versión:</span> {data.meta.version}</div>
          </div>
        </div>
      </div>

      {/* Consentimiento */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <h2 className="card-title text-sm">1. Consentimiento</h2>
          <div className="grid grid-cols-2 gap-2 text-sm mt-2">
            <div><span className="font-semibold">Folio:</span> <span className="font-mono">{String(c.folio)}</span></div>
            <div><span className="font-semibold">Estado:</span> <span className={`badge badge-sm ${c.estado === "otorgado" ? "badge-success" : "badge-error"}`}>{String(c.estado)}</span></div>
            <div><span className="font-semibold">Titular:</span> {String(c.titular_nombre)}</div>
            <div><span className="font-semibold">RUT:</span> {String(c.titular_rut)}</div>
            <div><span className="font-semibold">Finalidades:</span> {Array.isArray(c.finalidades) ? c.finalidades.join(", ") : ""}</div>
            <div><span className="font-semibold">Otorgado:</span> {String(c.otorgado_en || "")}</div>
          </div>
          <div className="mt-3 p-3 bg-base-200 rounded text-xs font-mono">
            <div><span className="font-semibold">Hash guardado:</span> {String(c.contenido_hash_guardado)}</div>
            <div><span className="font-semibold">Hash recalculado:</span> {String(c.contenido_hash_recalculado)}</div>
            <div className="mt-1">
              {c.contenido_coincide
                ? <span className="text-success font-bold">✅ Contenido ÍNTEGRO (hashes coinciden)</span>
                : <span className="text-error font-bold">❌ Contenido ALTERADO (hashes no coinciden)</span>
              }
            </div>
          </div>
        </div>
      </div>

      {/* Cadena */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <h2 className="card-title text-sm">2. Cadena de Bloques</h2>
          <div className="flex items-center gap-3 mt-2">
            {cadena.integridad.valido
              ? <span className="badge badge-success">✅ Cadena íntegra ({cadena.integridad.longitud} bloques)</span>
              : <span className="badge badge-error">❌ Cadena comprometida</span>
            }
          </div>
          <h3 className="font-semibold text-sm mt-4">Eventos del folio:</h3>
          <div className="overflow-x-auto mt-2">
            <table className="table table-xs">
              <thead><tr><th>#</th><th>Evento</th><th>Hash</th><th>Prev Hash</th><th>Fecha</th></tr></thead>
              <tbody>
                {cadena.todos_los_eventos_del_folio.map((b, i) => (
                  <tr key={i}>
                    <td>{String(b.indice)}</td>
                    <td><span className="badge badge-xs badge-outline">{String(b.evento)}</span></td>
                    <td className="font-mono text-xs">{String(b.hash || "").substring(0, 16)}...</td>
                    <td className="font-mono text-xs text-base-content/50">{String(b.prev_hash || "").substring(0, 16)}...</td>
                    <td className="text-xs">{String(b.creado_en || "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bitcoin */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <h2 className="card-title text-sm">3. Anclaje Bitcoin (OpenTimestamps)</h2>
          {btc.nota ? (
            <p className="text-sm text-warning mt-2">⏳ {String(btc.nota)}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm mt-2">
              <div><span className="font-semibold">Estado:</span> <span className="badge badge-sm badge-success">{String(btc.estado)}</span></div>
              <div><span className="font-semibold">Bloque Bitcoin:</span> {String(btc.btc_height || "pendiente")}</div>
              <div><span className="font-semibold">Cabeza sellada:</span> #{String(btc.cabeza_indice)}</div>
              <div><span className="font-semibold">Timestamp:</span> {btc.btc_timestamp ? new Date(Number(btc.btc_timestamp) * 1000).toISOString() : "pendiente"}</div>
              <div className="col-span-2 font-mono text-xs break-all"><span className="font-semibold">Hash cabeza:</span> {String(btc.cabeza_hash || "")}</div>
            </div>
          )}
          <div className="mt-3 text-xs text-base-content/50">
            La prueba .ots se descarga junto con los demás archivos al final de esta página.
          </div>
        </div>
      </div>

      {/* Auditoría */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <h2 className="card-title text-sm">4. Registro de Auditoría</h2>
          <div className="overflow-x-auto mt-2">
            <table className="table table-xs">
              <thead><tr><th>Fecha</th><th>Acción</th><th>Actor</th><th>Detalle</th><th>IP (hash)</th></tr></thead>
              <tbody>
                {data.auditoria.map((a, i) => (
                  <tr key={i}>
                    <td className="text-xs">{a.created_at ? new Date(a.created_at).toLocaleString("es-CL") : ""}</td>
                    <td><span className="badge badge-xs badge-outline">{a.accion}</span></td>
                    <td className="text-xs">{a.actor || "-"}</td>
                    <td className="text-xs">{a.detalle || "-"}</td>
                    <td className="font-mono text-xs">{a.ip_hash?.substring(0, 8) || "-"}</td>
                  </tr>
                ))}
                {data.auditoria.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-base-content/50">Sin registros</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Instrucciones */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <h2 className="card-title text-sm">5. Instrucciones de Verificación Independiente</h2>
          <ol className="list-decimal list-inside text-sm space-y-2 mt-2">
            <li>{data.instrucciones_verificacion.paso1}</li>
            <li>{data.instrucciones_verificacion.paso2}</li>
            <li>{data.instrucciones_verificacion.paso3}</li>
            <li>{data.instrucciones_verificacion.paso4}</li>
          </ol>
          <div className="divider"></div>
          <h3 className="font-semibold text-sm">Descargar Sobre de Evidencia</h3>
          <div className="flex flex-wrap gap-2 mt-2">
            <a href={`/api/consentimiento/admin?tipo=evidencia_json&folio=${folio}`} className="btn btn-sm btn-primary gap-1">📥 Paquete JSON</a>
            <a href={`/api/consentimiento/admin?tipo=ots_file&folio=${folio}`} className="btn btn-sm btn-outline gap-1">📥 Prueba .ots</a>
            <a href="/consentimiento/verificar-evidencia.js" download className="btn btn-sm btn-outline gap-1">📜 Script Verificador</a>
            <a href="/consentimiento/instructivo-verificacion-judicial.html" target="_blank" className="btn btn-sm btn-outline gap-1">📖 Instructivo Judicial</a>
          </div>
        </div>
      </div>
    </div>
  );
}
