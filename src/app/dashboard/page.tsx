"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ConsentimientoPanel from "@/components/ConsentimientoPanel";

export default function DashboardHome() {
  const [vigente, setVigente] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/consentimiento")
      .then(r => r.json())
      .then(data => {
        setVigente(data.vigente || false);
        // Si ya tiene consentimiento, redirigir al módulo principal según rol
        if (data.vigente) {
          router.replace("/dashboard/consentimiento");
        }
      })
      .catch(() => setVigente(false))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="flex justify-center py-20"><span className="loading loading-spinner loading-lg"></span></div>;

  // Si no tiene consentimiento, mostrar el formulario
  if (!vigente) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">Bienvenido</h1>
          <p className="text-base-content/60 text-sm">
            Para continuar, necesitamos tu consentimiento para el tratamiento de datos personales — Ley 21.719
          </p>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">🔒 Protección de Datos Personales</h2>
            <p className="text-sm text-base-content/70 mt-2">
              La <strong>Ley N° 21.719</strong> de Protección de Datos Personales establece nuevos derechos y obligaciones 
              sobre cómo las organizaciones tratan tu información personal. Como agencia de aduanas, procesamos datos 
              necesarios para gestionar tus operaciones de comercio exterior.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="p-3 bg-base-200/50 rounded-lg">
                <h3 className="font-semibold text-sm">📋 ¿Qué es el consentimiento?</h3>
                <p className="text-xs text-base-content/70 mt-1">
                  Es tu autorización libre, informada y específica para que tratemos tus datos personales con las finalidades que selecciones.
                </p>
              </div>
              <div className="p-3 bg-base-200/50 rounded-lg">
                <h3 className="font-semibold text-sm">⚖️ ¿Qué derechos tienes?</h3>
                <p className="text-xs text-base-content/70 mt-1">
                  Acceso, rectificación, supresión, oposición y portabilidad de tus datos. Puedes ejercerlos en cualquier momento.
                </p>
              </div>
              <div className="p-3 bg-base-200/50 rounded-lg">
                <h3 className="font-semibold text-sm">🔏 ¿Cómo se protege?</h3>
                <p className="text-xs text-base-content/70 mt-1">
                  Tu consentimiento queda registrado en una cadena de bloques inmutable con sello de tiempo en Bitcoin, garantizando su integridad.
                </p>
              </div>
              <div className="p-3 bg-base-200/50 rounded-lg">
                <h3 className="font-semibold text-sm">🔄 ¿Es revocable?</h3>
                <p className="text-xs text-base-content/70 mt-1">
                  Sí. Puedes revocar tu consentimiento en cualquier momento desde la sección de Privacidad, sin afectar operaciones ya realizadas.
                </p>
              </div>
            </div>
          </div>
        </div>

        <ConsentimientoPanel />
      </div>
    );
  }

  return null;
}
