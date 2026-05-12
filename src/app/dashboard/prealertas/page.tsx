import PrealertasPanel from "@/components/PrealertasPanel";

export default function PrealertasPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Prealertas</h1>
        <p className="text-base-content/60 text-sm mt-1">
          Sube documentos de operaciones para extracción automática de datos
        </p>
      </div>
      <PrealertasPanel />
    </div>
  );
}
