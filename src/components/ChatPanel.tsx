"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState } from "react";

export default function ChatPanel() {
  const { messages, sendMessage, status } = useChat({
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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-[500px] max-w-2xl mx-auto w-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-800">Asistente AGATrack</p>
          <p className="text-[11px] text-gray-400">Consultas sobre operaciones Comex</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-xs text-gray-400 mb-4">¿En qué puedo ayudarte?</p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              <Chip text="¿Cuánto exporté este año?" onClick={handleSuggestion} />
              <Chip text="Países de destino" onClick={handleSuggestion} />
              <Chip text="Derechos de aduana" onClick={handleSuggestion} />
              <Chip text="Importaciones del mes" onClick={handleSuggestion} />
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
                <div className="bg-primary text-white rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[75%] text-[13px] leading-relaxed">
                  {text}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex gap-2.5">
              <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              </div>
              <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-3.5 py-2 max-w-[80%] text-[13px] leading-relaxed text-gray-700 whitespace-pre-wrap">
                {text}
              </div>
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-2.5">
            <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
            </div>
            <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Escribe tu pregunta..."
            className="flex-1 bg-gray-50 rounded-full px-4 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-gray-300"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30"
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
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
      className="px-2.5 py-1 text-[11px] rounded-full bg-gray-50 text-gray-500 hover:bg-primary/5 hover:text-primary transition-colors"
      onClick={() => onClick(text)}
    >
      {text}
    </button>
  );
}
