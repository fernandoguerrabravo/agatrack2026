"use client";

import { useState } from "react";
import TrackingResult from "@/components/TrackingResult";
import type { TrackingData } from "@/components/TrackingResult";

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
      {data && <TrackingResult data={data} />}
    </div>
  );
}
