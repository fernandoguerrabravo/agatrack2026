import EstadisticasPanel from "@/components/EstadisticasPanel";

export default function EstadisticasPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Estadísticas Generales - Exportaciones</h1>
        <p className="text-base-content/60 text-sm mt-1">
          Resumen de operaciones de exportación
        </p>
      </div>
      <EstadisticasPanel />
    </div>
  );
}
