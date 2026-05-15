"use client";

import { useState } from "react";

type TrackingEvent = {
  event_date: string;
  location: { terminal?: string; port?: string; country?: string; iso_code?: string };
  action: { action_name?: string };
  mode?: { transport_mode?: string; vessel?: { vessel_name?: string; voyage_nr?: string } };
  event_type: "actual" | "expected";
  event_recent?: boolean;
};

type TrackingData = {
  id: number;
  timestamp: string;
  scac: string;
  origin: { port?: string; country?: string; iso_code?: string };
  destination: { port?: string; country?: string; iso_code?: string };
  pol: { port?: string; country?: string; iso_code?: string; etd_date?: string };
  pod: { port?: string; country?: string; iso_code?: string; eta_date?: string };
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
      setError("El número de contenedor debe tener 11 caracteres (ej: MSCU1234567)");
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

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-[#1a2b4a] mb-6">Rastrea tu Contenedor</h1>

      {/* Search form */}
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
                className="input input-bordered w-full uppercase"
                value={container}
                onChange={(e) => setContainer(e.target.value.toUpperCase())}
                maxLength={11}
              />
            </label>
            <button
              type="submit"
              className={`btn btn-primary ${loading ? "btn-disabled" : ""}`}
              disabled={loading}
            >
              {loading ? <span className="loading loading-spinner loading-sm" /> : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
              Rastrear
            </button>
          </form>
          {error && (
            <div className="alert alert-error mt-3 text-sm">
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {data && (
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body p-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-xl bg-[#1a2b4a] flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#e8a838]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-[#1a2b4a]">{data.container.number}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  {data.container.type && <span className="text-sm text-gray-500">{data.container.type}</span>}
                  {data.scac && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">{data.scac}</span>}
                </div>
              </div>
              <span className={`text-xs px-3 py-1.5 rounded-full font-semibold ${data.container.completed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                {data.container.completed ? "✓ Completado" : "⟳ En tránsito"}
              </span>
            </div>

            {/* Route KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="text-xs text-gray-400 uppercase font-medium tracking-wider mb-1">Puerto de Carga (POL)</div>
                <div className="text-base font-semibold text-gray-800">
                  {data.pol.port ? `${data.pol.port}, ${data.pol.country}` : "No disponible"}
                </div>
                {data.pol.etd_date && <div className="text-sm text-gray-500 mt-1">ETD: {data.pol.etd_date}</div>}
              </div>
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="text-xs text-gray-400 uppercase font-medium tracking-wider mb-1">Puerto de Descarga (POD)</div>
                <div className="text-base font-semibold text-gray-800">
                  {data.pod.port ? `${data.pod.port}, ${data.pod.country}` : "No disponible"}
                </div>
                {data.pod.eta_date && <div className="text-sm text-emerald-600 font-semibold mt-1">ETA: {data.pod.eta_date}</div>}
              </div>
            </div>

            {data.origin.port && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100">
                  <div className="text-xs text-blue-400 uppercase font-medium tracking-wider mb-1">Origen</div>
                  <div className="text-sm font-medium text-gray-700">{data.origin.port}, {data.origin.country}</div>
                </div>
                <div className="bg-purple-50/50 rounded-xl p-4 border border-purple-100">
                  <div className="text-xs text-purple-400 uppercase font-medium tracking-wider mb-1">Destino Final</div>
                  <div className="text-sm font-medium text-gray-700">{data.destination.port}, {data.destination.country}</div>
                </div>
              </div>
            )}

            {/* Timeline */}
            {data.events && data.events.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[#1a2b4a] mb-4 uppercase tracking-wider">Seguimiento de Eventos</h3>
                <div className="space-y-0">
                  {data.events.map((evt, i) => {
                    const isLast = i === data.events.length - 1;
                    const isActual = evt.event_type === "actual";
                    const location = [evt.location.terminal, evt.location.port, evt.location.country].filter(Boolean).join(", ");
                    const vessel = evt.mode?.vessel?.vessel_name;
                    const voyage = evt.mode?.vessel?.voyage_nr;

                    return (
                      <div key={i} className="flex items-stretch">
                        {/* Bullet + Line */}
                        <div className="flex flex-col items-center w-6 mr-4">
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                            isActual ? "bg-emerald-500 border-emerald-500" : "bg-red-100 border-red-400"
                          }`}>
                            {evt.event_recent && (
                              <div className="w-full h-full rounded-full animate-ping bg-emerald-400 opacity-50" />
                            )}
                          </div>
                          {!isLast && (
                            <div className={`w-0.5 flex-1 min-h-[24px] ${isActual ? "bg-emerald-200" : "bg-red-200"}`} />
                          )}
                        </div>
                        {/* Content */}
                        <div className={`pb-4 flex-1 ${!isActual ? "opacity-70" : ""}`}>
                          <div className={`text-sm ${!isActual ? "text-red-500 italic" : "text-gray-800"}`}>
                            <span className="font-semibold">{evt.event_date}</span>
                            <span className="mx-2">·</span>
                            <span className={isActual ? "font-medium" : ""}>{evt.action.action_name || "Evento"}</span>
                          </div>
                          {location && (
                            <div className={`text-xs mt-1 ${!isActual ? "text-red-400" : "text-gray-500"}`}>
                              📍 {location}
                              {!isActual && <span className="ml-2 text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded">pendiente</span>}
                            </div>
                          )}
                          {vessel && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              🚢 {vessel}{voyage ? ` (Viaje: ${voyage})` : ""}
                            </div>
                          )}
                          {evt.mode?.transport_mode && !vessel && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              🚛 {evt.mode.transport_mode}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Timestamp */}
            <div className="text-xs text-gray-400 mt-4 text-right">
              Última consulta: {data.timestamp}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
