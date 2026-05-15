import { getSession } from "@/lib/session";
import ChatPanel from "@/components/ChatPanel";
import TrackingWidget from "@/components/TrackingWidget";

export default async function DashboardHome() {
  const session = await getSession();

  return (
    <div className="flex flex-col gap-4 h-full">
      <div>
        <h1 className="text-2xl font-bold">Panel Principal</h1>
        <p className="text-base-content/60 text-sm">
          {session?.nombre || session?.rut}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="flex flex-col">
          <h2 className="text-base font-bold text-[#1a2b4a] mb-3 text-center">💬 Asistente IA</h2>
          <ChatPanel />
        </div>
        <div className="flex flex-col">
          <h2 className="text-base font-bold text-[#1a2b4a] mb-3 text-center">📦 Rastrea tu Contenedor</h2>
          <TrackingWidget />
        </div>
      </div>
    </div>
  );
}
