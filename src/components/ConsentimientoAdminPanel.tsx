"use client";

import { useState, useEffect } from "react";

type ConsentimientoItem = { id: string; folio: string; nombre: string; rut: string; email: string | null; finalidades: string[]; estado: string; otorgadoEn: string; revocadoEn?: string; contenidoHash: string };
type ArsopItem = { id: string; folio: string; tipo: string; tipoLabel: string; nombre: string; rut: string; email: string | null; detalle: string; estado: string; respuesta?: string; creadoEn: string; respondidoEn?: string };
type Bloque = { indice: number; evento: string; folio: string; contenido_hash: string; datos_json: string; prev_hash: string; hash: string; creado_en: string };
type AuditItem = { id: string; accion: string; entidad: string; entidad_id: string; actor: string; detalle: string; ip_hash: string; created_at: string };

export default function ConsentimientoAdminPanel() {
  const [tab, setTab] = useState<"consentimientos" | "arsop" | "cadena" | "audit">("consentimientos");
  const [consentimientos, setConsentimientos] = useState<ConsentimientoItem[]>([]);
  const [arsop, setArsop] = useState<ArsopItem[]>([]);
  const [bloques, setBloques] = useState<Bloque[]>([]);
  const [cadenaValida, setCadenaValida] = useState<boolean | null>(null);
  const [cadenaLongitud, setCadenaLongitud] = useState(0);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [respuestaFolio, setRespuestaFolio] = useState("");
  const [respuestaTexto, setRespuestaTexto] = useState("");

  useEffect(() => { fetchTab(); }, [tab]);

  async function fetchTab() {
    setLoading(true);
    if (tab === "consentimientos") {
      const res = await fetch("/api/consentimiento/admin?tipo=consentimientos");
      const data = await res.json();
      setConsentimientos(data.items || []);
    } else if (tab === "arsop") {
      const res = await fetch("/api/consentimiento/admin?tipo=arsop");
      const data = await res.json();
      setArsop(data.items || []);
    } else if (tab === "cadena") {
      const [cadenaRes, bloquesRes] = await Promise.all([
        fetch("/api/consentimiento/admin?tipo=cadena"),
        fetch("/api/consentimiento/admin?tipo=bloques"),
      ]);
      const cadenaData = await cadenaRes.json();
      const bloquesData = await bloquesRes.json();
      setCadenaValida(cadenaData.valido);
      setCadenaLongitud(cadenaData.longitud || 0);
      setBloques(bloquesData.bloques || []);
    } else if (tab === "audit") {
      const res = await fetch("/api/consentimiento/admin?tipo=audit");
      const data = await res.json();
      setAudit(data.items || []);
    }
    setLoading(false);
  }

  async function handleResponder() {
    if (!respuestaFolio || !respuestaTexto) return;
    await fetch("/api/consentimiento/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "responder_arsop", folio: respuestaFolio, respuesta: respuestaTexto }),
    });
    setRespuestaFolio(""); setRespuestaTexto("");
    fetchTab();
  }

  async function handleSellar() {
    const res = await fetch("/api/consentimiento/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "sellar_cadena" }),
    });
    const data = await res.json();
    if (data.ok) alert(`✅ Sellado iniciado - Bloque #${data.cabezaIndice}`);
    else alert(`❌ ${data.error}`);
    fetchTab();
  }

  async function handleActualizarOts() {
    const res = await fetch("/api/consentimiento/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "actualizar_ots" }),
    });
    const data = await res.json();
    if (data.ok) {
      const confirmados = (data.resultados || []).filter((r: Record<string, string>) => r.estado === "confirmado").length;
      alert(`✅ OTS actualizado: ${confirmados} confirmados de ${(data.resultados || []).length}`);
    }
    fetchTab();
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div role="tablist" className="tabs tabs-boxed">
        <button role="tab" className={`tab ${tab === "consentimientos" ? "tab-active" : ""}`} onClick={() => setTab("consentimientos")}>
          📋 Consentimientos
        </button>
        <button role="tab" className={`tab ${tab === "arsop" ? "tab-active" : ""}`} onClick={() => setTab("arsop")}>
          📝 Solicitudes ARSOP
        </button>
        <button role="tab" className={`tab ${tab === "cadena" ? "tab-active" : ""}`} onClick={() => setTab("cadena")}>
          ⛓️ Blockchain
        </button>
        <button role="tab" className={`tab ${tab === "audit" ? "tab-active" : ""}`} onClick={() => setTab("audit")}>
          🔍 Auditoría
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><span className="loading loading-spinner loading-lg"></span></div>
      ) : (
        <>
          {/* TAB: Consentimientos */}
          {tab === "consentimientos" && (
            <div className="card bg-base-100 shadow">
              <div className="card-body p-4">
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr><th>Folio</th><th>Titular</th><th>RUT</th><th>Estado</th><th>Finalidades</th><th>Fecha</th><th>Hash</th><th>Evidencia</th></tr>
                    </thead>
                    <tbody>
                      {consentimientos.map(c => (
                        <tr key={c.folio}>
                          <td className="font-mono text-xs">{c.folio}</td>
                          <td className="text-sm">{c.nombre}</td>
                          <td className="text-sm font-mono">{c.rut}</td>
                          <td><span className={`badge badge-sm ${c.estado === "otorgado" ? "badge-success" : "badge-error"}`}>{c.estado}</span></td>
                          <td className="text-xs">{c.finalidades?.join(", ")}</td>
                          <td className="text-xs">{c.otorgadoEn ? new Date(c.otorgadoEn).toLocaleDateString("es-CL") : ""}</td>
                          <td className="font-mono text-xs">{c.contenidoHash?.substring(0, 12)}...</td>
                      <td>
                        <a href={`/api/consentimiento/admin?tipo=evidencia_json&folio=${c.folio}`} className="btn btn-xs btn-outline btn-info" title="Descargar paquete de evidencia judicial">📥 JSON</a>
                      </td>
                        </tr>
                      ))}
                      {consentimientos.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-base-content/50">Sin consentimientos registrados</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: ARSOP */}
          {tab === "arsop" && (
            <div className="card bg-base-100 shadow">
              <div className="card-body p-4">
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr><th>Folio</th><th>Tipo</th><th>Titular</th><th>Estado</th><th>Detalle</th><th>Fecha</th><th>Respuesta</th><th></th></tr>
                    </thead>
                    <tbody>
                      {arsop.map(s => (
                        <tr key={s.folio}>
                          <td className="font-mono text-xs">{s.folio}</td>
                          <td className="text-xs">{s.tipoLabel}</td>
                          <td className="text-sm">{s.nombre} <span className="text-xs text-base-content/50">({s.rut})</span></td>
                          <td><span className={`badge badge-sm ${s.estado === "recibida" ? "badge-warning" : "badge-success"}`}>{s.estado}</span></td>
                          <td className="text-xs max-w-40 truncate">{s.detalle || "-"}</td>
                          <td className="text-xs">{s.creadoEn ? new Date(s.creadoEn).toLocaleDateString("es-CL") : ""}</td>
                          <td className="text-xs max-w-40 truncate">{s.respuesta || "-"}</td>
                          <td>
                            {s.estado === "recibida" && (
                              <button className="btn btn-xs btn-primary" onClick={() => setRespuestaFolio(s.folio)}>Responder</button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {arsop.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-base-content/50">Sin solicitudes</td></tr>}
                    </tbody>
                  </table>
                </div>

                {respuestaFolio && (
                  <div className="mt-4 p-4 bg-base-200 rounded-lg">
                    <h3 className="font-semibold mb-2">Responder solicitud {respuestaFolio}</h3>
                    <textarea className="textarea textarea-bordered w-full" placeholder="Escribe la respuesta..." value={respuestaTexto} onChange={(e) => setRespuestaTexto(e.target.value)} rows={3} />
                    <div className="flex gap-2 mt-2">
                      <button className="btn btn-sm btn-primary" onClick={handleResponder} disabled={!respuestaTexto}>Enviar Respuesta</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setRespuestaFolio(""); setRespuestaTexto(""); }}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: Blockchain */}
          {tab === "cadena" && (
            <div className="space-y-4">
              <div className="card bg-base-100 shadow">
                <div className="card-body p-4">
                  <h3 className="font-semibold">Integridad de la Cadena</h3>
                  <div className="flex items-center gap-4 mt-2">
                    {cadenaValida === true && <div className="badge badge-success badge-lg gap-2">✅ Cadena íntegra</div>}
                    {cadenaValida === false && <div className="badge badge-error badge-lg gap-2">❌ Cadena comprometida</div>}
                    <span className="text-sm text-base-content/60">{cadenaLongitud} bloques</span>
                    <button className="btn btn-xs btn-outline" onClick={fetchTab}>Verificar</button>
                    <button className="btn btn-xs btn-primary" onClick={handleSellar}>🔏 Sellar en Bitcoin</button>
                    <button className="btn btn-xs btn-outline btn-secondary" onClick={handleActualizarOts}>🔄 Actualizar OTS</button>
                  </div>
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body p-4">
                  <h3 className="font-semibold mb-3">Últimos Bloques</h3>
                  <div className="overflow-x-auto">
                    <table className="table table-xs">
                      <thead>
                        <tr><th>#</th><th>Evento</th><th>Folio</th><th>Hash</th><th>Prev Hash</th><th>Fecha</th></tr>
                      </thead>
                      <tbody>
                        {bloques.slice(0, 20).map(b => (
                          <tr key={b.indice}>
                            <td className="font-bold">{b.indice}</td>
                            <td><span className="badge badge-xs badge-outline">{b.evento}</span></td>
                            <td className="font-mono text-xs">{b.folio || "-"}</td>
                            <td className="font-mono text-xs text-primary">{b.hash?.substring(0, 12)}...</td>
                            <td className="font-mono text-xs text-base-content/50">{b.prev_hash?.substring(0, 12)}...</td>
                            <td className="text-xs">{b.creado_en ? new Date(b.creado_en).toLocaleString("es-CL") : ""}</td>
                          </tr>
                        ))}
                        {bloques.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-base-content/50">Sin bloques</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Auditoría */}
          {tab === "audit" && (
            <div className="card bg-base-100 shadow">
              <div className="card-body p-4">
                <div className="overflow-x-auto">
                  <table className="table table-xs">
                    <thead>
                      <tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>ID</th><th>Actor</th><th>Detalle</th><th>IP (hash)</th></tr>
                    </thead>
                    <tbody>
                      {audit.map(a => (
                        <tr key={a.id}>
                          <td className="text-xs">{a.created_at ? new Date(a.created_at).toLocaleString("es-CL") : ""}</td>
                          <td><span className="badge badge-xs badge-outline">{a.accion}</span></td>
                          <td className="text-xs">{a.entidad || "-"}</td>
                          <td className="font-mono text-xs">{a.entidad_id || "-"}</td>
                          <td className="text-xs">{a.actor || "-"}</td>
                          <td className="text-xs max-w-40 truncate">{a.detalle || "-"}</td>
                          <td className="font-mono text-xs text-base-content/40">{a.ip_hash?.substring(0, 8) || "-"}</td>
                        </tr>
                      ))}
                      {audit.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-base-content/50">Sin registros de auditoría</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
