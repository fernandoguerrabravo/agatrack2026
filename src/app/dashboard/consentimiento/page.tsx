"use client";
import ConsentimientoPanel from "@/components/ConsentimientoPanel";

export default function ConsentimientoPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Privacidad y Consentimiento</h1>
      <ConsentimientoPanel />
    </div>
  );
}
