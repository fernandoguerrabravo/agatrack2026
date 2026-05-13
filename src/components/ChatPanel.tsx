"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState } from "react";

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
            Nueva consulta
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
              <div className="bg-[#f8f9fb] rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[80%] text-[13px] leading-relaxed text-[#1a2b4a]/80 whitespace-pre-wrap">
                {text}
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
