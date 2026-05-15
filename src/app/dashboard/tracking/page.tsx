"use client";

import { useState } from "react";

type TrackingEvent = {
  event_date: string;
  location: { terminal?: string; port?: string; country?: string };
  action: { action_name?: string };
  mode?: { transport_mode?: string; vessel?: { vessel_name?: string; voyage_nr?: string } };
  event_type: "actual" | "expected";
  event_recent?: boolean;
};

type TrackingData = {
  timestamp: string;
  scac: string;
  origin: { port?: string; country?: string };
  destination: { port?: string; country?: string };
  pol: { port?: string; country?: string; etd_date?: string };
  pod: { port?: string; country?: string; eta_date?: string };
  container: { number: string; type?: string; completed?: boolean };
  events: TrackingEvent[];
};

export default function TrackingPage() {
  const [container, setContainer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<TrackingData | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const nr = container.trim().toUpperCase();
    if (nr.length !== 11) {
      setError("El número de contenedor debe tener 11 caracteres (ej: OERU4815696)");
      return;
    }
    setError("");
    setData(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ container: nr }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Error al consultar.");
        return;
      }
      setData(json);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  function getProgress(): number {
    if (!data?.events || data.events.length === 0) return 0;
    const actualEvents = data.events.filter(e => e.event_type === "actual").length;
    const totalEvents = data.events.length;
    if (data.container.completed) return 100;
    return Math.round((actualEvents / totalEvents) * 100);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-[#1a2b4a] mb-6">Rastrea tu Contenedor</h1>

      {/* Search */}
      <div className="card bg-base-100 shadow-sm mb-6">
        <div className="card-body p-5">
          <form onSubmit={handleSearch} className="flex gap-3 items-end">
            <label className="form-control flex-1">
              <div className="label py-0">
                <span className="label-text text-sm">Número de Contenedor</span>
              </div>
              <input
                type="text"
                placeholder="Ej: OERU4815696"
                className="input input-bordered w-full uppercase text-lg tracking-wider"
                value={container}
                onChange={(e) => setContainer(e.target.value.toUpperCase())}
                maxLength={11}
              />
            </label>
            <button type="submit" className={`btn btn-primary btn-lg ${loading ? "btn-disabled" : ""}`} disabled={loading}>
              {loading ? <span className="loading loading-spinner" /> : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
              Rastrear
            </button>
          </form>
          {error && <div className="alert alert-error mt-3 text-sm"><span>{error}</span></div>}
        </div>
      </div>

      {/* Results */}
      {data && (
        <div className="space-y-6">
          {/* Container header card */}
          <div className="card bg-[#1a2b4a] text-white shadow-lg">
            <div className="card-body p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-[#e8a838]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-wider">{data.container.number}</h2>
                    <div className="flex items-center gap-3 mt-1">
                      {data.scac && <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded-full font-medium">{data.scac}</span>}
                    </div>
                  </div>
                </div>
                <div className={`px-4 py-2 rounded-xl text-sm font-bold ${data.container.completed ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                  {data.container.completed ? "✓ Entregado" : "⟳ En tránsito"}
                </div>
              </div>

              {/* Vessel + Container type badges */}
              <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-white/10">
                {data.container.type && (
                  <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                    <span className="text-base">📦</span>
                    <div>
                      <div className="text-[10px] text-white/50 uppercase">Tipo Contenedor</div>
                      <div className="text-sm font-bold text-[#e8a838]">{data.container.type}</div>
                    </div>
                  </div>
                )}
                {(() => {
                  const vesselEvt = data.events?.find(e => e.mode?.vessel?.vessel_name);
                  const vesselName = vesselEvt?.mode?.vessel?.vessel_name;
                  const voyageNr = vesselEvt?.mode?.vessel?.voyage_nr;
                  if (!vesselName) return null;
                  return (
                    <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                      <span className="text-base">🚢</span>
                      <div>
                        <div className="text-[10px] text-white/50 uppercase">Nave / Viaje</div>
                        <div className="text-sm font-bold text-white">{vesselName}{voyageNr ? ` · ${voyageNr}` : ""}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Route visual */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-6">
              <div className="flex items-center justify-between mb-4">
                {/* Origin */}
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-[#1a2b4a]/10 flex items-center justify-center mx-auto mb-2">
                    <span className="text-lg">🏭</span>
                  </div>
                  <div className="text-xs text-gray-400 uppercase font-bold">Origen</div>
                  <div className="text-sm font-bold text-[#1a2b4a]">{data.pol.port || "—"}</div>
                  <div className="text-xs text-gray-400">{data.pol.country}</div>
                  {data.pol.etd_date && <div className="text-xs text-gray-500 mt-1 bg-gray-50 px-2 py-0.5 rounded-full inline-block">ETD: {data.pol.etd_date}</div>}
                </div>

                {/* Route line */}
                <div className="flex-1 mx-6">
                  <div className="relative">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#1a2b4a] via-[#e8a838] to-emerald-500 rounded-full transition-all duration-700"
                        style={{ width: `${getProgress()}%` }}
                      />
                    </div>
                    {/* Ship indicator */}
                    <div className="absolute top-1/2 -translate-y-1/2 transition-all duration-700" style={{ left: `${getProgress()}%` }}>
                      <div className="w-8 h-8 bg-[#e8a838] rounded-full flex items-center justify-center shadow-lg -ml-4 border-3 border-white">
                        <span className="text-sm">🚢</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-center mt-3">
                    <span className="text-xs font-bold text-[#e8a838]">{getProgress()}% completado</span>
                  </div>
                </div>

                {/* Destination */}
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-2">
                    <span className="text-lg">🏗️</span>
                  </div>
                  <div className="text-xs text-gray-400 uppercase font-bold">Destino</div>
                  <div className="text-sm font-bold text-emerald-700">{data.pod.port || "—"}</div>
                  <div className="text-xs text-gray-400">{data.pod.country}</div>
                  {data.pod.eta_date && <div className="text-xs text-emerald-600 font-bold mt-1 bg-emerald-50 px-2 py-0.5 rounded-full inline-block">ETA: {data.pod.eta_date}</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          {data.events && data.events.length > 0 && (
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-6">
                <h3 className="text-sm font-bold text-[#1a2b4a] uppercase tracking-wider mb-4">Historial de Eventos</h3>
                <div className="space-y-0">
                  {data.events.map((evt, i) => {
                    const isLast = i === data.events.length - 1;
                    const isActual = evt.event_type === "actual";
                    const location = [evt.location.terminal, evt.location.port, evt.location.country].filter(Boolean).join(", ");
                    const vessel = evt.mode?.vessel?.vessel_name;
                    const voyage = evt.mode?.vessel?.voyage_nr;
                    const transport = evt.mode?.transport_mode;

                    return (
                      <div key={i} className="flex items-stretch">
                        {/* Bullet + Line */}
                        <div className="flex flex-col items-center w-7 mr-4">
                          <div className={`w-4 h-4 rounded-full flex-shrink-0 border-2 ${
                            isActual
                              ? evt.event_recent
                                ? "bg-emerald-500 border-emerald-500 ring-4 ring-emerald-100"
                                : "bg-emerald-500 border-emerald-500"
                              : "bg-white border-red-300 border-dashed"
                          }`} />
                          {!isLast && (
                            <div className={`w-0.5 flex-1 min-h-[28px] ${isActual ? "bg-emerald-200" : "bg-red-100"}`} />
                          )}
                        </div>
                        {/* Content */}
                        <div className={`pb-4 flex-1 ${!isActual ? "opacity-60" : ""}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${!isActual ? "text-red-400" : "text-[#1a2b4a]"}`}>{evt.event_date}</span>
                            {evt.event_recent && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">ÚLTIMO</span>}
                            {!isActual && <span className="text-[9px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full font-bold">PENDIENTE</span>}
                          </div>
                          <div className={`text-sm mt-0.5 ${!isActual ? "text-red-400 italic" : "text-gray-700 font-medium"}`}>
                            {evt.action.action_name || "Evento"}
                          </div>
                          {location && (
                            <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                              <span>📍</span> {location}
                            </div>
                          )}
                          {vessel && (
                            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                              <span>🚢</span> {vessel}{voyage ? ` · Viaje ${voyage}` : ""}
                            </div>
                          )}
                          {transport && !vessel && (
                            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                              <span>🚛</span> {transport}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-xs text-gray-400 text-right">
            Última consulta: {data.timestamp}
          </div>
        </div>
      )}
    </div>
  );
}
