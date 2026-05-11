import ImpuestosPanel from "@/components/ImpuestosPanel";

export default function ImpuestosImportacionesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Impuestos Importaciones</h1>
        <p className="text-base-content/60 text-sm mt-1">
          Detalle de IVA y Derechos de Aduana pagados en importaciones
        </p>
      </div>
      <ImpuestosPanel />
    </div>
  );
}
