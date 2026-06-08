"use client";

import { useState } from "react";

const SHIPSGO_EMBED_TOKEN = "5ad957ed-7ef8-4480-803e-2c941a6a26f4";

type ShipsGoData = {
  id: number;
  booking_number: string;
  status: string;
  carrier?: { name: string };
  route?: {
    port_of_loading?: { location?: { name: string }; date_of_loading?: string };
    port_of_discharge?: { location?: { name: string }; date_of_discharge?: string };
    transit_time?: number;
    transit_percentage?: number;
    co2_emission?: number;
  };
  containers?: Array<{
    number: string;
    status: string;
    size: number;
    type: string;
    movements?: Array<{
      event: string;
      status: string;
      location?: { name: string; code: string };
      vessel?: { name: string };
      voyage?: string;
      timestamp?: string;
    }>;
  }>;
};

export default function TrackingContenedoresPanel() {
  const [blNumber, setBlNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<ShipsGoData | null>(null);
  const [showEmbed, setShowEmbed] = useState(false);

  async function handleBuscar() {
    const bl = blNumber.trim().toUpperCase();
    if (!bl) return;

    setLoading(true);
    setError("");
    setData(null);
    setShowEmbed(false);

    try {
      const res = await fetch("/api/tracking-contenedores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bl_number: bl }),
      });
      const result = await res.json();

      if (!res.ok) {
        setError(result.error || "Error al buscar");
        return;
      }

      setData(result.shipsgo);
      setShowEmbed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Búsqueda */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Tracking de Contenedores</h2>
          <p className="text-xs text-base-content/60 mb-3">Ingrese el número de BL Master para rastrear su embarque</p>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Nro. BL Master (ej: MEDUO9744824)"
              className="input input-bordered flex-1"
              value={blNumber}
              onChange={(e) => setBlNumber(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
              disabled={loading}
            />
            <button className={`btn btn-primary ${loading ? "loading" : ""}`} onClick={handleBuscar} disabled={loading || !blNumber.trim()}>
              {loading ? "Buscando..." : "Rastrear"}
            </button>
          </div>
          {error && <p className="text-error text-sm mt-2">{error}</p>}
        </div>
      </div>

      {/* Resultado */}
      {data && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            {/* Info general */}
            <div className="flex flex-wrap gap-4 text-sm mb-4">
              <span><b>BL:</b> {data.booking_number}</span>
              <span><b>Naviera:</b> {data.carrier?.name || "N/D"}</span>
              <span><b>Estado:</b> <span className={`badge badge-sm ${data.status === "DELIVERED" ? "badge-success" : data.status === "SAILING" ? "badge-info" : "badge-warning"}`}>{data.status}</span></span>
              {data.route && (
                <>
                  <span><b>Origen:</b> {data.route.port_of_loading?.location?.name || ""}</span>
                  <span><b>Destino:</b> {data.route.port_of_discharge?.location?.name || ""}</span>
                  <span><b>ETA:</b> {data.route.port_of_discharge?.date_of_discharge ? new Date(data.route.port_of_discharge.date_of_discharge).toLocaleDateString("es-CL") : "N/D"}</span>
                  <span><b>Tránsito:</b> {data.route.transit_time || 0} días ({data.route.transit_percentage || 0}%)</span>
                  {data.route.co2_emission && <span><b>CO₂:</b> {data.route.co2_emission} ton</span>}
                </>
              )}
            </div>

            {/* Mapa embebido */}
            {showEmbed && (
              <div className="mb-4">
                <iframe
                  src={`https://embed.shipsgo.com/?token=${SHIPSGO_EMBED_TOKEN}&transport=ocean&query=${data.booking_number}&tabs=none`}
                  className="w-full h-64 rounded-lg border border-base-300"
                  title="Tracking ShipsGo"
                  allowFullScreen
                />
              </div>
            )}

            {/* Contenedores y movimientos */}
            {data.containers && data.containers.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Contenedores ({data.containers.length})</h3>
                {data.containers.map((cont, i) => (
                  <div key={i} className="bg-base-200 rounded-lg p-3 mb-3">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="badge badge-primary">{cont.number}</span>
                      <span className="text-xs">{cont.size}{cont.type}</span>
                      <span className={`badge badge-xs ${cont.status === "DELIVERED" ? "badge-success" : "badge-info"}`}>{cont.status}</span>
                    </div>
                    {cont.movements && cont.movements.length > 0 && (
                      <table className="table table-xs w-full">
                        <thead><tr><th>Evento</th><th>Fecha</th><th>Puerto</th><th>Nave</th><th></th></tr></thead>
                        <tbody>
                          {cont.movements.map((m, j) => (
                            <tr key={j}>
                              <td><span className="badge badge-xs badge-ghost">{m.event}</span></td>
                              <td>{m.timestamp ? new Date(m.timestamp).toLocaleDateString("es-CL") : ""}</td>
                              <td>{m.location?.name || ""}</td>
                              <td>{m.vessel?.name || "-"}{m.voyage ? ` ${m.voyage}` : ""}</td>
                              <td>{m.status === "ACT" ? "✅" : "⏳"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="card bg-base-100 shadow">
          <div className="card-body flex items-center gap-3">
            <span className="loading loading-spinner"></span>
            <span>Buscando información del embarque...</span>
          </div>
        </div>
      )}
    </div>
  );
}
