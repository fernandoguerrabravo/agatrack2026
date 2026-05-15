"use client";

import { getCarrierName } from "@/lib/carriers";

const COUNTRY_FLAGS: Record<string, string> = {
  "China": "🇨🇳", "Chile": "🇨🇱", "United States": "🇺🇸", "USA": "🇺🇸",
  "Japan": "🇯🇵", "South Korea": "🇰🇷", "Korea": "🇰🇷", "Germany": "🇩🇪",
  "Spain": "🇪🇸", "France": "🇫🇷", "Italy": "🇮🇹", "Netherlands": "🇳🇱",
  "Belgium": "🇧🇪", "United Kingdom": "🇬🇧", "Brazil": "🇧🇷",
  "Argentina": "🇦🇷", "Peru": "🇵🇪", "Colombia": "🇨🇴", "Mexico": "🇲🇽",
  "India": "🇮🇳", "Singapore": "🇸🇬", "Malaysia": "🇲🇾", "Taiwan": "🇹🇼",
  "Australia": "🇦🇺", "Canada": "🇨🇦", "Panama": "🇵🇦", "Ecuador": "🇪🇨",
  "Turkey": "🇹🇷", "South Africa": "🇿🇦", "Greece": "🇬🇷", "Thailand": "🇹🇭",
  "Vietnam": "🇻🇳", "Indonesia": "🇮🇩", "Philippines": "🇵🇭",
};

function getFlag(country?: string): string {
  if (!country) return "📍";
  return COUNTRY_FLAGS[country] || "🌐";
}

export type TrackingEvent = {
  event_date: string;
  location: { terminal?: string; port?: string; country?: string };
  action: { action_name?: string };
  mode?: { transport_mode?: string; vessel?: { vessel_name?: string; voyage_nr?: string } };
  event_type: "actual" | "expected";
  event_recent?: boolean;
};

export type TrackingData = {
  timestamp: string;
  scac: string;
  origin: { port?: string; country?: string };
  destination: { port?: string; country?: string };
  pol: { port?: string; country?: string; etd_date?: string };
  pod: { port?: string; country?: string; eta_date?: string };
  container: { number: string; type?: string; completed?: boolean };
  events: TrackingEvent[];
};

type Props = {
  data: TrackingData;
  compact?: boolean; // for widget/chat use
};

export default function TrackingResult({ data, compact = false }: Props) {
  const progress = (() => {
    if (!data.events || data.events.length === 0) return 0;
    const actual = data.events.filter(e => e.event_type === "actual").length;
    if (data.container.completed) return 100;
    return Math.round((actual / data.events.length) * 100);
  })();

  const vesselEvt = data.events?.find(e => e.mode?.vessel?.vessel_name);
  const vesselName = vesselEvt?.mode?.vessel?.vessel_name;
  const voyageNr = vesselEvt?.mode?.vessel?.voyage_nr;

  // Infer POL from first event if not provided
  const polPort = data.pol.port || data.events?.[0]?.location?.port || "";
  const polCountry = data.pol.country || data.events?.[0]?.location?.country || "";

  if (compact) {
    return <CompactView data={data} progress={progress} vesselName={vesselName} voyageNr={voyageNr} polPort={polPort} polCountry={polCountry} />;
  }

  return <FullView data={data} progress={progress} vesselName={vesselName} voyageNr={voyageNr} polPort={polPort} polCountry={polCountry} />;
}

/* ===== FULL VIEW (tracking page) ===== */
function FullView({ data, progress, vesselName, voyageNr, polPort, polCountry }: {
  data: TrackingData; progress: number; vesselName?: string; voyageNr?: string; polPort: string; polCountry: string;
}) {
  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="bg-[#1a2b4a] text-white rounded-xl p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#e8a838]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-wider">{data.container.number}</h2>
              <div className="flex items-center gap-2 mt-1">
                {data.scac && <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded-full font-medium">{getCarrierName(data.scac)}</span>}
              </div>
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-xl text-xs font-bold ${data.container.completed ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
            {data.container.completed ? "✓ Entregado" : "⟳ En tránsito"}
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-white/10">
          {data.container.type && (
            <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5">
              <span>📦</span>
              <div>
                <div className="text-[9px] text-white/50 uppercase">Tipo</div>
                <div className="text-sm font-bold text-[#e8a838]">{data.container.type}</div>
              </div>
            </div>
          )}
          {vesselName && (
            <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5">
              <span>🚢</span>
              <div>
                <div className="text-[9px] text-white/50 uppercase">Nave / Viaje</div>
                <div className="text-sm font-bold text-white">{vesselName}{voyageNr ? ` · ${voyageNr}` : ""}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Route visual */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-[#1a2b4a]/10 flex items-center justify-center mx-auto mb-1">
              <span>{getFlag(polCountry)}</span>
            </div>
            <div className="text-[10px] text-gray-400 uppercase font-bold">Origen</div>
            <div className="text-sm font-bold text-[#1a2b4a]">{polPort || "—"}</div>
            <div className="text-xs text-gray-400">{polCountry}</div>
            {data.pol.etd_date && <div className="text-[10px] text-gray-500 mt-0.5">ETD: {data.pol.etd_date}</div>}
          </div>

          <div className="flex-1 mx-5">
            <div className="relative">
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#1a2b4a] via-[#e8a838] to-emerald-500 rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
              </div>
              <div className="absolute top-1/2 -translate-y-1/2 transition-all duration-700" style={{ left: `${progress}%` }}>
                <div className="w-7 h-7 bg-[#e8a838] rounded-full flex items-center justify-center shadow-lg -ml-3.5 border-2 border-white">
                  <span className="text-xs">🚢</span>
                </div>
              </div>
            </div>
            <div className="text-center mt-2.5">
              <span className="text-xs font-bold text-[#e8a838]">{progress}% completado</span>
            </div>
          </div>

          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-1">
              <span>{getFlag(data.pod.country)}</span>
            </div>
            <div className="text-[10px] text-gray-400 uppercase font-bold">Destino</div>
            <div className="text-sm font-bold text-emerald-700">{data.pod.port || "—"}</div>
            <div className="text-xs text-gray-400">{data.pod.country}</div>
            {data.pod.eta_date && <div className="text-[10px] text-emerald-600 font-bold mt-0.5">ETA: {data.pod.eta_date}</div>}
          </div>
        </div>
      </div>

      {/* Timeline */}
      {data.events && data.events.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="text-xs font-bold text-[#1a2b4a] uppercase tracking-wider mb-4">Historial de Eventos</h3>
          <EventTimeline events={data.events} />
        </div>
      )}

      <div className="text-[10px] text-gray-400 text-right">Última consulta: {data.timestamp}</div>
    </div>
  );
}

/* ===== COMPACT VIEW (widget / chat) ===== */
function CompactView({ data, progress, vesselName, voyageNr, polPort, polCountry }: {
  data: TrackingData; progress: number; vesselName?: string; voyageNr?: string; polPort: string; polCountry: string;
}) {
  return (
    <div className="w-full space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-[#1a2b4a] text-white text-[10px] font-bold px-2.5 py-1 rounded-lg tracking-wider">
            {data.container.number}
          </div>
          {data.scac && <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold">{getCarrierName(data.scac)}</span>}
        </div>
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${data.container.completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {data.container.completed ? "✓ Entregado" : "⟳ En tránsito"}
        </span>
      </div>

      {/* Badges */}
      <div className="flex gap-1.5 flex-wrap">
        {data.container.type && (
          <span className="text-[9px] bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-bold text-amber-700">📦 {data.container.type}</span>
        )}
        {vesselName && (
          <span className="text-[9px] bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 font-bold text-blue-700">🚢 {vesselName}{voyageNr ? ` · ${voyageNr}` : ""}</span>
        )}
      </div>

      {/* Route */}
      <div className="bg-gradient-to-r from-[#1a2b4a]/5 to-emerald-50 rounded-lg p-2.5 border border-gray-100">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-center flex-1">
            <div className="text-[8px] text-gray-400 uppercase font-bold">Origen</div>
            <div className="text-[10px] font-semibold text-[#1a2b4a]">{getFlag(polCountry)} {polPort || "—"}</div>
          </div>
          <div className="flex-1 flex items-center px-2">
            <div className="h-[2px] flex-1 bg-gradient-to-r from-[#1a2b4a] to-emerald-500 rounded relative">
              <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${progress}%` }}>
                <div className="w-4 h-4 bg-[#e8a838] rounded-full flex items-center justify-center shadow -ml-2 border border-white">
                  <span className="text-[7px]">🚢</span>
                </div>
              </div>
            </div>
          </div>
          <div className="text-center flex-1">
            <div className="text-[8px] text-gray-400 uppercase font-bold">Destino</div>
            <div className="text-[10px] font-semibold text-emerald-700">{getFlag(data.pod.country)} {data.pod.port || "—"}</div>
            {data.pod.eta_date && <div className="text-[8px] text-emerald-600 font-bold">ETA: {data.pod.eta_date}</div>}
          </div>
        </div>
        <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-[#1a2b4a] to-emerald-500 rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-[8px] text-gray-400 text-center mt-0.5">{progress}% completado</div>
      </div>

      {/* Events */}
      {data.events && data.events.length > 0 && (
        <div>
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1.5">Eventos</div>
          <div className="max-h-[150px] overflow-y-auto">
            <EventTimeline events={data.events} compact />
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== SHARED TIMELINE ===== */
function EventTimeline({ events, compact = false }: { events: TrackingEvent[]; compact?: boolean }) {
  const bulletSize = compact ? "w-2.5 h-2.5" : "w-3.5 h-3.5";
  const lineWidth = compact ? "w-4 mr-2" : "w-6 mr-3";
  const lineMin = compact ? "min-h-[14px]" : "min-h-[24px]";
  const textSize = compact ? "text-[10px]" : "text-sm";
  const subTextSize = compact ? "text-[9px]" : "text-xs";
  const pb = compact ? "pb-2" : "pb-4";

  return (
    <div className="space-y-0">
      {events.map((evt, i) => {
        const isLast = i === events.length - 1;
        const isActual = evt.event_type === "actual";
        const vessel = evt.mode?.vessel?.vessel_name;
        const voyage = evt.mode?.vessel?.voyage_nr;
        const transport = evt.mode?.transport_mode;

        return (
          <div key={i} className="flex items-stretch">
            <div className={`flex flex-col items-center ${lineWidth}`}>
              <div className={`${bulletSize} rounded-full flex-shrink-0 border-2 ${
                isActual
                  ? evt.event_recent
                    ? "bg-emerald-500 border-emerald-500 ring-2 ring-emerald-100"
                    : "bg-emerald-500 border-emerald-500"
                  : "bg-white border-red-300"
              }`} />
              {!isLast && <div className={`w-0.5 flex-1 ${lineMin} ${isActual ? "bg-emerald-200" : "bg-red-100"}`} />}
            </div>
            <div className={`${pb} flex-1 ${!isActual ? "opacity-60" : ""}`}>
              <div className={`${textSize} leading-tight ${!isActual ? "text-red-500 italic" : "text-gray-800"}`}>
                <span className="font-bold">{evt.event_date}</span>
                <span className="mx-1.5 text-gray-300">|</span>
                <span className={isActual ? "font-medium" : ""}>{evt.action.action_name || "Evento"}</span>
                {evt.event_recent && <span className="ml-1.5 text-[8px] bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded-full font-bold">ÚLTIMO</span>}
                {!isActual && <span className="ml-1.5 text-[8px] bg-red-50 text-red-500 px-1 py-0.5 rounded-full font-bold">PENDIENTE</span>}
              </div>
              {evt.location.port && (
                <div className={`${subTextSize} mt-0.5 ${!isActual ? "text-red-400" : "text-gray-500"}`}>
                  {getFlag(evt.location.country)} {evt.location.port}, {evt.location.country}
                  {evt.location.terminal && !compact && <span className="text-gray-300"> · {evt.location.terminal}</span>}
                </div>
              )}
              {vessel && (
                <div className={`${subTextSize} mt-0.5 inline-flex items-center gap-1 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5`}>
                  <span>🚢</span>
                  <span className="font-bold text-blue-700">{vessel}</span>
                  {voyage && <span className="text-blue-400">· {voyage}</span>}
                </div>
              )}
              {transport && !vessel && (
                <div className={`${subTextSize} text-gray-400 mt-0.5`}>🚛 {transport}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
