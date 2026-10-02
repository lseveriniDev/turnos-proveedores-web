const { escaparHtml } = require("./common");

async function sendConfirmation(turno, proveedor) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return false;
  const asunto = `Confirmación de turno ${turno.codigo}`;
  const fecha = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(turno.inicio));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [turno.email_contacto],
      subject: asunto,
      html: `<p>Hola:</p><p>Tu turno de entrega quedó ${turno.estado === "retenido" ? "pendiente de revisión" : "confirmado"}.</p><p><strong>${escaparHtml(turno.codigo)}</strong><br>${escaparHtml(proveedor.razon_social)}<br>OC ${escaparHtml(turno.orden_compra)}<br>${escaparHtml(fecha)}</p><p>Göttert</p>`,
    }),
  });
  return response.ok;
}

module.exports = { sendConfirmation };
