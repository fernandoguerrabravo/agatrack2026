"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { cleanRut, isValidRut } from "@/lib/rut";

export default function Home() {
  const router = useRouter();
  const [rut, setRut] = useState("");
  const [password, setPassword] = useState("");
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

    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rut: cleaned, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Error desconocido.");
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
              Ingresar
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
