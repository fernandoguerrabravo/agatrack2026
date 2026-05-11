import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// La conexión abre un túnel SSH, así que forzamos runtime Node.js y render dinámico.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await query<Array<{ ok: number; now: string }>>(
      "SELECT 1 AS ok, NOW() AS now"
    );
    return NextResponse.json({ status: "ok", result: rows[0] ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ status: "error", message }, { status: 500 });
  }
}
