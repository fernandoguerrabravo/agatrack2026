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

const PAISES = [
  "Chile", "Argentina", "Perú", "Colombia", "México", "Brasil", "Ecuador",
  "Bolivia", "Uruguay", "Paraguay", "Venezuela", "Panamá", "Costa Rica",
  "Estados Unidos", "España", "Otro"
];

export default function Home() {
  const router = useRouter();
  const [rut, setRut] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>("");

  // Estado del modal de solicitud de acceso
  const [showSolicitud, setShowSolicitud] = useState(false);
  const [solRut, setSolRut] = useState("");
  const [solEmpresa, setSolEmpresa] = useState("");
  const [solEmail, setSolEmail] = useState("");
  const [solCelular, setSolCelular] = useState("");
  const [solPais, setSolPais] = useState("Chile");
  const [solLoading, setSolLoading] = useState(false);
  const [solError, setSolError] = useState("");
  const [solSuccess, setSolSuccess] = useState(false);
  const [solTurnstileToken, setSolTurnstileToken] = useState("");
  const solTurnstileRef = useRef<HTMLDivElement>(null);
  const solWidgetIdRef = useRef<string>("");

  // Auto-abrir modal si viene con ?solicitud=true
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("solicitud") === "true") {
      setShowSolicitud(true);
    }
  }, []);

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

  // Render Turnstile en modal de solicitud cuando se abre
  useEffect(() => {
    if (showSolicitud && solTurnstileRef.current && window.turnstile) {
      solWidgetIdRef.current = window.turnstile.render(solTurnstileRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        callback: (token: string) => setSolTurnstileToken(token),
        "expired-callback": () => setSolTurnstileToken(""),
        theme: "light",
      });
    }
    return () => {
      if (solWidgetIdRef.current && window.turnstile) {
        try { window.turnstile.reset(solWidgetIdRef.current); } catch {}
      }
      setSolTurnstileToken("");
      solWidgetIdRef.current = "";
    };
  }, [showSolicitud]);

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
        body: JSON.stringify({ rut: cleaned, email, password, turnstileToken }),
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

  async function handleSolicitud(e: React.FormEvent) {
    e.preventDefault();
    setSolError("");

    if (!solTurnstileToken) {
      setSolError("Por favor, completa la verificación de seguridad.");
      return;
    }

    setSolLoading(true);

    try {
      const res = await fetch("/api/solicitud-acceso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rut: solRut, empresa: solEmpresa, email: solEmail, celular: solCelular, pais: solPais, turnstileToken: solTurnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSolError(data.error ?? "Error al enviar solicitud.");
        return;
      }

      setSolSuccess(true);
    } catch {
      setSolError("Error de conexión. Intenta nuevamente.");
    } finally {
      setSolLoading(false);
    }
  }

  function closeSolicitudModal() {
    setShowSolicitud(false);
    setSolRut("");
    setSolEmpresa("");
    setSolEmail("");
    setSolCelular("");
    setSolPais("Chile");
    setSolError("");
    setSolSuccess(false);
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
              style={{ height: "auto" }}
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
                <span className="label-text">Correo electrónico</span>
              </div>
              <input
                type="email"
                placeholder="usuario@empresa.cl"
                className="input input-bordered w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
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

          {/* Solicite su Acceso */}
          <div className="divider text-xs text-base-content/50">¿No tiene cuenta?</div>
          <div className="bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/30 rounded-xl p-4 text-center">
            <p className="text-sm font-medium text-base-content mb-2">
              ¿Desea controlar sus operaciones de Comercio Exterior?
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm gap-2 shadow-md hover:shadow-lg transition-all"
              onClick={() => setShowSolicitud(true)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Solicite su Acceso
            </button>
          </div>
        </div>
      </div>

      {/* Modal Solicitud de Acceso */}
      {showSolicitud && (
        <div className="modal modal-open z-50">
          <div className="modal-box relative">
            <button
              className="btn btn-sm btn-circle absolute right-2 top-2"
              onClick={closeSolicitudModal}
            >
              ✕
            </button>

            {solSuccess ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="text-success text-5xl">✓</div>
                <h3 className="font-bold text-lg text-center">Solicitud Enviada</h3>
                <p className="text-center text-sm text-base-content/70">
                  Un ejecutivo de AGATrack se comunicará con usted a la brevedad.
                </p>
                <button className="btn btn-primary btn-sm" onClick={closeSolicitudModal}>
                  Cerrar
                </button>
              </div>
            ) : (
              <>
                <h3 className="font-bold text-lg mb-1">Solicite su Acceso</h3>
                <p className="text-sm text-base-content/70 mb-4">
                  Complete el formulario y un ejecutivo de AGATrack se comunicará con usted a la brevedad.
                </p>

                <form onSubmit={handleSolicitud} className="flex flex-col gap-3">
                  <label className="form-control w-full">
                    <div className="label">
                      <span className="label-text">RUT Empresa</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Ej: 12345678-9"
                      className="input input-bordered w-full"
                      value={solRut}
                      onChange={(e) => setSolRut(e.target.value)}
                      required
                    />
                  </label>

                  <label className="form-control w-full">
                    <div className="label">
                      <span className="label-text">Nombre de la Empresa</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Ej: Mi Empresa S.A."
                      className="input input-bordered w-full"
                      value={solEmpresa}
                      onChange={(e) => setSolEmpresa(e.target.value)}
                      required
                    />
                  </label>

                  <label className="form-control w-full">
                    <div className="label">
                      <span className="label-text">Correo Electrónico</span>
                    </div>
                    <input
                      type="email"
                      placeholder="contacto@empresa.cl"
                      className="input input-bordered w-full"
                      value={solEmail}
                      onChange={(e) => setSolEmail(e.target.value)}
                      required
                    />
                  </label>

                  <label className="form-control w-full">
                    <div className="label">
                      <span className="label-text">Celular</span>
                    </div>
                    <input
                      type="tel"
                      placeholder="+56 9 1234 5678"
                      className="input input-bordered w-full"
                      value={solCelular}
                      onChange={(e) => setSolCelular(e.target.value)}
                      required
                    />
                  </label>

                  <label className="form-control w-full">
                    <div className="label">
                      <span className="label-text">País</span>
                    </div>
                    <select
                      className="select select-bordered w-full"
                      value={solPais}
                      onChange={(e) => setSolPais(e.target.value)}
                      required
                    >
                      {PAISES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>

                  {solError && (
                    <div className="alert alert-error text-sm">
                      <span>{solError}</span>
                    </div>
                  )}

                  {/* Turnstile Widget */}
                  <div ref={solTurnstileRef} className="flex justify-center" />

                  <button
                    type="submit"
                    className={`btn btn-primary w-full ${solLoading ? "btn-disabled" : ""}`}
                    disabled={solLoading || !solTurnstileToken}
                  >
                    {solLoading && <span className="loading loading-spinner loading-sm" />}
                    Enviar Solicitud
                  </button>
                </form>
              </>
            )}
          </div>
          <div className="modal-backdrop" onClick={closeSolicitudModal} />
        </div>
      )}
    </main>
  );
}
