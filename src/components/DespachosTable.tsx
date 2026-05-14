"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";

type Row = Record<string, unknown>;

const PAGE_SIZE = 25;

function getDefaultDesde(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-01`;
}

function getDefaultHasta(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export default function DespachosTable() {
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);

  // Filtro de fechas
  const [desde, setDesde] = useState(getDefaultDesde);
  const [hasta, setHasta] = useState(getDefaultHasta);

  const fetchData = useCallback(async (desdeVal: string, hastaVal: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (desdeVal) params.set("desde", desdeVal);
      if (hastaVal) params.set("hasta", hastaVal);

      const res = await fetch(`/api/despachos?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Error al cargar datos.");
        return;
      }
      const json = await res.json();
      setData(json.data ?? []);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Carga inicial con fechas por defecto
  useEffect(() => {
    fetchData(desde, hasta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBuscar() {
    setPage(1);
    fetchData(desde, hasta);
  }

  // Columnas dinámicas desde la primera fila, con url_factura y url_despacho al inicio
  const columns = useMemo(() => {
    if (data.length === 0) return [];
    const allCols = Object.keys(data[0]);
    const priority = ["url_despacho"];
    const first = priority.filter((col) => allCols.includes(col));
    const rest = allCols.filter((col) => !priority.includes(col));
    return [...first, ...rest];
  }, [data]);

  // Filtrado global (texto)
  const filtered = useMemo(() => {
    if (!filter.trim()) return data;
    const term = filter.toLowerCase();
    return data.filter((row) =>
      columns.some((col) =>
        String(row[col] ?? "")
          .toLowerCase()
          .includes(term)
      )
    );
  }, [data, filter, columns]);

  // Paginación
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [filter]);

  // Export a Excel
  function handleExport() {
    const ws = XLSX.utils.json_to_sheet(filtered);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Despachos");
    XLSX.writeFile(wb, "despachos_export.xlsx");
  }

  // Render especial para columnas con links PDF
  const PDF_COLUMNS = new Set(["url_factura", "url_despacho"]);
  const DATE_COLUMNS = new Set(["fecha_aceptacion", "autor_salida"]);
  const DOLLAR_COLUMNS = new Set(["total_fob", "valor_flete"]);

  function formatDate(value: unknown): string {
    if (!value) return "";
    const str = String(value);
    const date = new Date(str);
    if (isNaN(date.getTime())) return str;
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function formatDollar(value: unknown): string {
    if (value === null || value === undefined || value === "") return "";
    const num = Number(value);
    if (isNaN(num)) return String(value);
    return num.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    });
  }

  function renderCell(col: string, value: unknown) {
    if (PDF_COLUMNS.has(col) && value && String(value).trim() !== "") {
      const url = String(value);
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-xs text-error gap-1"
          title={col === "url_factura" ? "Descargar Factura" : "Descargar Despacho"}
        >
          <PdfIcon />
          PDF
        </a>
      );
    }
    if (DATE_COLUMNS.has(col)) {
      return formatDate(value);
    }
    if (DOLLAR_COLUMNS.has(col)) {
      return formatDollar(value);
    }
    return String(value ?? "");
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filtro de fechas */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">Fecha desde</span>
              </div>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </label>
            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">Fecha hasta</span>
              </div>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </label>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleBuscar}
              disabled={loading}
            >
              {loading ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                "Actualizar"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar: filtro texto + export */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <input
          type="text"
          placeholder="Filtrar por cualquier campo..."
          className="input input-bordered w-full sm:max-w-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-base-content/60">
            {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
          </span>
          <button className="btn btn-success btn-sm" onClick={handleExport}>
            <ExcelIcon />
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {/* Tabla */}
      {!loading && !error && (
        <>
          <div className="overflow-x-auto rounded-lg border border-base-300 bg-base-100">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col} className="whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length || 1}
                      className="text-center py-8 text-base-content/50"
                    >
                      No se encontraron resultados.
                    </td>
                  </tr>
                ) : (
                  paginated.map((row, i) => (
                    <tr key={i}>
                      {columns.map((col) => (
                        <td
                          key={col}
                          className={
                            col === "referencias"
                              ? "whitespace-normal break-words text-sm leading-tight"
                              : "whitespace-nowrap max-w-xs truncate"
                          }
                          style={col === "referencias" ? { width: "35px", maxWidth: "35px", minWidth: "35px", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" } : undefined}
                        >
                          {renderCell(col, row[col])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-base-content/60">
              Página {page} de {totalPages}
            </span>
            <div className="join">
              <button
                className="join-item btn btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                «
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = idx + 1;
                } else if (page <= 3) {
                  pageNum = idx + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + idx;
                } else {
                  pageNum = page - 2 + idx;
                }
                return (
                  <button
                    key={pageNum}
                    className={`join-item btn btn-sm ${page === pageNum ? "btn-active" : ""}`}
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                className="join-item btn btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                »
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ExcelIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 13h2m-2 3h4m4-9h-4a1 1 0 01-1-1V3"
      />
    </svg>
  );
}
