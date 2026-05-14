/**
 * Template HTML para el reporte diario de despachos.
 * Usa colores de AGATrack (azul marino #1a2b4a, dorado #e8a838).
 */

function getEmailTemplate({ nombre, rut, desde, hasta, rowCount, mesAnio }) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<div style="align-items:center;background:#f4f4f4;border:2px solid #d3d3d3;color:#000;display:flex;flex-direction:column;font-family:Arial, sans-serif;gap:24px;justify-content:center;max-width:fit-content;min-width:800px;overflow:clip">
  <!-- Header -->
  <div style="align-items:center;background:#1a2b4a;color:#fff;display:flex;justify-content:center;padding:16px;width:100%">
    <img src="https://agatrack.agenciaguerra.com/logo_agatrack.png" alt="AGATrack" width="160" height="50" style="height:auto" />
  </div>

  <!-- Contenido -->
  <div style="padding:20px 20px;width:100%">
    <div style="gap:20px;display:flex;margin:0 20px;flex-direction:column">
      <h1 style="font-weight:600;font-size:20px;color:#1a2b4a">Reporte automático de despachos de ${mesAnio}</h1>
      
      <p style="font-size:14px;color:#333">Clientes considerados:</p>
      <ol style="font-size:14px;color:#333">
        <li><strong>${nombre}</strong> (${rut})</li>
      </ol>
      
      <p style="font-size:14px;color:#333">Este reporte adjunto corresponde a los despachos aceptados entre el <strong>${desde}</strong> y el <strong>${hasta}</strong>.</p>
      
      <div style="background:#f0f7ff;border-left:4px solid #1a2b4a;padding:12px 16px;border-radius:4px">
        <p style="margin:0;font-size:14px;color:#1a2b4a"><strong>Total operaciones en el período:</strong> ${rowCount}</p>
      </div>

      <p style="font-size:14px;color:#333">Si desea revisar el reporte en línea o el archivo adjunto no se puede visualizar correctamente, puede obtener su reporte a través de la aplicación web de AGATrack.</p>
      
      <a href="https://agatrack.agenciaguerra.com" style="display:inline-block;background:#e8a838;color:#1a2b4a;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px">Ir a AGATrack</a>
    </div>
  </div>

  <!-- Disclaimer -->
  <div style="padding:20px 20px;width:100%">
    <div style="background-color:#1a2b4a;margin:0 20px;padding:20px;font-size:12px;color:#fff;border-radius:4px">
      <p style="margin:0 0 10px 0">No solicitaremos información sensible por correo electrónico, <b>salvo expresa solicitud del cliente</b>. Si tiene dudas sobre la autenticidad de este correo, por favor contacte a nuestro equipo de soporte a través de los canales oficiales de AGATrack.</p>
      <p style="margin:0">Evite acceder a links o páginas que soliciten sus credenciales o información personal si esta no es previamente solicitada por usted. El envío de archivos adjuntos sólo se realiza en casos excepcionales según previa solicitud de los clientes.</p>
    </div>
  </div>

  <!-- Footer -->
  <div style="align-items:center;background:#1a2b4a;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:16px;width:100%;gap:4px">
    <small style="color:#e8a838">AGATrack - Sistema Seguimiento Operaciones Comex</small>
    <small style="color:#ffffff80">Este es un correo electrónico automático. Favor, no responder.</small>
  </div>
</div>`;
}

module.exports = { getEmailTemplate };
