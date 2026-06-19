"use client";

import { useState, useEffect } from "react";

type Finalidad = { codigo: string; nombre: string; descripcion: string };
type Consentimiento = { folio: string; finalidades: string[]; estado: string; otorgadoEn: string; revocadoEn?: string; contenidoHash: string };

const TIPOS_ARSOP: Record<string, string> = {
  acceso: "Derecho de Acceso",
  rectificacion: "Derecho de Rectificación",
  supresion: "Derecho de Supresión",
  oposicion: "Derecho de Oposición",
  portabilidad: "Derecho de Portabilidad",
};

export default function ConsentimientoPanel() {
  const [finalidades, setFinalidades] = useState<Finalidad[]>([]);
  const [consentimientos, setConsentimientos] = useState<Consentimiento[]>([]);
  const [vigente, setVigente] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [arsopTipos, setArsopTipos] = useState<string[]>([]);
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
    if (arsopTipos.length === 0) { setMensaje("Selecciona al menos un derecho."); return; }
    // Enviar una solicitud por cada tipo seleccionado
    const folios: string[] = [];
    for (const tipo of arsopTipos) {
      const res = await fetch("/api/consentimiento", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "arsop", tipo, detalle: arsopDetalle }),
      });
      const data = await res.json();
      if (data.ok) folios.push(data.folio);
    }
    if (folios.length > 0) {
      setMensaje(`✅ ${folios.length} solicitud(es) registrada(s). Folios: ${folios.join(", ")}`);
      setArsopTipos([]); setArsopDetalle("");
    } else {
      setMensaje("❌ Error al enviar solicitudes.");
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

      {/* Tabs */}
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

        <input type="radio" name="consent_tabs" role="tab" className="tab" aria-label="⚖️ Mis Derechos" />
        <div role="tabpanel" className="tab-content pt-6">
          {/* Ejercer derechos ARSOP */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">Ejercer tus Derechos (Ley 21.719)</h2>
              <p className="text-sm text-base-content/70 mb-3">
                Puedes ejercer tus derechos de Acceso, Rectificación, Supresión, Oposición o Portabilidad de tus datos personales.
              </p>
              <div className="flex flex-col gap-3">
                <div className="space-y-2">
                  {Object.entries(TIPOS_ARSOP).map(([k, v]) => (
                    <label key={k} className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-base-200/50">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm checkbox-primary"
                        checked={arsopTipos.includes(k)}
                        onChange={(e) => setArsopTipos(e.target.checked ? [...arsopTipos, k] : arsopTipos.filter(t => t !== k))}
                      />
                      <span className="text-sm">{v}</span>
                    </label>
                  ))}
                  <button className="btn btn-xs btn-ghost" onClick={() => setArsopTipos(Object.keys(TIPOS_ARSOP))}>Seleccionar todos</button>
                </div>
                <textarea className="textarea textarea-bordered" placeholder="Describe tu solicitud (opcional)" value={arsopDetalle} onChange={(e) => setArsopDetalle(e.target.value)} rows={3} />
                <button className="btn btn-outline btn-primary w-fit" onClick={handleArsop} disabled={arsopTipos.length === 0}>
                  Enviar Solicitud
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
