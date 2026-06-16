"use client";
import ContabilidadPanel from "@/components/ContabilidadPanel";

export default function ContabilidadPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contabilidad</h1>
      </div>
      <ContabilidadPanel />
    </div>
  );
}
