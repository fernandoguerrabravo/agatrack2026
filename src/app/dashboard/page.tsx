import { getSession } from "@/lib/session";
import ChatPanel from "@/components/ChatPanel";

export default async function DashboardHome() {
  const session = await getSession();

  return (
    <div className="flex flex-col gap-4 h-full">
      <div>
        <h1 className="text-2xl font-bold">Asistente IA</h1>
        <p className="text-base-content/60 text-sm">
          Consulta sobre tus operaciones de comercio exterior — {session?.nombre || session?.rut}
        </p>
      </div>

      <ChatPanel />
    </div>
  );
}
