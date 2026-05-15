"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, memo, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { getCarrierName } from "@/lib/carriers";

const CHART_COLORS = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
const KPI_COLORS: Record<string, { bg: string; text: string }> = {
  blue: { bg: "bg-blue-50", text: "text-blue-700" },
  green: { bg: "bg-emerald-50", text: "text-emerald-700" },
  red: { bg: "bg-red-50", text: "text-red-700" },
  yellow: { bg: "bg-amber-50", text: "text-amber-700" },
  purple: { bg: "bg-purple-50", text: "text-purple-700" },
};

type ChartData = {
  kpis?: { label: string; value: string; color?: string }[];
  chart?: { type: "bar" | "line" | "pie"; data: { name: string; value: number }[]; title?: string };
  tracking?: {
    container: string;
    type?: string;
    scac?: string;
    origin?: string;
    destination?: string;
    pol?: string;
    pod?: string;
    eta?: string;
    etd?: string;
    completed?: boolean;
    events?: { date: string; action: string; location: string; type: string }[];
  };
};

function parseChartBlock(text: string): { chartDataList: ChartData[]; cleanText: string } {
  const chartDataList: ChartData[] = [];
  let cleanText = text;
  const regex = /<<<CHART\s*([\s\S]*?)\s*CHART>>>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const chartData = JSON.parse(match[1]) as ChartData;
      chartDataList.push(chartData);
    } catch {
      // JSON inválido, ignorar
    }
  }
  cleanText = text.replace(/<<<CHART[\s\S]*?CHART>>>\s*/g, "").trim();
  return { chartDataList, cleanText };
}

function InlineChartInner({ data }: { data: ChartData }) {
  return (
    <div className="w-full space-y-3 mb-2">
      {/* KPIs */}
      {data.kpis && data.kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {data.kpis.map((kpi, i) => {
            const colors = KPI_COLORS[kpi.color || "blue"] || KPI_COLORS.blue;
            return (
              <div key={i} className={`${colors.bg} rounded-lg px-3 py-2 text-center`}>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{kpi.label}</div>
                <div className={`text-sm font-bold ${colors.text}`}>{kpi.value}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Chart */}
      {data.chart && Array.isArray(data.chart.data) && data.chart.data.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-100 p-2">
          {data.chart.title && (
            <p className="text-[10px] text-gray-500 text-center mb-1">{data.chart.title}</p>
          )}
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              {data.chart.type === "bar" ? (
                <BarChart data={data.chart.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="value" fill="#4f46e5" radius={[3, 3, 0, 0]} />
                </BarChart>
              ) : data.chart.type === "line" ? (
                <LineChart data={data.chart.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              ) : (
                <PieChart>
                  <Pie
                    data={data.chart.data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={50}
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${String(name ?? "").substring(0, 10)} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {data.chart.data.map((_, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                </PieChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tracking Timeline */}
      {data.tracking && (
        <InlineTracking tracking={data.tracking} />
      )}
    </div>
  );
}

const COUNTRY_FLAGS_CHAT: Record<string, string> = {
  "China": "🇨🇳", "Chile": "🇨🇱", "United States": "🇺🇸", "Japan": "🇯🇵",
  "South Korea": "🇰🇷", "Germany": "🇩🇪", "Spain": "🇪🇸", "France": "🇫🇷",
  "Italy": "🇮🇹", "Netherlands": "🇳🇱", "Belgium": "🇧🇪", "Brazil": "🇧🇷",
  "Argentina": "🇦🇷", "Peru": "🇵🇪", "Colombia": "🇨🇴", "Mexico": "🇲🇽",
  "India": "🇮🇳", "Singapore": "🇸🇬", "Taiwan": "🇹🇼", "Australia": "🇦🇺",
  "Canada": "🇨🇦", "Panama": "🇵🇦", "Ecuador": "🇪🇨", "United Kingdom": "🇬🇧",
};

function getFlagChat(country?: string): string {
  if (!country) return "📍";
  return COUNTRY_FLAGS_CHAT[country] || "🌐";
}

function InlineTracking({ tracking }: { tracking: NonNullable<ChartData["tracking"]> }) {
  const progress = (() => {
    if (!tracking.events || tracking.events.length === 0) return 0;
    const actual = tracking.events.filter(e => e.type === "actual").length;
    if (tracking.completed) return 100;
    return Math.round((actual / tracking.events.length) * 100);
  })();

  // Extract vessel from events
  const vesselEvt = tracking.events?.find(e => e.location && e.type === "actual");
  const lastVessel = tracking.events?.reverse().find(e => e.location)?.location || "";

  return (
    <div className="w-full bg-white rounded-xl border border-gray-200 p-3 shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-[#1a2b4a] text-white text-[11px] font-bold px-2.5 py-1 rounded-lg tracking-wider">
            {tracking.container}
          </div>
          {tracking.scac && <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-semibold">{getCarrierName(tracking.scac)}</span>}
        </div>
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${tracking.completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {tracking.completed ? "✓ Entregado" : "⟳ En tránsito"}
        </span>
      </div>

      {/* Type + Vessel badges */}
      <div className="flex gap-2 flex-wrap">
        {tracking.type && (
          <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            <span className="text-[10px]">📦</span>
            <span className="text-[10px] font-bold text-amber-700">{tracking.type}</span>
          </div>
        )}
      </div>

      {/* Route visual with progress */}
      <div className="bg-gradient-to-r from-[#1a2b4a]/5 to-emerald-50 rounded-lg p-2.5 border border-gray-100">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-center flex-1">
            <div className="text-[9px] text-gray-400 uppercase font-bold">Origen</div>
            <div className="text-[10px] font-semibold text-[#1a2b4a]">{tracking.pol || "—"}</div>
            {tracking.etd && <div className="text-[8px] text-gray-400">ETD: {tracking.etd}</div>}
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
            <div className="text-[9px] text-gray-400 uppercase font-bold">Destino</div>
            <div className="text-[10px] font-semibold text-emerald-700">{tracking.pod || "—"}</div>
            {tracking.eta && <div className="text-[8px] text-emerald-600 font-bold">ETA: {tracking.eta}</div>}
          </div>
        </div>
        <div className="h-1 bg-gray-200 rounded-full overflow-hidden mt-1">
          <div className="h-full bg-gradient-to-r from-[#1a2b4a] to-emerald-500 rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-[8px] text-gray-400 text-center mt-0.5">{progress}% completado</div>
      </div>

      {/* Events timeline */}
      {tracking.events && tracking.events.length > 0 && (
        <div className="space-y-0">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1.5">Eventos</div>
          {tracking.events.map((evt, i) => {
            const isLast = i === tracking.events!.length - 1;
            const isActual = evt.type === "actual";
            // Parse country from location string (format: "Port, Country")
            const parts = evt.location?.split(", ") || [];
            const country = parts.length > 1 ? parts[parts.length - 1] : "";
            return (
              <div key={i} className="flex items-stretch">
                <div className="flex flex-col items-center w-4 mr-2">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 border-2 ${isActual ? "bg-emerald-500 border-emerald-500" : "bg-white border-red-400"}`} />
                  {!isLast && <div className={`w-0.5 flex-1 min-h-[14px] ${isActual ? "bg-emerald-200" : "bg-red-200"}`} />}
                </div>
                <div className={`pb-2 flex-1 ${!isActual ? "opacity-60" : ""}`}>
                  <div className={`text-[10px] leading-tight ${!isActual ? "text-red-500 italic" : "text-gray-800"}`}>
                    <span className="font-bold">{evt.date}</span>
                    <span className="mx-1 text-gray-300">|</span>
                    <span>{evt.action}</span>
                  </div>
                  {evt.location && (
                    <div className={`text-[9px] mt-0.5 ${!isActual ? "text-red-400" : "text-gray-400"}`}>
                      {getFlagChat(country)} {evt.location}
                      {!isActual && <span className="ml-1 text-[8px] bg-red-50 text-red-500 px-1 rounded">pendiente</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const InlineChart = memo(InlineChartInner);

function AssistantMessage({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const parsed = useMemo(() => {
    if (isStreaming) return { chartDataList: [], cleanText: text };
    return parseChartBlock(text);
  }, [text, isStreaming]);

  // While streaming, just show raw text (hide the chart block markers)
  if (isStreaming) {
    const display = text.replace(/<<<CHART[\s\S]*?CHART>>>\s*/g, "").replace(/<<<CHART[\s\S]*/g, "");
    return <span className="whitespace-pre-wrap">{display}</span>;
  }

  return (
    <>
      {parsed.chartDataList.map((chartData, i) => (
        <InlineChart key={i} data={chartData} />
      ))}
      <span className="whitespace-pre-wrap">{parsed.cleanText}</span>
    </>
  );
}

export default function ChatPanel() {
  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  }

  function handleSuggestion(text: string) {
    sendMessage({ text });
  }

  function handleReset() {
    setMessages([]);
  }

  return (
    <div className="bg-white rounded-lg flex flex-col h-[520px] max-w-2xl mx-auto w-full overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-3.5 bg-[#1a2b4a] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#e8a838]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-white">Asistente AGATrack</p>
            <p className="text-[11px] text-white/50">Consultas sobre operaciones Comex</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleReset}
            className="btn btn-sm bg-white/20 border-0 text-white hover:bg-white/30"
            title="Nueva conversación"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reiniciar Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-white">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-full bg-[#1a2b4a]/5 flex items-center justify-center mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#1a2b4a]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-sm text-[#1a2b4a]/60 mb-4">¿En qué puedo ayudarte?</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Chip text="¿Cuánto exporté este año?" onClick={handleSuggestion} />
              <Chip text="Países de destino" onClick={handleSuggestion} />
              <Chip text="Derechos de aduana" onClick={handleSuggestion} />
              <Chip text="Importaciones del mes" onClick={handleSuggestion} />
              <Chip text="Comparar exportaciones 2024 vs 2025" onClick={handleSuggestion} />
              <Chip text="¿Cuántos kilos importé este año?" onClick={handleSuggestion} />
              <Chip text="Top países de origen" onClick={handleSuggestion} />
              <Chip text="Evolución mensual de importaciones" onClick={handleSuggestion} />
              <Chip text="¿Cuánto pagué de IVA?" onClick={handleSuggestion} />
              <Chip text="Resumen general histórico" onClick={handleSuggestion} />
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const text = msg.parts
            ?.filter((p) => p.type === "text")
            .map((p, i) => <span key={i}>{p.text}</span>);

          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="bg-[#1a2b4a] text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[75%] text-[13px] leading-relaxed">
                  {text}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex gap-2.5">
              <div className="w-6 h-6 rounded-full bg-[#e8a838]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-[#e8a838]">AI</span>
              </div>
              <div className="bg-[#f8f9fb] rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%] text-[13px] leading-relaxed text-[#1a2b4a]/80">
                <AssistantMessage text={msg.parts?.filter((p) => p.type === "text").map((p) => p.text).join("") || ""} isStreaming={isLoading && msg.id === messages[messages.length - 1]?.id} />
              </div>
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-2.5">
            <div className="w-6 h-6 rounded-full bg-[#e8a838]/10 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-[#e8a838]">AI</span>
            </div>
            <div className="bg-[#f8f9fb] rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-[#1a2b4a]/20 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-[#1a2b4a]/20 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-[#1a2b4a]/20 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 bg-white border-t border-[#1a2b4a]/5">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Escribe tu pregunta..."
            className="flex-1 bg-[#f8f9fb] rounded-full px-4 py-2.5 text-[13px] text-[#1a2b4a] focus:outline-none focus:ring-1 focus:ring-[#1a2b4a]/20 transition-all placeholder:text-[#1a2b4a]/30"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            className="w-9 h-9 rounded-full bg-[#1a2b4a] text-white flex items-center justify-center hover:bg-[#243a5e] transition-colors disabled:opacity-30"
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function Chip({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return (
    <button
      type="button"
      className="px-3 py-1.5 text-[11px] rounded-full border border-[#1a2b4a]/10 text-[#1a2b4a]/60 hover:border-[#e8a838]/40 hover:text-[#e8a838] transition-colors"
      onClick={() => onClick(text)}
    >
      {text}
    </button>
  );
}
