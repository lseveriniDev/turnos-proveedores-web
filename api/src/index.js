const crypto = require("node:crypto");
const { app } = require("@azure/functions");
const {
  HORARIOS, ESTADOS_ACTIVOS, TIPOS_ARCHIVO, db, json, fail, cuitNormalizado, remitoNormalizado,
  validarFechaHora, evaluarLineas, newId,
} = require("./common");
const { uploadRemito, deleteRemito } = require("./graph");
const { sendConfirmation } = require("./mail");

const limiteArchivo = 10 * 1024 * 1024;

function checked(value, max = 160) {
  const text = String(value || "").trim();
  if (!text || text.length > max) fail("Revisá los datos ingresados.");
  return text;
}

async function body(request) {
  try { return await request.json(); }
  catch { fail("La solicitud no tiene un formato válido."); }
}

async function config() {
  const doc = await db().collection("configuracion").doc("principal").get();
  return doc.data() || { anticipacion_minutos: 120, max_turnos_abiertos: 10 };
}

async function findOrder(cuit, numero) {
  const normalized = cuitNormalizado(cuit);
  if (!normalized) fail("Ingresá un CUIT válido.");
  const order = await db().collection("ordenes_compra").doc(checked(numero, 40)).get();
  const data = order.data();
  if (!data || data.estado !== "abierta" || data.proveedor_cuit !== normalized) {
    fail("No encontramos una orden de compra abierta para ese CUIT.", 404);
  }
  const supplier = await db().collection("proveedores").doc(normalized.replace(/\D/g, "")).get();
  if (!supplier.exists || supplier.data().habilitado === false) fail("El proveedor no está habilitado.", 403);
  return { order: data, supplier: supplier.data(), cuit: normalized };
}

async function slots(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fail("Elegí una fecha válida.");
  const settings = await config();
  const refs = HORARIOS.map((hora) => db().collection("slots").doc(`${fecha}_${hora.replace(":", "")}`));
  const snapshots = await db().getAll(...refs);
  return HORARIOS.filter((hora, index) => {
    try { validarFechaHora(fecha, hora, Number(settings.anticipacion_minutos) || 120); }
    catch { return false; }
    return !snapshots[index].exists;
  });
}

function errorResponse(error, context) {
  const status = error?.status || 500;
  if (status >= 500) context.error(error);
  return json({ error: status >= 500 ? "No pudimos completar la operación. Intentá nuevamente." : error.message }, status);
}

function route(name, methods, handler, extra = {}) {
  app.http(name, {
    methods, authLevel: "anonymous",
    route: name.replace(/_/g, "/"),
    ...extra,
    handler: async (request, context) => {
      try { return await handler(request, context); }
      catch (error) { return errorResponse(error, context); }
    },
  });
}

route("access", ["POST"], async (request) => {
  const data = await body(request);
  const result = await findOrder(data.cuit, data.ordenCompra);
  return json({ razon_social: result.supplier.razon_social });
});

route("order", ["POST"], async (request) => {
  const data = await body(request);
  const result = await findOrder(data.cuit, data.ordenCompra);
  return json({ lineas: result.order.lineas || [] });
});

route("slots", ["GET"], async (request) => json({ horarios: await slots(request.query.get("fecha") || "") }));

route("book", ["POST"], async (request, context) => {
  const form = await request.formData();
  const file = form.get("archivo");
  if (!file || typeof file.arrayBuffer !== "function") fail("Adjuntá el remito.");
  if (!TIPOS_ARCHIVO.has(file.type) || file.size <= 0 || file.size > limiteArchivo) {
    fail("Adjuntá un PDF o imagen de hasta 10 MB.");
  }
  let data;
  try { data = JSON.parse(String(form.get("datos") || "{}")); }
  catch { fail("Revisá los datos del turno."); }
  const { order, supplier, cuit } = await findOrder(data.cuit, data.ordenCompra);
  const numeroRemito = checked(data.numeroRemito, 80);
  const normalizedRemito = remitoNormalizado(numeroRemito);
  if (!normalizedRemito) fail("Ingresá el número de remito.");
  const fecha = checked(data.fecha, 10);
  const hora = checked(data.hora, 5);
  const settings = await config();
  const inicio = validarFechaHora(fecha, hora, Number(settings.anticipacion_minutos) || 120);
  const disponible = await slots(fecha);
  if (!disponible.includes(hora)) fail("Ese horario ya no está disponible.", 409);
  const email = checked(data.email, 254);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Ingresá un correo válido.");
  const lineas = Array.isArray(data.lineasDeclaradas) ? data.lineasDeclaradas : [];
  const motivoRevision = evaluarLineas(order.lineas || [], lineas, Boolean(data.lecturaIncompleta));
  const turnoId = newId();
  const safeExt = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" :
    file.type === "image/webp" ? "webp" : file.type === "image/heic" ? "heic" : "jpg";
  const filename = `${remitoNormalizado(numeroRemito).replace(/[^A-Z0-9-]/gi, "-")}_${fecha}_${turnoId}.${safeExt}`;
  const saved = await uploadRemito(Buffer.from(await file.arrayBuffer()), filename, file.type, supplier.razon_social, order.numero);
  const key = crypto.createHash("sha256").update(`${cuit}|${normalizedRemito}`).digest("hex");
  const turnoRef = db().collection("turnos").doc(turnoId);
  const slotRef = db().collection("slots").doc(`${fecha}_${hora.replace(":", "")}`);
  const remitoRef = db().collection("remitoKeys").doc(key);
  const counterRef = db().collection("counters").doc("turnos");
  const estado = motivoRevision ? "retenido" : "confirmado";
  let turno;
  try {
    await db().runTransaction(async (tx) => {
      const [slot, remito, counter, orderNow, supplierTurns] = await Promise.all([
        tx.get(slotRef), tx.get(remitoRef), tx.get(counterRef),
        tx.get(db().collection("ordenes_compra").doc(order.numero)),
        tx.get(db().collection("turnos").where("proveedor_cuit", "==", cuit)),
      ]);
      if (slot.exists) fail("Ese horario ya no está disponible.", 409);
      if (remito.exists) fail("Ese número de remito ya está registrado para este proveedor.", 409);
      if (orderNow.data()?.estado !== "abierta" || orderNow.data()?.proveedor_cuit !== cuit) fail("La OC ya no está abierta.", 409);
      evaluarLineas(orderNow.data().lineas || [], lineas, Boolean(data.lecturaIncompleta));
      const abiertos = supplierTurns.docs.filter((doc) => ESTADOS_ACTIVOS.has(doc.data().estado)).length;
      if (abiertos >= Number(settings.max_turnos_abiertos || 10)) fail("El proveedor alcanzó el máximo de turnos abiertos.", 409);
      const sequence = Number(counter.data()?.next || 24);
      const codigo = `TP-${String(sequence).padStart(5, "0")}`;
      turno = {
        id: turnoId, codigo, orden_compra: order.numero, proveedor_cuit: cuit,
        proveedor_nombre: supplier.razon_social, fecha, hora, inicio: inicio.toISOString(),
        estado, email_contacto: email, patente: String(data.patente || "").slice(0, 40),
        transportista: String(data.transportista || "").slice(0, 160),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        remito: {
          numero: numeroRemito, numero_normalizado: normalizedRemito,
          mime_type: file.type, bytes: file.size, sharepoint_item_id: saved.itemId,
          sharepoint_web_url: saved.webUrl, lineas_declaradas: lineas, motivo_revision: motivoRevision,
        },
      };
      tx.create(turnoRef, turno);
      tx.create(slotRef, { turno_id: turnoId, tipo: "turno", fecha, hora });
      tx.create(remitoRef, { turno_id: turnoId, proveedor_cuit: cuit, numero: numeroRemito });
      tx.set(counterRef, { next: sequence + 1 }, { merge: true });
    });
  } catch (error) {
    try { await deleteRemito(saved.itemId); }
    catch (cleanupError) { context.error("No se pudo limpiar un archivo tras una reserva rechazada.", cleanupError); }
    throw error;
  }
  let emailEnviado = false;
  try { emailEnviado = await sendConfirmation(turno, supplier); }
  catch (error) { context.error("No se pudo enviar el correo de confirmación.", error); }
  return json({
    codigo: turno.codigo, turno_id: turnoId, retenido: estado === "retenido",
    motivo: motivoRevision, email_enviado: emailEnviado,
  }, 201);
});


