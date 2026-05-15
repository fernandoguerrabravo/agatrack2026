import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { container, scac } = await req.json();

  if (!container || container.length !== 11) {
    return NextResponse.json(
      { error: "Número de contenedor inválido. Debe tener 11 caracteres (ej: MSCU1234567)." },
      { status: 400 }
    );
  }

  const apiKey = process.env.FINDTEU_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key de FindTEU no configurada." }, { status: 500 });
  }

  try {
    const url = `https://api.findteu.com/container/${container}`;
    const body: Record<string, string> = {};
    if (scac) body.scac = scac;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Authorization-ApiKey": apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });

    const data = await res.json();

    if (!data.success) {
      return NextResponse.json(
        { error: data.error?.text || "Error al consultar FindTEU." },
        { status: 400 }
      );
    }

    return NextResponse.json(data.data);
  } catch (error) {
    console.error("[tracking]", error);
    return NextResponse.json({ error: "Error de conexión con FindTEU." }, { status: 500 });
  }
}
