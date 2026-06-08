import CustomerServicesPanel from "@/components/CustomerServicesPanel";

export default function CustomerServicesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Customer Services</h1>
        <p className="text-base-content/60 text-sm mt-1">
          Gestión de operaciones y confección de declaraciones
        </p>
      </div>
      <CustomerServicesPanel />
    </div>
  );
}
