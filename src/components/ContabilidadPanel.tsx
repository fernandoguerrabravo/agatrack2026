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
  aduana: string;
  fecha_pago_gravamenes: string;
  tgr_url?: string;
  pago_directo_url?: string;
  url_factura_final?: string;
  es_pago_directo?: boolean;
};

const POR_PAGINA = 20;

export default function ContabilidadPanel() {
  const [despachos, setDespachos] = useState<Despacho[]>([]);
  const [loading, setLoading] = useState(true);
  const [generandoTGR, setGenerandoTGR] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/contabilidad/despachos");
      const data = await res.json();
      if (data.despachos) setDespachos(data.despachos);
    } catch {}
    setLoading(false);
  }

  const filtrados = despachos.filter(d => {
    if (!busqueda) return true;
    const q = busqueda.toLowerCase();
    return (
      d.despacho?.toLowerCase().includes(q) ||
      d.cliente?.toLowerCase().includes(q) ||
      d.referencia?.toLowerCase().includes(q) ||
      d.nro_aceptacion?.toLowerCase().includes(q) ||
      d.puerto_desembarque?.toLowerCase().includes(q)
    );
  });

  const totalPaginas = Math.ceil(filtrados.length / POR_PAGINA);
  const despachosPagina = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

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

  async function handlePagoDirecto(despacho: string) {
    try {
      await fetch("/api/operaciones/pago-directo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nro_operacion: despacho }),
      });
      await fetchData();
    } catch {}
  }

  async function handleGenerarFactura(despacho: string) {
    const Swal = (await import("sweetalert2")).default;
    Swal.fire({ title: "Generando Factura...", html: `Operación ${despacho}`, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await fetch("/api/operaciones/generar-factura", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nro_operacion: despacho }),
      });
      const data = await res.json();
      if (res.ok) {
        await Swal.fire({ title: "✅ Factura generada", html: `Operación ${despacho}`, icon: "success", timer: 3000 });
      } else {
        await Swal.fire({ title: "Error", text: data.error, icon: "error" });
      }
    } catch (err) {
      await Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Error", icon: "error" });
    }
    fetchData();
  }

  async function handleGenerarTGRTodos() {
    const sinTGR = filtrados.filter(d => !d.tgr_url && d.fecha_pago_gravamenes);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="loading loading-spinner loading-lg text-primary"></span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header con buscador y acciones */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <button className="btn btn-sm btn-success gap-1" onClick={handleGenerarTGRTodos}>
                🏦 Generar TGR pendientes
              </button>
              <div className="badge badge-neutral badge-outline">{filtrados.length} registros</div>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="🔍 Buscar despacho, cliente, referencia..."
                className="input input-bordered input-sm w-80 pl-3"
                value={busqueda}
                onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }}
              />
              {busqueda && (
                <button className="btn btn-ghost btn-xs absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setBusqueda(""); setPagina(1); }}>✕</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-0">
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr className="bg-base-200/50 border-b-2 border-base-300">
                  <th className="font-semibold text-xs uppercase tracking-wider">Despacho</th>
                  <th className="font-semibold text-xs uppercase tracking-wider">Fecha</th>
                  <th className="font-semibold text-xs uppercase tracking-wider">Cliente</th>
                  <th className="font-semibold text-xs uppercase tracking-wider text-right">CIF USD</th>
                  <th className="font-semibold text-xs uppercase tracking-wider text-right">Total CLP</th>
                  <th className="font-semibold text-xs uppercase tracking-wider text-center">T/C</th>
                  <th className="font-semibold text-xs uppercase tracking-wider">Aduana</th>
                  <th className="font-semibold text-xs uppercase tracking-wider text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {despachosPagina.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-base-content/50">Sin resultados</td></tr>
                ) : despachosPagina.map((d, i) => (
                  <tr key={d.nro_aceptacion || d.despacho} className={`hover:bg-base-200/30 transition-colors ${i % 2 === 0 ? "" : "bg-base-200/10"}`}>
                    <td>
                      <span className="font-mono font-bold text-primary">{d.despacho}</span>
                    </td>
                    <td className="text-sm text-base-content/70">
                      {d.fecha_aceptacion ? (() => {
                        const [y, m, day] = d.fecha_aceptacion.substring(0, 10).split("-");
                        return `${day}/${m}/${y}`;
                      })() : "-"}
                    </td>
                    <td>
                      <span className="text-sm max-w-36 block truncate" title={d.cliente}>{d.cliente}</span>
                    </td>
                    <td className="text-right font-mono text-sm">{d.total_cif ? Number(d.total_cif).toLocaleString("es-CL") : "-"}</td>
                    <td className="text-right font-mono text-sm font-semibold text-success">{d.total_gravamenes_chs ? `$${Number(d.total_gravamenes_chs).toLocaleString("es-CL")}` : "-"}</td>
                    <td className="text-center text-xs text-base-content/60">{d.tipo_cambio || "-"}</td>
                    <td className="text-sm">{d.aduana || "-"}</td>
                    <td>
                      <div className="flex items-center justify-center gap-1">
                        {!d.tgr_url ? (
                          <button
                            className={`btn btn-xs btn-circle btn-outline ${d.fecha_pago_gravamenes ? "btn-success" : "btn-warning"} ${generandoTGR === d.despacho ? "loading" : ""}`}
                            onClick={() => handleGenerarTGR(d.despacho)}
                            disabled={!!generandoTGR}
                            title={d.fecha_pago_gravamenes ? "Generar TGR" : "Intentar TGR (impuestos pendientes)"}
                          >
                            {generandoTGR !== d.despacho && <span className="text-xs">{d.fecha_pago_gravamenes ? "🏦" : "⏳"}</span>}
                          </button>
                        ) : (
                          <a href={`/api/operaciones/imprimir-tgr-din?nro_operacion=${d.despacho}`} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline btn-success" title="Imprimir TGR + DIN">
                            🖨 TGR+DIN
                          </a>
                        )}
                        <a href={`https://fguerragodoy.aduananet2.cl/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${d.despacho}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-circle btn-outline btn-info" title="DIN Aprobada">
                          <span className="text-xs">📋</span>
                        </a>
                        {(d.url_factura || d.url_factura_final) && (
                          <a href={d.url_factura || d.url_factura_final || ""} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-circle btn-ghost" title="DTE Electrónico">
                            <span className="text-xs">📎</span>
                          </a>
                        )}
                        {!d.url_factura && !d.url_factura_final && d.tgr_url && d.rut_cliente === "92933000-5" && (
                          <button className="btn btn-xs btn-outline btn-secondary" onClick={() => handleGenerarFactura(d.despacho)} title="Generar Factura">
                            Factura
                          </button>
                        )}
                        {d.tgr_url && !d.pago_directo_url && d.es_pago_directo && (
                          <button className="btn btn-xs btn-circle btn-outline btn-secondary" onClick={() => handlePagoDirecto(d.despacho)} title="Crear Pago Directo">
                            <span className="text-xs">💰</span>
                          </button>
                        )}
                        {d.pago_directo_url && (
                          <a href={d.pago_directo_url} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-circle btn-secondary" title="Ver Pago Directo">
                            <span className="text-xs">💰</span>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Paginador */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between px-2">
          <span className="text-sm text-base-content/50">
            Mostrando {(pagina - 1) * POR_PAGINA + 1}-{Math.min(pagina * POR_PAGINA, filtrados.length)} de {filtrados.length}
          </span>
          <div className="join">
            <button className="join-item btn btn-sm" disabled={pagina === 1} onClick={() => setPagina(1)}>«</button>
            <button className="join-item btn btn-sm" disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>‹</button>
            {Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
              let p: number;
              if (totalPaginas <= 5) p = i + 1;
              else if (pagina <= 3) p = i + 1;
              else if (pagina >= totalPaginas - 2) p = totalPaginas - 4 + i;
              else p = pagina - 2 + i;
              return (
                <button key={p} className={`join-item btn btn-sm ${pagina === p ? "btn-active" : ""}`} onClick={() => setPagina(p)}>
                  {p}
                </button>
              );
            })}
            <button className="join-item btn btn-sm" disabled={pagina === totalPaginas} onClick={() => setPagina(p => p + 1)}>›</button>
            <button className="join-item btn btn-sm" disabled={pagina === totalPaginas} onClick={() => setPagina(totalPaginas)}>»</button>
          </div>
        </div>
      )}
    </div>
  );
}
