import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByRut, createUser } from "@/lib/users";
import { isValidRut, cleanRut } from "@/lib/rut";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { rut, password, nombre, email } = body as {
      rut?: string;
      password?: string;
      nombre?: string;
      email?: string;
    };

    if (!rut || !password || !email) {
      return NextResponse.json(
        { error: "RUT, correo electrónico y contraseña son requeridos." },
        { status: 400 }
      );
    }

    // Validar formato email básico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "El correo electrónico no es válido." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 6 caracteres." },
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

    // Verificar si ya existe
    const existing = await findUserByRut(cleaned);
    if (existing) {
      return NextResponse.json(
        { error: "Este RUT ya está registrado." },
        { status: 409 }
      );
    }

    // Hashear contraseña
    const passwordHash = await bcrypt.hash(password, 10);

    // Crear usuario en Airtable
    const user = await createUser({
      rut: cleaned,
      passwordHash,
      nombre: nombre ?? "",
      email,
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
    console.error("Register error:", message);
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
