import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByRut } from "@/lib/airtable";
import { isValidRut, cleanRut } from "@/lib/rut";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { rut, password } = body as { rut?: string; password?: string };

    if (!rut || !password) {
      return NextResponse.json(
        { error: "RUT y contraseña son requeridos." },
        { status: 400 }
      );
    }

    const cleaned = cleanRut(rut);

    if (!isValidRut(cleaned)) {
      return NextResponse.json(
        { error: "El RUT ingresado no es válido." },
        { status: 400 }
      );
    }

    const user = await findUserByRut(cleaned);

    if (!user) {
      return NextResponse.json(
        { error: "Usuario no encontrado. Debe registrarse primero." },
        { status: 401 }
      );
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      return NextResponse.json(
        { error: "Contraseña incorrecta." },
        { status: 401 }
      );
    }

    // Crear sesión (cookie httpOnly con JWT)
    await createSession({
      rut: user.rut,
      nombre: user.nombre ?? "",
      email: user.email ?? "",
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        rut: user.rut,
        nombre: user.nombre,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Login error:", message);
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
