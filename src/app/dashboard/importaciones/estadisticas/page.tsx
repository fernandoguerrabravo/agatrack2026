import ImportacionesStats from "@/components/ImportacionesStats";

export default function ImportacionesEstadisticasPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Estadísticas Generales - Importaciones</h1>
        <p className="text-base-content/60 text-sm mt-1">
          Resumen de operaciones de importación
        </p>
      </div>
      <ImportacionesStats />
    </div>
  );
}
