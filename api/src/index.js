const crypto = require("node:crypto");
const { app } = require("@azure/functions");
const {
  HORARIOS, ESTADOS_ACTIVOS, TIPOS_ARCHIVO, db, json, fail, cuitNormalizado, remitoNormalizado,
  validarFechaHora, evaluarLineas, requireAdmin, newId,
} = require("./common");
const { uploadRemito, downloadRemito, deleteRemito } = require("./graph");
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
    methods, authLevel: "anonymous", route: name.replace(/_/g, "/"), ...extra,
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
  const saved = await uploadRemito(Buffer.from(await file.arrayBuffer()), filename, file.type, supplier.razon_social, cuit, order.numero);
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

route("admin_agenda", ["GET"], async (request) => {
  try { await requireAdmin(request); }
  catch (error) {
    return json({ error: `No pudimos validar tu sesión: ${error instanceof Error ? error.message : "error desconocido"}` }, error?.status || 500);
  }
  const fecha = checked(request.query.get("fecha"), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fail("Elegí una fecha válida.");
  try {
    const result = await db().collection("turnos").where("fecha", "==", fecha).get();
    const agenda = result.docs.map((doc) => doc.data()).sort((a, b) => a.hora.localeCompare(b.hora));
    return json({ agenda });
  } catch (error) {
    return json({ error: `No pudimos consultar la agenda: ${error instanceof Error ? error.message : "error desconocido"}` }, 500);
  }
});

route("admin_health", ["GET"], async (request) => {
  let cuenta = null;
  try {
    const header = request.headers.get("x-ms-client-principal");
    cuenta = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8"))?.userDetails || null : null;
  } catch { /* El chequeo de acceso informa el motivo. */ }
  try {
    const principal = await requireAdmin(request);
    return json({ autorizado: true, cuenta: principal.userDetails, version: "2026-10-02-b" });
  } catch (error) {
    return json({ autorizado: false, cuenta, motivo: error instanceof Error ? error.message : "error desconocido", version: "2026-10-02-b" });
  }
});

route("admin_turno", ["POST"], async (request) => {
  await requireAdmin(request);
  const data = await body(request);
  if (!["anulado", "en_planta"].includes(data.estado)) fail("Estado inválido.");
  const ref = db().collection("turnos").doc(checked(data.id, 80));
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail("No encontramos el turno.", 404);
    const turno = snapshot.data();
    if (turno.estado === "anulado") fail("El turno ya estaba anulado.", 409);
    if (data.estado === "en_planta" && turno.estado === "retenido") fail("Primero revisá y aprobá el remito.", 409);
    tx.update(ref, { estado: data.estado, updated_at: new Date().toISOString() });
    if (data.estado === "anulado") tx.delete(db().collection("slots").doc(`${turno.fecha}_${turno.hora.replace(":", "")}`));
  });
  return json({ ok: true });
});

route("admin_approve", ["POST"], async (request, context) => {
  await requireAdmin(request);
  const data = await body(request);
  const ref = db().collection("turnos").doc(checked(data.id, 80));
  const turno = await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data().estado !== "retenido") fail("El turno ya no está pendiente de revisión.", 409);
    tx.update(ref, { estado: "confirmado", updated_at: new Date().toISOString() });
    return { ...snapshot.data(), estado: "confirmado" };
  });
  let emailEnviado = false;
  try { emailEnviado = await sendConfirmation(turno, { razon_social: turno.proveedor_nombre }); }
  catch (error) { context.error("No se pudo enviar el correo de aprobación.", error); }
  return json({ aprobado: true, email_enviado: emailEnviado });
});

route("admin_remito", ["GET"], async (request) => {
  await requireAdmin(request);
  const id = checked(request.query.get("id"), 80);
  const snapshot = await db().collection("turnos").doc(id).get();
  if (!snapshot.exists) fail("No encontramos el remito.", 404);
  const remito = snapshot.data().remito;
  if (!remito?.sharepoint_item_id) fail("El archivo histórico todavía no se trasladó a SharePoint.", 404);
  const file = await downloadRemito(remito.sharepoint_item_id);
  return {
    status: 200, body: file,
    headers: {
      "Content-Type": remito.mime_type || "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  };
});

route("admin_control", ["GET"], async (request) => {
  await requireAdmin(request);
  const id = checked(request.query.get("id"), 80);
  const snapshot = await db().collection("turnos").doc(id).get();
  if (!snapshot.exists) fail("No encontramos el turno.", 404);
  const remito = snapshot.data().remito || {};
  return json({ lineas: remito.lineas_legacy || [] });
});

route("admin_block", ["POST"], async (request) => {
  await requireAdmin(request);
  const data = await body(request);
  const fecha = checked(data.fecha, 10);
  const hora = checked(data.hora, 5);
  if (!HORARIOS.includes(hora) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fail("Elegí una fecha y horario válidos.");
  const motivo = checked(data.motivo, 300);
  const ref = db().collection("slots").doc(`${fecha}_${hora.replace(":", "")}`);
  await db().runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) fail("Ese horario ya está ocupado o bloqueado.", 409);
    tx.create(ref, { tipo: "bloqueo", fecha, hora, motivo, created_at: new Date().toISOString() });
  });
  return json({ ok: true });
});

route("admin_orders", ["GET"], async (request) => {
  await requireAdmin(request);
  const rows = await db().collection("ordenes_compra").get();
  return json({ ordenes: rows.docs.map((doc) => ({
    numero: doc.id, estado: doc.data().estado, updated_at: doc.data().updated_at,
  })) });
});

route("admin_backup", ["GET"], async (request) => {
  await requireAdmin(request);
  const collections = ["proveedores", "ordenes_compra", "turnos", "slots", "configuracion", "counters", "remitoKeys"];
  const rows = await Promise.all(collections.map((name) => db().collection(name).get()));
  const snapshot = Object.fromEntries(rows.map((result, index) => [
    collections[index], result.docs.map((doc) => ({ ...doc.data(), _firestore_id: doc.id })),
  ]));
  return {
    status: 200,
    body: JSON.stringify({ exportedAt: new Date().toISOString(), project: "turnos-proveedores-gottert", collections: snapshot }),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="turnos-proveedores-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  };
});

route("admin_import", ["POST"], async (request) => {
  await requireAdmin(request);
  const data = await body(request);
  const suppliers = data.proveedores;
  const orders = data.ordenes;
  const lines = data.lineas;
  const closures = data.aCerrar || [];
  if (!Array.isArray(suppliers) || !Array.isArray(orders) || !Array.isArray(lines) || !Array.isArray(closures) ||
      suppliers.length > 500 || orders.length > 1000 || lines.length > 5000) fail("La actualización no tiene un formato válido.");
  const current = await db().collection("ordenes_compra").get();
  const currentOpen = current.docs.filter((doc) => doc.data().estado === "abierta").length;
  if (data.fuente === "summa" && currentOpen >= 20 && orders.length < currentOpen / 2) {
    fail("El reporte tiene menos de la mitad de las OCs abiertas. Exportá el reporte completo.", 409);
  }
  const cuitSet = new Set(suppliers.map((row) => cuitNormalizado(row.cuit)));
  const byNumber = new Map();
  for (const row of orders) {
    if (!cuitSet.has(cuitNormalizado(row.cuit))) fail("Hay una OC sin proveedor válido.");
    byNumber.set(checked(row.orden_compra, 40), row);
  }
  for (const line of lines) {
    if (!byNumber.has(line.orden_compra)) fail("Hay un renglón sin OC.");
  }
  if (closures.some((number) => byNumber.has(number))) fail("Una OC vigente figura para cierre.");
  const grouped = new Map();
  for (const line of lines) {
    const array = grouped.get(line.orden_compra) || [];
    array.push({
      renglon: Number(line.renglon), producto_codigo: checked(line.producto_codigo, 100),
      descripcion_producto: line.descripcion_producto || null,
      unidad_medida: line.unidad_medida || null, moneda: line.moneda || null,
      cantidad_ordenada: Number(line.cantidad_ordenada), cantidad_recibida: Number(line.cantidad_recibida),
      cantidad_pendiente: Number(line.cantidad_pendiente), precio_unitario: line.precio_unitario == null ? null : Number(line.precio_unitario),
    });
    grouped.set(line.orden_compra, array);
  }
  const now = new Date().toISOString();
  const writes = [];
  for (const row of suppliers) {
    const cuit = cuitNormalizado(row.cuit);
    if (!cuit) fail("Hay un proveedor sin CUIT válido.");
    const ref = db().collection("proveedores").doc(cuit.replace(/\D/g, ""));
    const supplierData = {
      cuit, razon_social: checked(row.razon_social, 250), codigo_externo: row.codigo_externo || null,
      email: row.email || null, habilitado: true, updated_at: now,
    };
    if (!row.codigo_externo) delete supplierData.codigo_externo;
    if (!row.email) delete supplierData.email;
    writes.push({ ref, data: supplierData, merge: true });
  }
  for (const row of orders) {
    const ref = db().collection("ordenes_compra").doc(row.orden_compra);
    const orderData = {
      numero: row.orden_compra, proveedor_cuit: cuitNormalizado(row.cuit), estado: "abierta",
      fecha: row.fecha || null, updated_at: now,
    };
    if (grouped.has(row.orden_compra)) orderData.lineas = grouped.get(row.orden_compra);
    writes.push({ ref, data: orderData, merge: true });
  }
  for (const numero of closures) {
    const old = current.docs.find((doc) => doc.id === numero);
    if (!old || old.data().estado !== "abierta") continue;
    writes.push({ ref: old.ref, data: { estado: "cerrada", updated_at: now }, merge: true });
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db().batch();
    for (const write of writes.slice(i, i + 400)) batch.set(write.ref, write.data, { merge: write.merge });
    await batch.commit();
  }
  return json({ proveedores: suppliers.length, ordenes: orders.length, lineas: lines.length, cerradas: closures.length });
});
