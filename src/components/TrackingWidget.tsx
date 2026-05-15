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

export default function TrackingWidget() {
  const [container, setContainer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<TrackingData | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const nr = container.trim().toUpperCase();
    if (nr.length !== 11) {
      setError("Debe tener 11 caracteres (ej: OERU4815696)");
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
    <div className="bg-white rounded-lg flex flex-col h-[520px] max-w-2xl mx-auto w-full overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-3.5 bg-[#1a2b4a] flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#e8a838]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-white">Tracking Contenedor</p>
          <p className="text-[11px] text-white/50">Seguimiento en tiempo real</p>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-gray-100">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            placeholder="Ej: OERU4815696"
            className="flex-1 bg-[#f8f9fb] rounded-full px-4 py-2 text-[13px] text-[#1a2b4a] focus:outline-none focus:ring-1 focus:ring-[#1a2b4a]/20 uppercase placeholder:normal-case"
            value={container}
            onChange={(e) => setContainer(e.target.value.toUpperCase())}
            maxLength={11}
          />
          <button
            type="submit"
            className="w-9 h-9 rounded-full bg-[#1a2b4a] text-white flex items-center justify-center hover:bg-[#243a5e] transition-colors disabled:opacity-30"
            disabled={loading}
          >
            {loading ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </button>
        </form>
        {error && <p className="text-xs text-red-500 mt-1.5 px-2">{error}</p>}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!data && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-full bg-[#1a2b4a]/5 flex items-center justify-center mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#1a2b4a]/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <p className="text-sm text-[#1a2b4a]/50">Ingresa un número de contenedor para rastrear</p>
            <p className="text-[11px] text-[#1a2b4a]/30 mt-1">Formato: 4 letras + 7 dígitos</p>
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Container info */}
            <div className="flex items-center gap-2.5">
              <div className="flex-1">
                <span className="text-sm font-bold text-[#1a2b4a]">{data.container.number}</span>
                {data.container.type && <span className="text-xs text-gray-400 ml-2">{data.container.type}</span>}
                {data.scac && <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full ml-2 font-medium">{data.scac}</span>}
              </div>
              <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${data.container.completed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                {data.container.completed ? "✓ Completado" : "⟳ En tránsito"}
              </span>
            </div>

            {/* Route */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <div className="text-[9px] text-gray-400 uppercase font-medium">POL</div>
                <div className="text-[11px] font-semibold text-gray-700">{data.pol.port ? `${data.pol.port}, ${data.pol.country}` : "—"}</div>
                {data.pol.etd_date && <div className="text-[10px] text-gray-400">ETD: {data.pol.etd_date}</div>}
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <div className="text-[9px] text-gray-400 uppercase font-medium">POD</div>
                <div className="text-[11px] font-semibold text-gray-700">{data.pod.port ? `${data.pod.port}, ${data.pod.country}` : "—"}</div>
                {data.pod.eta_date && <div className="text-[10px] text-emerald-600 font-semibold">ETA: {data.pod.eta_date}</div>}
              </div>
            </div>

            {/* Timeline */}
            {data.events && data.events.length > 0 && (
              <div className="space-y-0">
                <div className="text-[10px] text-gray-400 uppercase font-medium tracking-wider mb-2">Eventos</div>
                {data.events.map((evt, i) => {
                  const isLast = i === data.events.length - 1;
                  const isActual = evt.event_type === "actual";
                  const location = [evt.location.port, evt.location.country].filter(Boolean).join(", ");
                  const vessel = evt.mode?.vessel?.vessel_name;

                  return (
                    <div key={i} className="flex items-stretch">
                      <div className="flex flex-col items-center w-5 mr-3">
                        <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                          isActual ? "bg-emerald-500 border-emerald-500" : "bg-red-100 border-red-400"
                        }`} />
                        {!isLast && (
                          <div className={`w-0.5 flex-1 min-h-[18px] ${isActual ? "bg-emerald-200" : "bg-red-200"}`} />
                        )}
                      </div>
                      <div className={`pb-3 ${!isActual ? "opacity-70" : ""}`}>
                        <div className={`text-[11px] leading-tight ${!isActual ? "text-red-500 italic" : "text-gray-800"}`}>
                          <span className="font-semibold">{evt.event_date}</span>
                          <span className="mx-1.5">·</span>
                          <span>{evt.action.action_name || "Evento"}</span>
                        </div>
                        {location && (
                          <div className={`text-[10px] mt-0.5 ${!isActual ? "text-red-400" : "text-gray-400"}`}>
                            📍 {location}
                            {!isActual && <span className="ml-1 text-[9px] bg-red-50 text-red-500 px-1 py-0.5 rounded">pendiente</span>}
                          </div>
                        )}
                        {vessel && <div className="text-[10px] text-gray-400 mt-0.5">🚢 {vessel}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="text-[10px] text-gray-300 text-right">
              {data.timestamp}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
