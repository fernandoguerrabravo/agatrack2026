"use client";

import { useState, useEffect } from "react";

type Finalidad = { codigo: string; nombre: string; descripcion: string };
type Solicitud = { folio: string; tipo: string; tipoLabel: string; estado: string; detalle?: string; respuesta?: string; creadoEn: string; respondidoEn?: string; diasRestantes?: number | null };

type Consentimiento = { folio: string; finalidades: string[]; estado: string; otorgadoEn: string; revocadoEn?: string; contenidoHash: string };

const TIPOS_ARSOP: Record<string, { nombre: string; descripcion: string }> = {
  acceso: { nombre: "Derecho de Acceso", descripcion: "Solicitar qué datos personales tuyos tenemos almacenados y cómo los tratamos." },
  rectificacion: { nombre: "Derecho de Rectificación", descripcion: "Corregir datos personales inexactos o incompletos." },
  supresion: { nombre: "Derecho de Supresión", descripcion: "Eliminar tus datos personales cuando ya no sean necesarios para la finalidad." },
  oposicion: { nombre: "Derecho de Oposición", descripcion: "Oponerte al tratamiento de tus datos para una finalidad específica." },
  portabilidad: { nombre: "Derecho de Portabilidad", descripcion: "Recibir tus datos en formato estructurado para transferirlos a otro responsable." },
};

export default function ConsentimientoPanel() {
  const [finalidades, setFinalidades] = useState<Finalidad[]>([]);
  const [consentimientos, setConsentimientos] = useState<Consentimiento[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [vigente, setVigente] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [arsopTipo, setArsopTipo] = useState("");
  const [arsopDetalle, setArsopDetalle] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    const [fRes, cRes] = await Promise.all([
      fetch("/api/consentimiento?finalidades=true"),
      fetch("/api/consentimiento"),
    ]);
    const fData = await fRes.json();
    const cData = await cRes.json();
    setFinalidades(fData.finalidades || []);
    setConsentimientos(cData.consentimientos || []);
    setSolicitudes(cData.solicitudes || []);
    setVigente(cData.vigente || false);
    setLoading(false);
  }

  async function handleOtorgar() {
    if (selected.length === 0) { setMensaje("Selecciona al menos una finalidad."); return; }
    const res = await fetch("/api/consentimiento", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "otorgar", finalidades: selected }),
    });
    const data = await res.json();
    if (data.ok) {
      setMensaje(`✅ Consentimiento otorgado. Folio: ${data.folio}. Hash blockchain: ${data.contenidoHash?.substring(0, 16)}...`);
      fetchData();
    } else {
      setMensaje(`❌ ${data.error}`);
    }
  }

  async function handleRevocar(folio: string) {
    if (!confirm("¿Estás seguro de revocar este consentimiento?")) return;
    const res = await fetch("/api/consentimiento", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "revocar", folio }),
    });
    const data = await res.json();
    setMensaje(data.ok ? "✅ Consentimiento revocado." : "❌ No se pudo revocar.");
    fetchData();
  }

  async function handleArsop() {
    if (!arsopTipo) { setMensaje("Selecciona un derecho."); return; }
    const res = await fetch("/api/consentimiento", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "arsop", tipo: arsopTipo, detalle: arsopDetalle }),
    });
    const data = await res.json();
    if (data.ok) {
      setMensaje(`✅ Solicitud registrada. Folio: ${data.folio}`);
      setArsopTipo(""); setArsopDetalle("");
      fetchData();
    } else {
      setMensaje(`❌ ${data.error}`);
    }
  }

  if (loading) return <div className="flex justify-center py-10"><span className="loading loading-spinner loading-lg"></span></div>;

  return (
    <div className="space-y-6">
      {mensaje && (
        <div className={`alert ${mensaje.startsWith("✅") ? "alert-success" : "alert-error"}`}>
          <span>{mensaje}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setMensaje("")}>✕</button>
        </div>
      )}

      {/* Tabs - solo mostrar derechos si tiene consentimiento vigente */}
      <div role="tablist" className="tabs tabs-boxed">
        <input type="radio" name="consent_tabs" role="tab" className="tab" aria-label="📋 Mi Consentimiento" defaultChecked />
        <div role="tabpanel" className="tab-content pt-6 space-y-6">

          {/* Estado actual */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">Estado de tu Consentimiento</h2>
              {vigente ? (
                <div className="badge badge-success badge-lg gap-2">✓ Consentimiento vigente</div>
              ) : (
                <div className="badge badge-warning badge-lg gap-2">⚠️ Sin consentimiento vigente</div>
              )}
            </div>
          </div>

          {/* Otorgar consentimiento */}
          {!vigente && (
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title">Otorgar Consentimiento</h2>
                <p className="text-sm text-base-content/70 mb-4">
                  De acuerdo a la Ley 21.719 de Protección de Datos Personales, selecciona las finalidades para las cuales autorizas el tratamiento de tus datos:
                </p>
                <div className="space-y-3">
                  {finalidades.map(f => (
                    <label key={f.codigo} className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-base-200/50">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary mt-1"
                        checked={selected.includes(f.codigo)}
                        onChange={(e) => setSelected(e.target.checked ? [...selected, f.codigo] : selected.filter(s => s !== f.codigo))}
                      />
                      <div>
                        <div className="font-semibold">{f.nombre}</div>
                        <div className="text-sm text-base-content/60">{f.descripcion}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <button className="btn btn-primary" onClick={() => setSelected(finalidades.map(f => f.codigo))}>Seleccionar todas</button>
                  <button className="btn btn-success" onClick={handleOtorgar} disabled={selected.length === 0}>
                    Otorgar Consentimiento
                  </button>
                </div>
                <p className="text-xs text-base-content/50 mt-2">
                  Tu consentimiento será registrado en una cadena de bloques inmutable con sello de tiempo OpenTimestamps (Bitcoin).
                </p>
              </div>
            </div>
          )}

          {/* Historial de consentimientos */}
          {consentimientos.length > 0 && (
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title">Historial de Consentimientos</h2>
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr><th>Folio</th><th>Estado</th><th>Finalidades</th><th>Fecha</th><th>Hash</th><th></th></tr>
                    </thead>
                    <tbody>
                      {consentimientos.map(c => (
                        <tr key={c.folio}>
                          <td className="font-mono text-xs">{c.folio}</td>
                          <td><span className={`badge badge-sm ${c.estado === "otorgado" ? "badge-success" : "badge-error"}`}>{c.estado}</span></td>
                          <td className="text-xs">{c.finalidades.join(", ")}</td>
                          <td className="text-xs">{c.otorgadoEn ? new Date(c.otorgadoEn).toLocaleDateString("es-CL") : ""}</td>
                          <td className="font-mono text-xs">{c.contenidoHash?.substring(0, 12)}...</td>
                          <td>{c.estado === "otorgado" && <button className="btn btn-xs btn-error btn-outline" onClick={() => handleRevocar(c.folio)}>Revocar</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <input type="radio" name="consent_tabs" role="tab" className={`tab ${!vigente ? "hidden" : ""}`} aria-label="⚖️ Solicitar Derechos" />
        <div role="tabpanel" className="tab-content pt-6">
          {/* Ejercer derechos ARSOP */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">Solicitar Derechos (Ley 21.719)</h2>
              <p className="text-sm text-base-content/70 mb-3">
                La Ley 21.719 de Protección de Datos Personales te garantiza el ejercicio de los siguientes derechos sobre tus datos. 
                Selecciona el derecho que deseas ejercer y describe brevemente tu solicitud. Tenemos un plazo legal de 30 días hábiles para responder.
              </p>
              <div className="flex flex-col gap-3">
                <div className="space-y-2">
                  {Object.entries(TIPOS_ARSOP).map(([k, v]) => (
                    <label key={k} className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-base-200/50">
                      <input
                        type="radio"
                        name="arsop_tipo"
                        className="radio radio-sm radio-primary mt-1"
                        checked={arsopTipo === k}
                        onChange={() => setArsopTipo(k)}
                      />
                      <div>
                        <div className="font-semibold text-sm">{v.nombre}</div>
                        <div className="text-xs text-base-content/60">{v.descripcion}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <textarea className="textarea textarea-bordered" placeholder="Describe tu solicitud (opcional)" value={arsopDetalle} onChange={(e) => setArsopDetalle(e.target.value)} rows={3} />
                <button className="btn btn-outline btn-primary w-fit" onClick={handleArsop} disabled={!arsopTipo}>
                  Enviar Solicitud
                </button>
              </div>
            </div>
          </div>

          {/* Mis solicitudes */}
          {solicitudes.length > 0 && (
            <div className="card bg-base-100 shadow mt-6">
              <div className="card-body">
                <h2 className="card-title">Mis Solicitudes</h2>
                <p className="text-xs text-base-content/60 mb-3">La ley establece un plazo máximo de 30 días hábiles para responder.</p>
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr><th>Folio</th><th>Derecho</th><th>Estado</th><th>Fecha</th><th>Plazo</th><th>Respuesta</th></tr>
                    </thead>
                    <tbody>
                      {solicitudes.map(s => (
                        <tr key={s.folio}>
                          <td className="font-mono text-xs">{s.folio}</td>
                          <td className="text-sm">{s.tipoLabel}</td>
                          <td>
                            <span className={`badge badge-sm ${s.estado === "recibida" ? "badge-warning" : s.estado === "respondida" ? "badge-success" : "badge-error"}`}>
                              {s.estado}
                            </span>
                          </td>
                          <td className="text-xs">{s.creadoEn ? new Date(s.creadoEn).toLocaleDateString("es-CL") : ""}</td>
                          <td className="text-xs">
                            {s.estado === "recibida" && s.diasRestantes != null && (() => {
                              const deadline = new Date(new Date(s.creadoEn).getTime() + 42 * 86400000);
                              const fechaLimite = `${String(deadline.getDate()).padStart(2,"0")}/${String(deadline.getMonth()+1).padStart(2,"0")}/${deadline.getFullYear()}`;
                              return <span className={s.diasRestantes <= 5 ? "text-error font-bold" : ""}>{fechaLimite} ({s.diasRestantes}d)</span>;
                            })()}
                            {s.estado === "respondida" && "✓"}
                          </td>
                          <td className="text-xs max-w-48 truncate">{s.respuesta || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
