"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

type StatsData = {
  totals: {
    total_operaciones: number;
    total_fob_sum: number;
    promedio_fob: number;
    total_peso: number;
  };
  porMes: { mes: string; cantidad: number; fob_mes: number; peso_mes: number }[];
  porOperacion: { operacion: string; cantidad: number; fob_total: number; peso_total: number }[];
  porPais: { pais_destino: string; cantidad: number; fob_total: number; peso_total: number }[];
  porAduana: { aduana: string; cantidad: number; fob_total: number; peso_total: number }[];
};

const COLORS = [
  "#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

function getDefaultDesde(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function getDefaultHasta(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function formatUSD(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
}

function formatKg(value: number): string {
  return `${value.toLocaleString("es-CL")} kg`;
}

export default function EstadisticasPanel() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [desde, setDesde] = useState(getDefaultDesde);
  const [hasta, setHasta] = useState(getDefaultHasta);

  const fetchStats = useCallback(async (desdeVal: string, hastaVal: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (desdeVal) params.set("desde", desdeVal);
      if (hastaVal) params.set("hasta", hastaVal);

      const res = await fetch(`/api/despachos/stats?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Error al cargar estadísticas.");
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats(desde, hasta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBuscar() {
    fetchStats(desde, hasta);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error"><span>{error}</span></div>;
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Filtro de fechas */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
            <label className="form-control">
              <div className="label py-0"><span className="label-text text-xs">Fecha desde</span></div>
              <input type="date" className="input input-bordered input-sm" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label className="form-control">
              <div className="label py-0"><span className="label-text text-xs">Fecha hasta</span></div>
              <input type="date" className="input input-bordered input-sm" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-sm" onClick={handleBuscar}>Actualizar</button>
          </div>
        </div>
      </div>

      {/* KPIs: 3 dimensiones */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total Operaciones</div>
          <div className="stat-value text-primary">{Number(data.totals.total_operaciones).toLocaleString("es-CL")}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total FOB</div>
          <div className="stat-value text-success text-2xl">{formatUSD(Number(data.totals.total_fob_sum))}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total Peso</div>
          <div className="stat-value text-warning text-2xl">{formatKg(Number(data.totals.total_peso))}</div>
        </div>
      </div>

      {/* Gráficos por mes: FOB, Peso, Operaciones */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">FOB por Mes</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.porMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatUSD(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="fob_mes" name="FOB USD" stroke="#4f46e5" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Peso por Mes</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.porMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}t`} />
                  <Tooltip formatter={(value) => formatKg(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="peso_mes" name="Peso" stroke="#f59e0b" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Operaciones por Mes</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.porMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="cantidad" name="Cantidad" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico: Por tipo de operación */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Por Tipo de Operación</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.porOperacion}
                    dataKey="cantidad"
                    nameKey="operacion"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${String(name ?? "").substring(0, 15)}${String(name ?? "").length > 15 ? "..." : ""} (${((percent ?? 0) * 100).toFixed(0)}%)`
                    }
                    labelLine={false}
                  >
                    {data.porOperacion.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Gráfico: Top 10 países destino */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Top 10 Países Destino (FOB)</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.porPais} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="pais_destino" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip formatter={(value) => formatUSD(Number(value))} />
                  <Bar dataKey="fob_total" name="FOB USD" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla: Por País Destino - 3 dimensiones */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Por País Destino</h2>
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  <th>País</th>
                  <th className="text-right">Operaciones</th>
                  <th className="text-right">FOB Total</th>
                  <th className="text-right">Peso Total</th>
                </tr>
              </thead>
              <tbody>
                {data.porPais.map((row, i) => (
                  <tr key={i}>
                    <td>{String(row.pais_destino)}</td>
                    <td className="text-right">{Number(row.cantidad).toLocaleString("es-CL")}</td>
                    <td className="text-right">{formatUSD(Number(row.fob_total))}</td>
                    <td className="text-right">{formatKg(Number(row.peso_total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tabla: Por Aduana - 3 dimensiones */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Por Aduana</h2>
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  <th>Aduana</th>
                  <th className="text-right">Operaciones</th>
                  <th className="text-right">FOB Total</th>
                  <th className="text-right">Peso Total</th>
                </tr>
              </thead>
              <tbody>
                {data.porAduana.map((row, i) => (
                  <tr key={i}>
                    <td>{String(row.aduana)}</td>
                    <td className="text-right">{Number(row.cantidad).toLocaleString("es-CL")}</td>
                    <td className="text-right">{formatUSD(Number(row.fob_total))}</td>
                    <td className="text-right">{formatKg(Number(row.peso_total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tabla: Por Tipo de Operación - 3 dimensiones */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Por Tipo de Operación</h2>
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  <th>Operación</th>
                  <th className="text-right">Operaciones</th>
                  <th className="text-right">FOB Total</th>
                  <th className="text-right">Peso Total</th>
                </tr>
              </thead>
              <tbody>
                {data.porOperacion.map((row, i) => (
                  <tr key={i}>
                    <td>{String(row.operacion)}</td>
                    <td className="text-right">{Number(row.cantidad).toLocaleString("es-CL")}</td>
                    <td className="text-right">{formatUSD(Number(row.fob_total))}</td>
                    <td className="text-right">{formatKg(Number(row.peso_total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
