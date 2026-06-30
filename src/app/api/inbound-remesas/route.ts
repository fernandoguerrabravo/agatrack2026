import { NextResponse } from "next/server";
import { procesarRemesa, REMESAS_INBOUND_ADDR } from "@/lib/remesas/procesar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.text();

    // Verificar firma webhook (svix)
    if (process.env.RESEND_WEBHOOK_SECRET) {
      const svixId = request.headers.get("svix-id");
      const svixTimestamp = request.headers.get("svix-timestamp");
      const svixSignature = request.headers.get("svix-signature");
      if (!svixId || !svixTimestamp || !svixSignature) {
        return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
      }
      const { Webhook } = await import("svix");
      try {
        new Webhook(process.env.RESEND_WEBHOOK_SECRET).verify(body, { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": svixSignature });
      } catch {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = JSON.parse(body);
    if (payload.type !== "email.received") return NextResponse.json({ ok: true, message: "Evento ignorado" });

    const { email_id, from, to, subject } = payload.data;
    const toAddr = (Array.isArray(to) ? to[0] : to || "").toLowerCase();
    if (toAddr !== REMESAS_INBOUND_ADDR) return NextResponse.json({ ok: true, message: "Dirección no es de remesas" });

    const res = await procesarRemesa(email_id, from, subject, payload.data);
    return NextResponse.json(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[remesas] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
