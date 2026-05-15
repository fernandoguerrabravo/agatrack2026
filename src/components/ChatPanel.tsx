"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, memo, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

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
        <div className="w-full bg-white rounded-lg border border-gray-100 p-3">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded bg-[#1a2b4a] flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-[#e8a838]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <div>
              <span className="text-xs font-bold text-[#1a2b4a]">{data.tracking.container}</span>
              {data.tracking.type && <span className="text-[10px] text-gray-400 ml-2">{data.tracking.type}</span>}
              {data.tracking.scac && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded ml-2">{data.tracking.scac}</span>}
            </div>
            {data.tracking.completed !== undefined && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded ml-auto font-medium ${data.tracking.completed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                {data.tracking.completed ? "Completado" : "En tránsito"}
              </span>
            )}
          </div>

          {/* Route info */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {data.tracking.pol && (
              <div className="bg-gray-50 rounded px-2 py-1.5">
                <div className="text-[9px] text-gray-400 uppercase">Puerto Carga (POL)</div>
                <div className="text-[11px] font-medium text-gray-700">{data.tracking.pol}</div>
                {data.tracking.etd && <div className="text-[9px] text-gray-400">ETD: {data.tracking.etd}</div>}
              </div>
            )}
            {data.tracking.pod && (
              <div className="bg-gray-50 rounded px-2 py-1.5">
                <div className="text-[9px] text-gray-400 uppercase">Puerto Descarga (POD)</div>
                <div className="text-[11px] font-medium text-gray-700">{data.tracking.pod}</div>
                {data.tracking.eta && <div className="text-[9px] text-emerald-600 font-medium">ETA: {data.tracking.eta}</div>}
              </div>
            )}
          </div>

          {/* Timeline events */}
          {data.tracking.events && data.tracking.events.length > 0 && (
            <div className="relative pl-4 border-l-2 border-[#1a2b4a]/20 space-y-2 ml-1">
              {data.tracking.events.map((evt, i) => {
                const isLast = i === data.tracking!.events!.length - 1;
                const isExpected = evt.type === "expected";
                return (
                  <div key={i} className="relative">
                    <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 ${
                      isLast && !isExpected ? "bg-[#e8a838] border-[#e8a838]" : 
                      isExpected ? "bg-white border-dashed border-gray-300" : 
                      "bg-[#1a2b4a] border-[#1a2b4a]"
                    }`} />
                    <div className={`text-[11px] ${isExpected ? "text-gray-400 italic" : "text-gray-700"}`}>
                      <span className="font-medium">{evt.date}</span>
                      <span className="mx-1">·</span>
                      <span>{evt.action}</span>
                      {evt.location && <span className="text-gray-400"> — {evt.location}</span>}
                      {isExpected && <span className="text-[9px] ml-1 bg-gray-100 px-1 rounded">estimado</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
