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

    const claves = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const claveSecreta = claves.default;
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
    return responder({ turno_id: turno.turno_id, codigo: turno.codigo, upload });
  } catch {
    return responder({ error: "No pudimos procesar la solicitud. Probá nuevamente." }, 400);
  }
});
