"use client";

import { useState } from "react";
import TrackingResult from "./TrackingResult";
import type { TrackingData } from "./TrackingResult";

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
            <div className="w-14 h-14 rounded-full bg-[#1a2b4a]/5 flex items-center justify-center mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-[#1a2b4a]/25" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <p className="text-sm text-[#1a2b4a]/50">Ingresa un número de contenedor</p>
            <p className="text-[11px] text-[#1a2b4a]/30 mt-1">4 letras + 7 dígitos</p>
          </div>
        )}

        {data && <TrackingResult data={data} compact />}
      </div>
    </div>
  );
}
