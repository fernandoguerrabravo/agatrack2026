"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { cleanRut, isValidRut } from "@/lib/rut";

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
    };
  }
}

export default function Home() {
  const router = useRouter();
  const [rut, setRut] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>("");

  useEffect(() => {
    // Cargar script de Turnstile
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
    script.async = true;
    document.head.appendChild(script);

    (window as unknown as Record<string, unknown>).onTurnstileLoad = () => {
      if (turnstileRef.current && window.turnstile) {
        widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
          sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
          callback: (token: string) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(""),
          theme: "light",
        });
      }
    };

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  function handleRutChange(value: string) {
    const cleaned = value.replace(/\./g, "").replace(/\s/g, "").toUpperCase();
    setRut(cleaned);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const cleaned = cleanRut(rut);

    if (!isValidRut(cleaned)) {
      setError("El RUT ingresado no es válido. Formato: 96691060-7");
      return;
    }

    if (!turnstileToken) {
      setError("Por favor, completa la verificación de seguridad.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rut: cleaned, password, turnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Error desconocido.");
        // Reset turnstile on error
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
          setTurnstileToken("");
        }
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Error de conexión. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="flex-1 flex items-center justify-center p-4 relative bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/fondo_inicio.jpg')" }}
    >
      {/* Overlay oscuro para legibilidad */}
      <div className="absolute inset-0 bg-black/50" />

      <div className="card w-full max-w-md bg-base-100/95 backdrop-blur-sm shadow-2xl relative z-10">
        <div className="card-body">
          {/* Logo */}
          <div className="flex flex-col items-center mb-2">
            <Image
              src="/logo_agatrack.png"
              alt="AGATrack Logo"
              width={336}
              height={112}
              priority
              className="mb-2"
            />
            <p className="text-base-content/70 text-sm text-center">
              Sistema Seguimiento Operaciones Comex
            </p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* RUT */}
            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">RUT Empresa</span>
              </div>
              <input
                type="text"
                placeholder="Ej: 12345678-9"
                className="input input-bordered w-full"
                value={rut}
                onChange={(e) => handleRutChange(e.target.value)}
                required
                autoComplete="username"
              />
              <div className="label">
                <span className="label-text-alt text-base-content/50">
                  Sin puntos, con guión y dígito verificador
                </span>
              </div>
            </label>

            {/* Contraseña */}
            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">Contraseña</span>
              </div>
              <input
                type="password"
                placeholder="••••••••"
                className="input input-bordered w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>

            {/* Turnstile Widget */}
            <div ref={turnstileRef} className="flex justify-center" />

            {/* Mensajes */}
            {error && (
              <div className="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="alert alert-success text-sm">
                <span>{success}</span>
              </div>
            )}

            {/* Botón */}
            <button
              type="submit"
              className={`btn btn-primary w-full ${loading ? "btn-disabled" : ""}`}
              disabled={loading || !turnstileToken}
            >
              {loading && <span className="loading loading-spinner loading-sm" />}
              Ingresar
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
