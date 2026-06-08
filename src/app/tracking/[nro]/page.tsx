import { pgQuery } from "@/lib/postgres";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const SHIPSGO_EMBED_TOKEN = "5ad957ed-7ef8-4480-803e-2c941a6a26f4";

export default async function TrackingPage({ params }: { params: Promise<{ nro: string }> }) {
  const { nro } = await params;

  // Buscar el BL de esta operación para obtener el número
  const docs = await pgQuery<{ datos_extraidos: string }>(
    "SELECT datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Bill of Lading (BL)' LIMIT 1",
    [nro]
  );

  if (docs.length === 0) return notFound();

  const datos = typeof docs[0].datos_extraidos === "string" ? JSON.parse(docs[0].datos_extraidos) : docs[0].datos_extraidos;
  const blNum = datos.mbl_shipsgo || datos.numero_bl_master || datos.numero_bl || "";

  if (!blNum) return notFound();

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      <div className="bg-base-100 shadow px-6 py-4 flex items-center gap-4">
        <img src="/logo_agatrack.png" alt="AgaTrack" className="h-14" />
        <div>
          <h1 className="text-lg font-bold">Tracking Operación {nro}</h1>
          <p className="text-sm text-base-content/60">BL: {blNum}</p>
        </div>
      </div>
      <div className="flex-1 p-4">
        <iframe
          src={`https://embed.shipsgo.com/?token=${SHIPSGO_EMBED_TOKEN}&transport=ocean&query=${blNum}&tabs=none`}
          className="w-full h-[calc(100vh-120px)] rounded-lg border border-base-300 shadow"
          title="Tracking ShipsGo"
          allowFullScreen
        />
      </div>
    </div>
  );
}
