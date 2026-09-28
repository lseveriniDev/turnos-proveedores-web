import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors";

type Archivo = { nombre: string; tipo: string; bytes: number } | null;
type Solicitud = {
  accion: "crear";
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

type Confirmacion = { accion: "confirmar"; turno_id: string; token: string };
type Cancelacion = { accion: "cancelar"; turno_id: string; token: string };
type RespuestaCorreo = { codigo: string };
type DatosCorreo = Pick<Solicitud, "proveedor" | "email" | "ordenCompra" | "numeroRemito" | "fecha" | "hora">;

const TIPOS_PERMITIDOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

function responder(cuerpo: Record<string, unknown>, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

async function enviarConfirmacion(datos: DatosCorreo, reserva: RespuestaCorreo) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const origen = Deno.env.get("RESEND_FROM");
  if (!apiKey || !origen) return false;

  const destinatario = datos.email.trim();
  const proveedor = escaparHtml(datos.proveedor || "Proveedor");
  const codigo = escaparHtml(reserva.codigo);
  const orden = escaparHtml(datos.ordenCompra);
  const remito = escaparHtml(datos.numeroRemito);
  const fecha = escaparHtml(fechaLegible(datos.fecha));
  const hora = escaparHtml(datos.hora);
  try {
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: origen,
        to: [destinatario],
        subject: `Confirmación de turno ${reserva.codigo}`,
        html: `<main style="max-width:600px;margin:0 auto;padding:32px;font-family:Arial,sans-serif;color:#202020"><p style="margin:0 0 18px;color:#007a39;font-size:12px;font-weight:700;letter-spacing:1px">GÖTTERT · RECEPCIÓN DE MERCADERÍA</p><h1 style="margin:0 0 12px;font-size:28px">Tu turno quedó confirmado</h1><p style="line-height:1.6">Hola, ${proveedor}. Registramos tu turno de entrega. Conservá este correo como comprobante.</p><section style="margin:24px 0;padding:20px;background:#f6f6f3;border-top:5px solid #ffcc00;border-radius:12px"><p style="margin:7px 0"><b>Fecha:</b> ${fecha}</p><p style="margin:7px 0"><b>Horario:</b> ${hora}</p><p style="margin:7px 0"><b>OC:</b> ${orden}</p><p style="margin:7px 0"><b>Remito:</b> ${remito}</p><p style="margin:7px 0"><b>Código:</b> ${codigo}</p></section></main>`,
      }),
    });
    if (!respuesta.ok) console.error(`No se pudo enviar la confirmación: HTTP ${respuesta.status}`);
    return respuesta.ok;
  } catch {
    return false;
  }
}

async function tokenConfirmacion(turnoId: string, ruta: string, clave: string) {
  const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(`${turnoId}:${ruta}`));
  return Array.from(new Uint8Array(firma), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tokensIguales(a: string, b: string) {
  if (!/^[0-9a-f]{64}$/.test(a) || a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

function fechaYHora(inicio: string) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(inicio));
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return { fecha: `${valor("year")}-${valor("month")}-${valor("day")}`, hora: `${valor("hour")}:${valor("minute")}` };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return responder({ error: "Método no permitido." }, 405);

  try {
    const datos = await request.json() as Solicitud | Confirmacion | Cancelacion;

    const claveSecreta = claveServicio();
    const url = Deno.env.get("SUPABASE_URL");
    if (!url || !claveSecreta) return responder({ error: "La función no está configurada." }, 500);

    const supabase = createClient(url, claveSecreta, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (datos.accion === "confirmar" || datos.accion === "cancelar") {
      if (!/^[0-9a-f-]{36}$/i.test(datos.turno_id) || !/^[0-9a-f]{64}$/.test(datos.token)) {
        return responder({ error: "La confirmación del turno no es válida." }, 400);
      }
      const { data: turno, error: errorTurno } = await supabase.from("turnos")
        .select("id,codigo,inicio,estado,email_contacto,proveedores(razon_social),ordenes_compra(numero),remitos(numero,storage_path,mime_type,bytes)")
        .eq("id", datos.turno_id).single();
      if (errorTurno || !turno) return responder({ error: "No encontramos el turno." }, 404);
      const registro = turno as unknown as {
        id: string; codigo: string; inicio: string; estado: string; email_contacto: string;
        proveedores: { razon_social: string } | null; ordenes_compra: { numero: string } | null;
        remitos: { numero: string; storage_path: string | null; mime_type: string | null; bytes: number | null }[] |
          { numero: string; storage_path: string | null; mime_type: string | null; bytes: number | null } | null;
      };
      const remito = Array.isArray(registro.remitos) ? registro.remitos[0] : registro.remitos;
      if (!remito?.storage_path || !tokensIguales(datos.token, await tokenConfirmacion(registro.id, remito.storage_path, claveSecreta))) {
        return responder({ error: "La confirmación del turno no es válida." }, 403);
      }
      if (registro.estado === "anulado") return responder({ error: "El turno fue anulado." }, 409);
      if (datos.accion === "cancelar") {
        const { data: anulado, error: errorAnular } = await supabase.from("turnos")
          .update({ estado: "anulado" }).eq("id", registro.id).eq("estado", "reservado").select("id").maybeSingle();
        if (errorAnular || !anulado) return responder({ error: "No pudimos liberar el horario." }, 409);
        return responder({ cancelado: true });
      }
      const { data: archivo, error: errorArchivo } = await supabase.storage.from("remitos").info(remito.storage_path);
      if (errorArchivo || !archivo || Number(archivo.size) !== remito.bytes || archivo.contentType !== remito.mime_type) {
        return responder({ error: "El remito todavía no se cargó correctamente." }, 409);
      }
      if (registro.estado !== "reservado") return responder({ confirmado: true, email_enviado: false });
      const { data: confirmado, error: errorConfirmar } = await supabase.from("turnos")
        .update({ estado: "confirmado" }).eq("id", registro.id).eq("estado", "reservado").select("id").maybeSingle();
      if (errorConfirmar) return responder({ error: "No pudimos confirmar el turno." }, 500);
      if (!confirmado) return responder({ confirmado: true, email_enviado: false });
      const fechaHora = fechaYHora(registro.inicio);
      const emailEnviado = await enviarConfirmacion({
        proveedor: registro.proveedores?.razon_social ?? "Proveedor", email: registro.email_contacto,
        ordenCompra: registro.ordenes_compra?.numero ?? "", numeroRemito: remito.numero,
        ...fechaHora,
      }, { codigo: registro.codigo });
      return responder({ confirmado: true, email_enviado: emailEnviado });
    }

    if (datos.accion !== "crear") return responder({ error: "Acción no permitida." }, 400);
    const requeridos = [datos.cuit, datos.email, datos.ordenCompra, datos.numeroRemito, datos.fecha, datos.hora];
    if (requeridos.some((valor) => !valor?.trim())) return responder({ error: "Completá todos los datos obligatorios." }, 400);
    if (!datos.archivo || !TIPOS_PERMITIDOS.has(datos.archivo.tipo) || datos.archivo.bytes <= 0 || datos.archivo.bytes > 10 * 1024 * 1024) {
      return responder({ error: "El remito debe ser PDF o imagen y no superar 10 MB." }, 400);
    }
    const rutaArchivo = `turnos/${crypto.randomUUID()}/${archivoSeguro(datos.archivo.nombre)}`;
    const { data: reserva, error: errorReserva } = await supabase.rpc("crear_turno_publico", {
      p_orden_compra: datos.ordenCompra, p_cuit: datos.cuit, p_email: datos.email,
      p_numero_remito: datos.numeroRemito, p_fecha: datos.fecha, p_hora: datos.hora,
      p_patente: datos.patente || null, p_transportista: datos.transportista || null,
      p_archivo_path: rutaArchivo, p_archivo_mime: datos.archivo.tipo, p_archivo_bytes: datos.archivo.bytes,
    });
    if (errorReserva || !reserva) return responder({ error: errorReserva?.message || "No pudimos reservar el turno." }, 400);
    const turno = reserva as { turno_id: string; codigo: string };
    const { data: firmado, error: errorFirma } = await supabase.storage.from("remitos").createSignedUploadUrl(rutaArchivo);
    if (errorFirma || !firmado) {
      await supabase.from("turnos").update({ estado: "anulado" }).eq("id", turno.turno_id).eq("estado", "reservado");
      return responder({ error: "No pudimos preparar el archivo del remito. Probá nuevamente." }, 500);
    }
    return responder({
      turno_id: turno.turno_id, codigo: turno.codigo,
      upload: { path: firmado.path, token: firmado.token },
      confirmacion_token: await tokenConfirmacion(turno.turno_id, rutaArchivo, claveSecreta),
    });
  } catch {
    return responder({ error: "No pudimos procesar la solicitud. Probá nuevamente." }, 400);
  }
});
