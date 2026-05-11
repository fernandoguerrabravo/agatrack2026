import { getSession } from "@/lib/session";
import DespachosTable from "@/components/DespachosTable";

export default async function ExportacionesPage() {
  const session = await getSession();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Exportaciones</h1>
        <p className="text-base-content/60 text-sm mt-1">
          Empresa: <span className="font-semibold">{session?.nombre || session?.rut}</span>{" "}
          — RUT: <span className="font-mono">{session?.rut}</span>
        </p>
      </div>

      <DespachosTable />
    </div>
  );
}
