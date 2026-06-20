import { getSession } from "@/lib/session";
import ConsentimientoPanel from "@/components/ConsentimientoPanel";

export default async function DashboardHome() {
  const session = await getSession();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Bienvenido, {session?.nombre || session?.email}</h1>
        <p className="text-base-content/60 text-sm">
          Gestión de privacidad y consentimiento — Ley 21.719
        </p>
      </div>

      <ConsentimientoPanel />
    </div>
  );
}
