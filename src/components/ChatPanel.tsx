"use client";

import { useChat } from "@ai-sdk/react";
import { useRef, useEffect, useState } from "react";

export default function ChatPanel() {
  const { messages, sendMessage, status } = useChat();
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
    <div className="card bg-base-100 shadow-xl h-[calc(100vh-12rem)] flex flex-col">
      <div className="card-body p-4 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 pb-3 border-b border-base-300">
          <div className="avatar placeholder">
            <div className="bg-primary text-primary-content rounded-full w-8">
              <span className="text-xs">AI</span>
            </div>
          </div>
          <div>
            <h2 className="font-semibold text-sm">Asistente AGATrack</h2>
            <p className="text-xs text-base-content/50">
              Pregunta sobre tus operaciones de importación y exportación
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-base-content/40">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-12 w-12 mb-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-sm font-medium">¿En qué puedo ayudarte?</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                <SuggestionChip text="¿Cuánto exporté este año?" onClick={handleSuggestion} />
                <SuggestionChip text="¿Cuáles son mis principales países de destino?" onClick={handleSuggestion} />
                <SuggestionChip text="¿Cuánto pagué en derechos de aduana en 2025?" onClick={handleSuggestion} />
                <SuggestionChip text="¿Cuántas importaciones hice este mes?" onClick={handleSuggestion} />
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat ${msg.role === "user" ? "chat-end" : "chat-start"}`}
            >
              <div className="chat-image avatar placeholder">
                <div
                  className={`rounded-full w-8 ${
                    msg.role === "user"
                      ? "bg-neutral text-neutral-content"
                      : "bg-primary text-primary-content"
                  }`}
                >
                  <span className="text-xs">
                    {msg.role === "user" ? "Tú" : "AI"}
                  </span>
                </div>
              </div>
              <div
                className={`chat-bubble ${
                  msg.role === "user" ? "chat-bubble-neutral" : "chat-bubble-primary"
                } text-sm whitespace-pre-wrap`}
              >
                {msg.parts
                  ?.filter((p) => p.type === "text")
                  .map((p, i) => (
                    <span key={i}>{p.text}</span>
                  ))}
              </div>
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="chat chat-start">
              <div className="chat-image avatar placeholder">
                <div className="bg-primary text-primary-content rounded-full w-8">
                  <span className="text-xs">AI</span>
                </div>
              </div>
              <div className="chat-bubble chat-bubble-primary">
                <span className="loading loading-dots loading-sm" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex gap-2 pt-3 border-t border-base-300">
          <input
            type="text"
            placeholder="Escribe tu pregunta..."
            className="input input-bordered flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function SuggestionChip({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return (
    <button
      type="button"
      className="btn btn-xs btn-outline btn-primary"
      onClick={() => onClick(text)}
    >
      {text}
    </button>
  );
}
