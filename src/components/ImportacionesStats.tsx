"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
    total_cif_sum: number;
    promedio_cif: number;
    total_fob_sum: number;
    total_kilos: number;
    total_flete: number;
    total_seguro: number;
  };
  porMes: { mes: string; cantidad: number; cif_mes: number; fob_mes: number; kilos_mes: number }[];
  porOperacion: { operacion: string; cantidad: number; cif_total: number; peso_total: number }[];
  porPaisOrigen: { pais: string; cantidad: number; cif_total: number; peso_total: number }[];
  porAduana: { aduana: string; cantidad: number; cif_total: number; peso_total: number }[];
  porIncoterms: { incoterm: string; cantidad: number; cif_total: number; peso_total: number }[];
  porEmisor: { emisor: string; cantidad: number; kilos: number; flete: number }[];
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
  return Math.round(value).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function ImportacionesStats() {
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

      const res = await fetch(`/api/importaciones/stats?${params.toString()}`);
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

  function handleActualizar() {
    fetchStats(desde, hasta);
  }

  // Agrupar emisores con nombres similares
  const emisoresAgrupados = useMemo(() => {
    if (!data?.porEmisor) return [];

    type EmisorRow = { emisor: string; cantidad: number; kilos: number; flete: number };
    const rows = data.porEmisor as EmisorRow[];

    // Normalizar: quitar puntos, espacios extra, trim, uppercase
    function normalize(name: string): string {
      return name
        .toUpperCase()
        .replace(/\./g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    // Verificar si dos nombres son similares (uno contiene al otro o comparten prefijo largo)
    function areSimilar(a: string, b: string): boolean {
      const na = normalize(a);
      const nb = normalize(b);
      if (na === nb) return true;
      if (na.includes(nb) || nb.includes(na)) return true;
      // Comparar las primeras N palabras significativas
      const wordsA = na.split(" ").filter((w) => w.length > 2);
      const wordsB = nb.split(" ").filter((w) => w.length > 2);
      if (wordsA.length === 0 || wordsB.length === 0) return false;
      // Si comparten al menos las 2 primeras palabras significativas
      const minWords = Math.min(wordsA.length, wordsB.length, 2);
      let matchingWords = 0;
      for (let i = 0; i < minWords; i++) {
        if (wordsA[i] === wordsB[i]) matchingWords++;
      }
      if (matchingWords >= 2) return true;
      // Prefijo compartido de al menos 60% del más corto
      const minLen = Math.min(na.length, nb.length);
      const threshold = Math.floor(minLen * 0.6);
      if (threshold < 4) return false;
      let common = 0;
      for (let i = 0; i < Math.min(na.length, nb.length); i++) {
        if (na[i] === nb[i]) common++;
        else break;
      }
      return common >= threshold;
    }

    // Agrupar
    const groups: { name: string; cantidad: number; kilos: number; flete: number }[] = [];

    for (const row of rows) {
      const existing = groups.find((g) => areSimilar(g.name, row.emisor));
      if (existing) {
        existing.cantidad += Number(row.cantidad);
        existing.kilos += Number(row.kilos);
        existing.flete += Number(row.flete);
        if (row.emisor.replace(/\./g, "").trim().length > existing.name.replace(/\./g, "").trim().length) {
          existing.name = row.emisor;
        }
      } else {
        groups.push({
          name: row.emisor,
          cantidad: Number(row.cantidad),
          kilos: Number(row.kilos),
          flete: Number(row.flete),
        });
      }
    }

    return groups.sort((a, b) => b.cantidad - a.cantidad);
  }, [data]);

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
          <div className="stat-title">Total Operaciones</div>
          <div className="stat-value text-primary">{data.totals.total_operaciones}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total CIF</div>
          <div className="stat-value text-success text-2xl">{formatUSD(Number(data.totals.total_cif_sum))}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total FOB</div>
          <div className="stat-value text-info text-2xl">{formatUSD(Number(data.totals.total_fob_sum))}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total Kilos</div>
          <div className="stat-value text-warning text-2xl">{Math.round(Number(data.totals.total_kilos)).toLocaleString("es-CL")} kg</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total Flete</div>
          <div className="stat-value text-secondary text-2xl">{formatUSD(Number(data.totals.total_flete))}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Total Seguro</div>
          <div className="stat-value text-accent text-2xl">{formatUSD(Number(data.totals.total_seguro))}</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Promedio CIF</div>
          <div className="stat-value text-base-content text-2xl">{formatUSD(Number(data.totals.promedio_cif))}</div>
        </div>
      </div>

      {/* Gráficos: CIF por mes, Kilos por mes y Operaciones por mes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">CIF por Mes</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.porMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatUSD(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="cif_mes" name="CIF USD" stroke="#4f46e5" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Kilos por Mes</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.porMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}t`} />
                  <Tooltip formatter={(value) => `${Number(value).toLocaleString("es-CL")} kg`} />
                  <Legend />
                  <Line type="monotone" dataKey="kilos_mes" name="Kilos" stroke="#f59e0b" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Operaciones por Mes</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.porMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="cantidad" name="Cantidad" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Por tipo de operación */}
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

        {/* Top 10 países origen */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Top 10 Países Origen (CIF)</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.porPaisOrigen} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="pais" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip formatter={(value) => formatUSD(Number(value))} />
                  <Bar dataKey="cif_total" name="CIF USD" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Por aduana */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Por Aduana</h2>
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>Aduana</th>
                    <th className="text-right">Operaciones</th>
                    <th className="text-right">CIF Total</th>
                    <th className="text-right">Peso Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.porAduana.map((row, i) => (
                    <tr key={i}>
                      <td>{String(row.aduana)}</td>
                      <td className="text-right">{Number(row.cantidad).toLocaleString("es-CL")}</td>
                      <td className="text-right">{formatUSD(Number(row.cif_total))}</td>
                      <td className="text-right">{Number(row.peso_total).toLocaleString("es-CL")} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Por incoterms */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Por Incoterms</h2>
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>Incoterm</th>
                    <th className="text-right">Operaciones</th>
                    <th className="text-right">CIF Total</th>
                    <th className="text-right">Peso Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.porIncoterms.map((row, i) => (
                    <tr key={i}>
                      <td>{String(row.incoterm)}</td>
                      <td className="text-right">{Number(row.cantidad).toLocaleString("es-CL")}</td>
                      <td className="text-right">{formatUSD(Number(row.cif_total))}</td>
                      <td className="text-right">{Number(row.peso_total).toLocaleString("es-CL")} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla: Por País Origen - 3 dimensiones */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Por País Origen</h2>
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  <th>País</th>
                  <th className="text-right">Operaciones</th>
                  <th className="text-right">CIF Total</th>
                  <th className="text-right">Peso Total</th>
                </tr>
              </thead>
              <tbody>
                {data.porPaisOrigen.map((row, i) => (
                  <tr key={i}>
                    <td>{String(row.pais)}</td>
                    <td className="text-right">{Number(row.cantidad).toLocaleString("es-CL")}</td>
                    <td className="text-right">{formatUSD(Number(row.cif_total))}</td>
                    <td className="text-right">{Number(row.peso_total).toLocaleString("es-CL")} kg</td>
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
                  <th className="text-right">CIF Total</th>
                  <th className="text-right">Peso Total</th>
                </tr>
              </thead>
              <tbody>
                {data.porOperacion.map((row, i) => (
                  <tr key={i}>
                    <td>{String(row.operacion)}</td>
                    <td className="text-right">{Number(row.cantidad).toLocaleString("es-CL")}</td>
                    <td className="text-right">{formatUSD(Number(row.cif_total))}</td>
                    <td className="text-right">{Number(row.peso_total).toLocaleString("es-CL")} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Por emisor documento transporte */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-lg">Por Emisor Documento Transporte</h2>
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  <th>Emisor</th>
                  <th className="text-right">Operaciones</th>
                  <th className="text-right">Kilos</th>
                  <th className="text-right">Valor Flete</th>
                </tr>
              </thead>
              <tbody>
                {emisoresAgrupados.map((row, i) => (
                  <tr key={i}>
                    <td>{String(row.name)}</td>
                    <td className="text-right">{Number(row.cantidad)}</td>
                    <td className="text-right">{Number(row.kilos).toLocaleString("es-CL")} kg</td>
                    <td className="text-right">{formatUSD(Number(row.flete))}</td>
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
