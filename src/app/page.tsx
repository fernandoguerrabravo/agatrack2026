"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { cleanRut, isValidRut } from "@/lib/rut";

type Tab = "login" | "register";

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("login");
  const [rut, setRut] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

    if (tab === "register" && password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);

    try {
      const endpoint =
        tab === "login" ? "/api/auth/login" : "/api/auth/register";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rut: cleaned,
          password,
          ...(tab === "register" ? { nombre, email } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Error desconocido.");
        return;
      }

      if (tab === "login") {
        router.push("/dashboard");
      } else {
        setSuccess("Cuenta creada exitosamente. Ya puedes iniciar sesión.");
        setTab("login");
        setPassword("");
        setNombre("");
        setEmail("");
      }
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

          {/* Tabs */}
          <div role="tablist" className="tabs tabs-boxed mb-4">
            <button
              role="tab"
              className={`tab ${tab === "login" ? "tab-active" : ""}`}
              onClick={() => {
                setTab("login");
                setError("");
                setSuccess("");
              }}
            >
              Iniciar Sesión
            </button>
            <button
              role="tab"
              className={`tab ${tab === "register" ? "tab-active" : ""}`}
              onClick={() => {
                setTab("register");
                setError("");
                setSuccess("");
              }}
            >
              Crear Cuenta
            </button>
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
                placeholder="96691060-7"
                className="input input-bordered w-full"
                value={rut}
                onChange={(e) => handleRutChange(e.target.value)}
                required
                autoComplete="username"
              />
              <div className="label">
                <span className="label-text-alt text-base-content/50">
                  Formato: 12345678-9
                </span>
              </div>
            </label>

            {/* Nombre (solo registro) */}
            {tab === "register" && (
              <label className="form-control w-full">
                <div className="label">
                  <span className="label-text">Nombre empresa (opcional)</span>
                </div>
                <input
                  type="text"
                  placeholder="Mi Empresa SpA"
                  className="input input-bordered w-full"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  autoComplete="organization"
                />
              </label>
            )}

            {/* Email (solo registro) */}
            {tab === "register" && (
              <label className="form-control w-full">
                <div className="label">
                  <span className="label-text">Correo electrónico</span>
                </div>
                <input
                  type="email"
                  placeholder="contacto@empresa.cl"
                  className="input input-bordered w-full"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
            )}

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
                minLength={tab === "register" ? 6 : undefined}
                autoComplete={
                  tab === "login" ? "current-password" : "new-password"
                }
              />
              {tab === "register" && (
                <div className="label">
                  <span className="label-text-alt text-base-content/50">
                    Mínimo 6 caracteres
                  </span>
                </div>
              )}
            </label>

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
              disabled={loading}
            >
              {loading && <span className="loading loading-spinner loading-sm" />}
              {tab === "login" ? "Ingresar" : "Crear Cuenta"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
