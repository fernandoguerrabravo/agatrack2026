"use client";

import { useState, useEffect } from "react";

type Despacho = {
  despacho: string;
  nro_aceptacion: string;
  fecha_aceptacion: string;
  cliente: string;
  rut_cliente: string;
  referencia: string;
  total_cif: string;
  total_fob: string;
  valor_flete: string;
  valor_seguro: string;
  iva: string;
  gravamenes_valor_1: string;
  total_gravamenes_chs: string;
  tipo_cambio: string;
  puerto_desembarque: string;
  via: string;
  regimen: string;
  url_factura: string;
  url_dte: string;
  url_despacho: string;
  factura_despacho: string;
  estado: string;
  // De operaciones
  tgr_url?: string;
};

export default function ContabilidadPanel() {
  const [despachos, setDespachos] = useState<Despacho[]>([]);
  const [loading, setLoading] = useState(true);
  const [generandoTGR, setGenerandoTGR] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/contabilidad/despachos");
      const data = await res.json();
      if (data.despachos) setDespachos(data.despachos);
    } catch {}
    setLoading(false);
  }

  async function handleGenerarTGR(despacho: string) {
    setGenerandoTGR(despacho);
    try {
      await fetch("/api/operaciones/comprobante-tgr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nro_operacion: despacho }),
      });
      await fetchData();
    } catch {}
    setGenerandoTGR(null);
  }

  async function handleGenerarTGRTodos() {
    const sinTGR = despachos.filter(d => !d.tgr_url);
    if (sinTGR.length === 0) return;
    const Swal = (await import("sweetalert2")).default;
    let timerInterval: ReturnType<typeof setInterval>;
    let segundos = 0;
    Swal.fire({
      title: `🏦 Generando TGR (0/${sinTGR.length})`,
      html: `Tiempo: <b>0s</b>`,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
        timerInterval = setInterval(() => {
          segundos++;
          const timer = Swal.getHtmlContainer()?.querySelector("b");
          if (timer) timer.textContent = `${segundos}s`;
        }, 1000);
      },
      willClose: () => clearInterval(timerInterval),
    });
    let completadas = 0;
    for (const d of sinTGR) {
      try {
        await fetch("/api/operaciones/comprobante-tgr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nro_operacion: d.despacho }),
        });
        completadas++;
        Swal.update({ title: `🏦 Generando TGR (${completadas}/${sinTGR.length})` });
      } catch { completadas++; }
    }
    clearInterval(timerInterval!);
    await Swal.fire({ title: "✅ TGR completado", html: `${completadas} comprobante(s) en ${segundos}s`, icon: "success", timer: 3000 });
    fetchData();
  }

  if (loading) return <div className="flex items-center justify-center py-10"><span className="loading loading-spinner loading-lg"></span></div>;

  return (
    <div className="space-y-4">
      {/* Acciones globales */}
      <div className="flex items-center gap-3">
        <button className="btn btn-sm btn-outline btn-success" onClick={handleGenerarTGRTodos}>
          🏦 Generar TGR (todos pendientes)
        </button>
        <span className="text-sm text-base-content/60">{despachos.length} despachos desde 15/06/2026</span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="table table-xs table-zebra w-full">
          <thead>
            <tr className="bg-base-200">
              <th>Despacho</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Referencia</th>
              <th>CIF USD</th>
              <th>IVA</th>
              <th>Derechos</th>
              <th>Total Grav. CLP</th>
              <th>T/C</th>
              <th>Puerto</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {despachos.map(d => (
              <tr key={d.nro_aceptacion || d.despacho}>
                <td className="font-mono font-bold">{d.despacho}</td>
                <td className="text-xs">{d.fecha_aceptacion ? new Date(d.fecha_aceptacion).toLocaleDateString("es-CL") : "-"}</td>
                <td className="text-xs max-w-32 truncate" title={d.cliente}>{d.cliente}</td>
                <td className="text-xs">{d.referencia}</td>
                <td className="text-right font-mono">{d.total_cif ? Number(d.total_cif).toLocaleString("es-CL") : "-"}</td>
                <td className="text-right font-mono">{d.iva ? Number(d.iva).toLocaleString("es-CL") : "-"}</td>
                <td className="text-right font-mono">{d.gravamenes_valor_1 ? Number(d.gravamenes_valor_1).toLocaleString("es-CL") : "-"}</td>
                <td className="text-right font-mono font-bold">{d.total_gravamenes_chs ? Number(d.total_gravamenes_chs).toLocaleString("es-CL") : "-"}</td>
                <td className="text-right text-xs">{d.tipo_cambio || "-"}</td>
                <td className="text-xs">{d.puerto_desembarque}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {!d.tgr_url ? (
                      <button
                        className={`btn btn-xs btn-outline btn-success ${generandoTGR === d.despacho ? "loading" : ""}`}
                        onClick={() => handleGenerarTGR(d.despacho)}
                        disabled={!!generandoTGR}
                      >
                        {generandoTGR !== d.despacho && "🏦"}
                      </button>
                    ) : (
                      <a href={d.tgr_url} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-success btn-outline">TGR</a>
                    )}
                    <a href={`/api/operaciones/factura?nro_operacion=${d.despacho}`} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline btn-primary">📄 Factura+DIN</a>
                    <a href={`/api/operaciones/imprimir?nro_operacion=${d.despacho}`} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline">🖨️</a>
                    {d.url_factura && <a href={d.url_factura} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost">DTE</a>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
