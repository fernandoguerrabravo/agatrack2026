import TrackingContenedoresPanel from "@/components/TrackingContenedoresPanel";

export default function TrackingContenedoresPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Tracking Contenedores</h1>
        <p className="text-base-content/60 text-sm mt-1">
          Rastrea tu embarque ingresando el número de BL Master
        </p>
      </div>
      <TrackingContenedoresPanel />
    </div>
  );
}
