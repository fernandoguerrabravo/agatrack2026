"use client";

import { useEffect, useState } from "react";

interface Finalidad {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string;
  activa: boolean;
}

interface ConsentState {
  tieneConsentimiento: boolean;
  consentimiento: {
    folio: string;
    finalidades: string[];
    estado: string;
    otorgadoEn: string;
  } | null;
  finalidadesDisponibles: Finalidad[];
}

export default function ConsentimientoModal() {
  const [state, setState] = useState<ConsentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/consentimiento")
      .then((r) => r.json())
      .then((data: ConsentState) => {
        setState(data);
        if (data.finalidadesDisponibles) {
          setSelected(data.finalidadesDisponibles.map((f) => f.codigo));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading || !state || state.tieneConsentimiento || success) {
    return null;
  }

  const allSelected =
    state.finalidadesDisponibles.length > 0 &&
    selected.length === state.finalidadesDisponibles.length;

  async function handleSubmit() {
    if (!allSelected) {
      setError(
        "Debe aceptar todas las finalidades para utilizar el servicio."
      );
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/consentimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalidades: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error al registrar consentimiento");
        return;
      }
      setSuccess(true);
      // Reload to apply consent
      window.location.reload();
    } catch {
      setError("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFinalidad(codigo: string) {
    setSelected((prev) =>
      prev.includes(codigo)
        ? prev.filter((c) => c !== codigo)
        : [...prev, codigo]
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card bg-base-100 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <div className="card-body">
          {/* Header */}
          <div className="text-center mb-4">
            <h2 className="card-title text-2xl justify-center">
              Consentimiento para Tratamiento de Datos
            </h2>
            <p className="text-sm text-base-content/70 mt-2">
              Conforme a la Ley N° 21.719 sobre Protección de Datos Personales
            </p>
          </div>

          {/* Company Info */}
          <div className="bg-base-200 rounded-lg p-4 mb-4">
            <p className="text-sm">
              <strong>Responsable:</strong> Agencia de Aduanas Fernando Guerra y Cía. Ltda.
            </p>
            <p className="text-sm mt-1">
              <strong>Finalidad:</strong> Tratamiento de datos personales necesario para la
              prestación de servicios de agenciamiento aduanero.
            </p>
            <p className="text-sm mt-1">
              <strong>Base legal:</strong> Artículos 12 y 13, Ley N° 21.719
            </p>
          </div>

          {/* Finalidades */}
          <div className="mb-4">
            <h3 className="font-semibold mb-3">
              Finalidades del tratamiento de datos:
            </h3>
            <div className="space-y-2">
              {state.finalidadesDisponibles.map((f) => (
                <label
                  key={f.codigo}
                  className="flex items-start gap-3 p-3 bg-base-200 rounded-lg cursor-pointer hover:bg-base-300 transition-colors"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary mt-0.5"
                    checked={selected.includes(f.codigo)}
                    onChange={() => toggleFinalidad(f.codigo)}
                  />
                  <div>
                    <span className="font-medium text-sm">{f.nombre}</span>
                    <p className="text-xs text-base-content/60 mt-0.5">
                      {f.descripcion}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Legal notice */}
          <div className="bg-info/10 border border-info/30 rounded-lg p-3 mb-4">
            <p className="text-xs text-base-content/80">
              <strong>Derechos ARSOP:</strong> Usted puede ejercer sus derechos de
              Acceso, Rectificación, Supresión, Oposición y Portabilidad en
              cualquier momento desde su panel de usuario, conforme al Título III
              de la Ley N° 21.719.
            </p>
            <p className="text-xs text-base-content/80 mt-2">
              <strong>Revocación:</strong> Puede revocar este consentimiento en
              cualquier momento. La revocación implica la suspensión del servicio.
            </p>
            <p className="text-xs text-base-content/60 mt-2">
              Versión del texto: 2026-06-ley-21719-v1
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="alert alert-error text-sm mb-4">
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="card-actions justify-end">
            <button
              className="btn btn-primary btn-lg w-full"
              onClick={handleSubmit}
              disabled={submitting || !allSelected}
            >
              {submitting ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                "Acepto y otorgo mi consentimiento"
              )}
            </button>
          </div>

          {!allSelected && (
            <p className="text-xs text-center text-warning mt-2">
              Debe aceptar todas las finalidades para continuar usando el
              servicio.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
