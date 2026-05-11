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
  LineChart,
  Line,
  Legend,
} from "recharts";

type StatsData = {
  totals: {
    total_operaciones: number;
    total_iva: number;
    total_derechos_aduana: number;
    total_impuestos: number;
    total_cif: number;
  };
  bienCapital: {
    cantidad: number;
    total_cif_bk: number;
  };
  bienCapitalAnual: { mes: string; cantidad: number; total_cif_bk: number }[];
  porMes: {
    mes: string;
    cantidad: number;
    iva_mes: number;
    derechos_mes: number;
    total_impuestos_mes: number;
  }[];
  porOperacion: {
    operacion: string;
    cantidad: number;
    iva_total: number;
    derechos_total: number;
  }[];
};

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

export default function ImpuestosPanel() {
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

      const res = await fetch(`/api/importaciones/impuestos?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Error al cargar datos.");
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

  function handleActualizar() {
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
            <button className="btn btn-primary btn-sm" onClick={handleActualizar}>
              Actualizar
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">IVA Pagado</div>
          <div className="stat-value text-error text-2xl">{formatUSD(Number(data.totals.total_iva))}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Derechos de Aduana Pagados</div>
          <div className="stat-value text-warning text-2xl">{formatUSD(Number(data.totals.total_derechos_aduana))}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Beneficios Arancelarios Aplicados</div>
          <div className="stat-value text-success text-2xl">
            {formatUSD(Number(data.totals.total_cif) * 0.06 - Number(data.totals.total_derechos_aduana))}
          </div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total Operaciones</div>
          <div className="stat-value text-info">{data.totals.total_operaciones}</div>
        </div>
      </div>

      {/* Gráfico: IVA y Derechos por mes */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">IVA y Derechos de Aduana por Mes</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.porMes}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => formatUSD(Number(value))} />
                <Legend />
                <Bar dataKey="iva_mes" name="IVA" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="derechos_mes" name="Derechos Aduana" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Gráfico: Tendencia IVA y Derechos */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Tendencia IVA y Derechos de Aduana por Mes</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.porMes}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => formatUSD(Number(value))} />
                <Legend />
                <Line type="monotone" dataKey="iva_mes" name="IVA" stroke="#ef4444" strokeWidth={2} />
                <Line type="monotone" dataKey="derechos_mes" name="Derechos Aduana" stroke="#f59e0b" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Beneficio Bien de Capital */}
      <h2 className="text-lg font-semibold">Aplicaciones de Beneficios de Bienes de Capital</h2>
      <div className="flex flex-wrap gap-4">
        <div className="stat bg-base-100 rounded-lg shadow w-fit">
          <div className="stat-title">Total Operaciones Aplicadas</div>
          <div className="stat-value text-secondary">{Number(data.bienCapital.cantidad)}</div>
          <div className="stat-desc">{desde.split("-").reverse().join("-")} al {hasta.split("-").reverse().join("-")}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow w-fit">
          <div className="stat-title">Ahorro Bien de Capital</div>
          <div className="stat-value text-success text-2xl">{formatUSD(Number(data.bienCapital.total_cif_bk) * 0.06)}</div>
          <div className="stat-desc">{desde.split("-").reverse().join("-")} al {hasta.split("-").reverse().join("-")}</div>
        </div>
      </div>

      {/* Tendencia Bien de Capital por mes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Tendencia Operaciones Bien de Capital</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.bienCapitalAnual}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="cantidad" name="Operaciones" stroke="#8b5cf6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-base-content/50 text-center mt-1">
              Rango: {desde.split("-").reverse().join("-")} al {hasta.split("-").reverse().join("-")}
            </p>
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Tendencia Ahorro Bien de Capital</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.bienCapitalAnual.map((r) => ({ ...r, ahorro: Number(r.total_cif_bk) * 0.06 }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatUSD(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="ahorro" name="Ahorro (6% CIF)" stroke="#10b981" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-base-content/50 text-center mt-1">
              Rango: {desde.split("-").reverse().join("-")} al {hasta.split("-").reverse().join("-")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}