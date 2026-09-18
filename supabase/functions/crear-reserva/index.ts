import { createClient } from "npm:@supabase/supabase-js@2";

type Archivo = { nombre: string; tipo: string; bytes: number } | null;
type Solicitud = {
  proveedor: string;
  cuit: string;
  email: string;
  ordenCompra: string;
  numeroRemito: string;
  fecha: string;
  hora: string;
  patente?: string;
  transportista?: string;
  archivo: Archivo;
};

type RespuestaCorreo = { codigo: string; email_enviado: boolean };

const TIPOS_PERMITIDOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function responder(cuerpo: Record<string, unknown>, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function archivoSeguro(nombre: string) {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100) || "remito";
}

function escaparHtml(valor: string) {
  return valor.replace(/[&<>"']/g, (caracter) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[caracter] ?? caracter);
}

function fechaLegible(fecha: string) {
  const [anio, mes, dia] = fecha.split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha;
}

function claveServicio() {
  const directa = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  if (directa) return directa;
  try {
    return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || null;
  } catch {
    return null;
  }
}

async function enviarConfirmacion(datos: Solicitud, reserva: RespuestaCorreo) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return false;

  const destinatario = datos.email.trim();
  const origen = Deno.env.get("RESEND_FROM") || "Turnos Gottert <onboarding@resend.dev>";
  const proveedor = escaparHtml(datos.proveedor || "Proveedor");
  const codigo = escaparHtml(reserva.codigo);
  const orden = escaparHtml(datos.ordenCompra);
  const remito = escaparHtml(datos.numeroRemito);
  const fecha = escaparHtml(fechaLegible(datos.fecha));
  const hora = escaparHtml(datos.hora);
  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: origen,
      to: [destinatario],
      subject: `Confirmación de turno ${reserva.codigo}`,
      html: `<main style="max-width:600px;margin:0 auto;padding:32px;font-family:Arial,sans-serif;color:#202020"><p style="margin:0 0 18px;color:#007a39;font-size:12px;font-weight:700;letter-spacing:1px">GÖTTERT · RECEPCIÓN DE MERCADERÍA</p><h1 style="margin:0 0 12px;font-size:28px">Tu turno quedó confirmado</h1><p style="line-height:1.6">Hola, ${proveedor}. Registramos tu turno de entrega. Conservá este correo como comprobante.</p><section style="margin:24px 0;padding:20px;background:#f6f6f3;border-top:5px solid #ffcc00;border-radius:12px"><p style="margin:0 0 12px;font-size:22px;font-weight:700;color:#007a39">${codigo}</p><p style="margin:7px 0"><b>Fecha:</b> ${fecha}</p><p style="margin:7px 0"><b>Horario:</b> ${hora}</p><p style="margin:7px 0"><b>OC:</b> ${orden}</p><p style="margin:7px 0"><b>Remito:</b> ${remito}</p></section><p style="line-height:1.6">Si necesitás modificar la entrega, comunicate con el equipo de recepción.</p></main>`,
    }),
  });
  return respuesta.ok;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return responder({ error: "Método no permitido." }, 405);

  try {
    const datos = await request.json() as Solicitud;
    const requeridos = [datos.cuit, datos.email, datos.ordenCompra, datos.numeroRemito, datos.fecha, datos.hora];
    if (requeridos.some((valor) => !valor?.trim())) {
      return responder({ error: "Completá todos los datos obligatorios." }, 400);
    }
    if (!datos.archivo || !TIPOS_PERMITIDOS.has(datos.archivo.tipo) || datos.archivo.bytes <= 0 || datos.archivo.bytes > 10 * 1024 * 1024) {
      return responder({ error: "El remito debe ser PDF o imagen y no superar 10 MB." }, 400);
    }

    const claveSecreta = claveServicio();
    const url = Deno.env.get("SUPABASE_URL");
    if (!url || !claveSecreta) return responder({ error: "La función no está configurada." }, 500);

    const supabase = createClient(url, claveSecreta, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let upload: { path: string; token: string } | undefined;
    let rutaArchivo: string | null = null;
    if (datos.archivo) {
      rutaArchivo = `turnos/${crypto.randomUUID()}/${archivoSeguro(datos.archivo.nombre)}`;
      const { data: firmado, error: errorFirma } = await supabase.storage
        .from("remitos")
        .createSignedUploadUrl(rutaArchivo);
      if (errorFirma || !firmado) return responder({ error: "No pudimos preparar el archivo del remito." }, 500);
      upload = { path: firmado.path, token: firmado.token };
    }

    const { data: reserva, error: errorReserva } = await supabase.rpc("crear_turno_publico", {
      p_orden_compra: datos.ordenCompra,
      p_cuit: datos.cuit,
      p_email: datos.email,
      p_numero_remito: datos.numeroRemito,
      p_fecha: datos.fecha,
      p_hora: datos.hora,
      p_patente: datos.patente || null,
      p_transportista: datos.transportista || null,
      p_archivo_path: rutaArchivo,
      p_archivo_mime: datos.archivo?.tipo || null,
      p_archivo_bytes: datos.archivo?.bytes || null,
    });

    if (errorReserva || !reserva) {
      return responder({ error: errorReserva?.message || "No pudimos reservar el turno." }, 400);
    }

    const turno = reserva as { turno_id: string; codigo: string };
    const emailEnviado = await enviarConfirmacion(datos, { codigo: turno.codigo, email_enviado: false });
    return responder({ turno_id: turno.turno_id, codigo: turno.codigo, upload, email_enviado: emailEnviado });
  } catch {
    return responder({ error: "No pudimos procesar la solicitud. Probá nuevamente." }, 400);
  }
});
