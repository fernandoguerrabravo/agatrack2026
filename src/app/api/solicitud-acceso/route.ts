import { NextRequest, NextResponse } from "next/server";
import { pgQuery } from "@/lib/postgres";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  try {
    const { rut, empresa, email, celular, pais, turnstileToken } = await req.json();

    if (!rut || !empresa || !email || !celular || !pais) {
      return NextResponse.json(
        { error: "Todos los campos son obligatorios." },
        { status: 400 }
      );
    }

    // Verificar Turnstile token
    if (!turnstileToken) {
      return NextResponse.json(
        { error: "Verificación de seguridad requerida." },
        { status: 400 }
      );
    }

    const turnstileRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY || "",
        response: turnstileToken,
      }),
    });
    const turnstileData = await turnstileRes.json();

    if (!turnstileData.success) {
      return NextResponse.json(
        { error: "Verificación de seguridad fallida. Intente nuevamente." },
        { status: 403 }
      );
    }

    // Crear tabla si no existe
    await pgQuery(`
      CREATE TABLE IF NOT EXISTS solicitudes_acceso (
        id SERIAL PRIMARY KEY,
        rut VARCHAR(20) NOT NULL,
        empresa VARCHAR(255) NOT NULL DEFAULT '',
        email VARCHAR(255) NOT NULL,
        celular VARCHAR(30) NOT NULL,
        pais VARCHAR(100) NOT NULL DEFAULT 'Chile',
        estado VARCHAR(20) DEFAULT 'pendiente',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Guardar solicitud en PostgreSQL
    await pgQuery(
      `INSERT INTO solicitudes_acceso (rut, empresa, email, celular, pais) VALUES ($1, $2, $3, $4, $5)`,
      [rut, empresa, email, celular, pais]
    );

    // Enviar notificación por email al equipo AGATrack
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Email al equipo interno
      await resend.emails.send({
        from: process.env.RESEND_FROM || "AGATrack <reportes@agatrack.com>",
        to: ["fguerra@agenciaguerra.com", "garqueros@agenciaguerra.com", "fguerrab@agenciaguerra.com"],
        subject: `Nueva solicitud de acceso - ${empresa} (${rut})`,
        html: `
          <h2>Nueva solicitud de acceso a AGATrack</h2>
          <table style="border-collapse:collapse;font-family:Arial,sans-serif;">
            <tr><td style="padding:8px;font-weight:bold;">Empresa:</td><td style="padding:8px;">${empresa}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">RUT Empresa:</td><td style="padding:8px;">${rut}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Email:</td><td style="padding:8px;">${email}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Celular:</td><td style="padding:8px;">${celular}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">País:</td><td style="padding:8px;">${pais}</td></tr>
          </table>
          <p style="margin-top:16px;color:#666;">Solicitud recibida el ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}</p>
        `,
      });

      // Email de confirmación al solicitante
      await resend.emails.send({
        from: process.env.RESEND_FROM || "AGATrack <reportes@agatrack.com>",
        to: [email],
        subject: "Solicitud de acceso recibida - AGATrack",
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<div style="align-items:center;background:#f4f4f4;border:2px solid #d3d3d3;color:#000;display:flex;flex-direction:column;font-family:Arial, sans-serif;gap:24px;justify-content:center;max-width:fit-content;min-width:600px;overflow:clip">
  <div style="align-items:center;background:#1a2b4a;color:#fff;display:flex;justify-content:center;padding:16px;width:100%">
    <img src="https://agatrack.com/logo_agatrack.png" alt="AGATrack" width="240" height="75" style="height:auto" />
  </div>
  <div style="padding:20px 20px;width:100%">
    <div style="gap:16px;display:flex;margin:0 20px;flex-direction:column">
      <h1 style="font-weight:600;font-size:20px;color:#1a2b4a">Solicitud de Acceso Recibida</h1>
      <p style="font-size:14px;color:#333;line-height:1.6">
        Estimado/a,
      </p>
      <p style="font-size:14px;color:#333;line-height:1.6">
        Hemos recibido su solicitud de acceso a <strong>AGATrack</strong>, nuestro Sistema de Seguimiento de Operaciones de Comercio Exterior.
      </p>
      <div style="background:#f0f7ff;border-left:4px solid #1a2b4a;padding:12px 16px;border-radius:4px">
        <p style="margin:0 0 8px 0;font-size:14px;color:#1a2b4a"><strong>Datos registrados:</strong></p>
        <p style="margin:0;font-size:13px;color:#333">Empresa: <strong>${empresa}</strong></p>
        <p style="margin:4px 0 0 0;font-size:13px;color:#333">RUT Empresa: <strong>${rut}</strong></p>
        <p style="margin:4px 0 0 0;font-size:13px;color:#333">Email: <strong>${email}</strong></p>
        <p style="margin:4px 0 0 0;font-size:13px;color:#333">País: <strong>${pais}</strong></p>
      </div>
      <p style="font-size:14px;color:#333;line-height:1.6">
        Un ejecutivo de AGATrack se comunicará con usted a la brevedad para coordinar la activación de su cuenta.
      </p>
      <p style="font-size:14px;color:#333;line-height:1.6">
        Saludos cordiales,<br/>
        <strong>Equipo AGATrack</strong>
      </p>
    </div>
  </div>
  <div style="padding:20px 20px;width:100%">
    <div style="background-color:#1a2b4a;margin:0 20px;padding:20px;font-size:12px;color:#fff;border-radius:4px">
      <p style="margin:0 0 10px 0">No solicitaremos información sensible por correo electrónico, <b>salvo expresa solicitud del cliente</b>. Si tiene dudas sobre la autenticidad de este correo, por favor contacte a nuestro equipo de soporte a través de los canales oficiales de AGATrack.</p>
      <p style="margin:0">Este es un correo automático de confirmación. No es necesario responder.</p>
    </div>
  </div>
  <div style="align-items:center;background:#1a2b4a;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:16px;width:100%;gap:4px">
    <small style="color:#e8a838">AGATrack - Sistema Seguimiento Operaciones Comex</small>
    <small style="color:#ffffff80">Este es un correo electrónico automático. Favor, no responder.</small>
  </div>
</div>`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[solicitud-acceso]", error);
    return NextResponse.json(
      { error: "Error al procesar la solicitud." },
      { status: 500 }
    );
  }
}
