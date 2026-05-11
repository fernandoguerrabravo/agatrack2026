import { getSession } from "@/lib/session";

export default async function DashboardHome() {
  const session = await getSession();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Bienvenido</h1>
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Panel Principal</h2>
          <p className="text-base-content/70">
            Empresa: <span className="font-semibold">{session?.nombre || session?.rut}</span>
          </p>
          <p className="text-base-content/70">
            RUT: <span className="font-mono">{session?.rut}</span>
          </p>
          <div className="divider" />
          <p className="text-sm text-base-content/50">
            Desde aquí podrás consultar el estado de tus operaciones de comercio exterior.
          </p>
        </div>
      </div>
    </div>
  );
}
