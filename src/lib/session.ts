import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { SessionPayload } from "./types";

export type { SessionPayload };

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "fallback_dev_secret"
);

const COOKIE_NAME = "agatrack_session";

export async function createSession(payload: SessionPayload): Promise<string> {
  const token = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  });

  return token;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  // También buscar en header Authorization para mobile
  let authToken: string | undefined;
  if (!token) {
    const { headers } = await import("next/headers");
    const headerStore = await headers();
    const authHeader = headerStore.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      authToken = authHeader.slice(7);
    }
  }

  const finalToken = token || authToken;
  if (!finalToken) return null;

  try {
    const { payload } = await jwtVerify(finalToken, SECRET);
    return {
      rut: payload.rut as string,
      nombre: payload.nombre as string,
      email: payload.email as string,
      rol_prealertas: (payload.rol_prealertas as number) ?? 0,
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
