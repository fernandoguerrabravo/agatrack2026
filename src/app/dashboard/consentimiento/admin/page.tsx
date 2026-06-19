"use client";
import ConsentimientoAdminPanel from "@/components/ConsentimientoAdminPanel";

export default function ConsentimientoAdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Administración de Consentimientos</h1>
      <ConsentimientoAdminPanel />
    </div>
  );
}
