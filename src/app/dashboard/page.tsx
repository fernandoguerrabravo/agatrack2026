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
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Bienvenido</h1>
          <p className="text-base-content/60 text-sm">
            Para continuar, necesitamos tu consentimiento para el tratamiento de datos personales — Ley 21.719
          </p>
        </div>
        <ConsentimientoPanel />
      </div>
    );
  }

  return null;
}
