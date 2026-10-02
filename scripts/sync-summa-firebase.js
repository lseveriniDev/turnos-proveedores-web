// Import current Summa exports into Firebase. Run without --apply to review changes.
const fs = require("node:fs");
const path = require("node:path");
const readXlsxFile = require("read-excel-file/node");
const admin = require("../api/node_modules/firebase-admin");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const files = args.filter((arg) => arg !== "--apply");
if (files.length !== 2) throw new Error("Uso: node scripts/sync-summa-firebase.js OC.xlsx Proveedores.xlsx [--apply]");
const accountFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
if (!accountFile) throw new Error("Configurá FIREBASE_SERVICE_ACCOUNT_FILE con la ruta del JSON privado.");
const account = JSON.parse(fs.readFileSync(accountFile, "utf8"));
admin.initializeApp({ credential: admin.credential.cert(account), projectId: "turnos-proveedores-gottert" });
const db = admin.firestore();

function text(value) {
  if (value == null) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value).trim();
}
function number(value) {
  if (typeof value === "number") return value;
  const result = Number(text(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(result) ? result : 0;
}
function cuit(value) {
  const digits = text(value).replace(/\D/g, "");
  return digits.length === 11 && !/^0+$/.test(digits)
    ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` : "";
}
async function sheet(filename, expected, label) {
  const sheets = await readXlsxFile(filename);
  const rows = sheets[0]?.data;
  if (!rows || rows.length < 2) throw new Error(`${label}: la planilla está vacía.`);
  const headers = rows[0].map(text);
  const missing = expected.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`${label}: faltan ${missing.join(", ")}.`);
  return rows.slice(1).filter((row) => row.some((cell) => cell != null && text(cell)))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

async function main() {
  const [oc, catalog] = await Promise.all([
    sheet(files[0], ["Segmento", "Renglon_OC", "Proveed_Id", "RazonSocial", "TipoPermi_Id", "Estado_Id", "Cantidad", "Cantidad_Recibida", "CantidadPendiente", "Moneda_Id", "Producto_id", "DescripcionProducto", "Medida_Id", "Precio", "Fecha"], "OCs"),
    sheet(files[1], ["Proveed_Id", "RazonSocial", "Cuit", "EMail"], "Proveedores"),
  ]);
  const catalogByCode = new Map(catalog.map((row) => [text(row.Proveed_Id), row]));
  const candidates = new Map();
  for (const row of oc) {
    if (text(row.Estado_Id).toUpperCase() !== "A" || text(row.TipoPermi_Id).toUpperCase() === "NPI") continue;
    const order = text(row.Segmento);
    const code = text(row.Proveed_Id);
    if (!order || !code) continue;
    const previous = candidates.get(order);
    if (previous && previous.code !== code) throw new Error(`La OC ${order} aparece con más de un proveedor.`);
    candidates.set(order, {
      code,
      name: text(row.RazonSocial),
      date: previous?.date || text(row.Fecha) || null,
      pending: Boolean(previous?.pending) || number(row.CantidadPendiente) > 0,
    });
  }
  const suppliers = new Map();
  const orders = new Map();
  const protectedNumbers = new Set();
  const missingCatalog = new Set();
  const missingCuit = new Set();
  for (const [order, candidate] of candidates) {
    if (!candidate.pending) continue;
    protectedNumbers.add(order);
    const supplier = catalogByCode.get(candidate.code);
    if (!supplier) { missingCatalog.add(candidate.code); continue; }
    const id = cuit(supplier.Cuit);
    if (!id) { missingCuit.add(candidate.code); continue; }
    suppliers.set(id, {
      cuit: id,
      razon_social: text(supplier.RazonSocial) || candidate.name,
      email: text(supplier.EMail) || null,
      codigo_externo: candidate.code,
    });
    orders.set(order, { numero: order, proveedor_cuit: id, fecha: candidate.date });
  }
  if (!orders.size) throw new Error("No hay OCs vigentes con proveedor y CUIT válidos.");

  const linesByOrder = new Map();
  const lineKeys = new Set();
  const skipped = { row: new Set(), product: new Set(), negative: new Set() };
  for (const row of oc) {
    if (text(row.Estado_Id).toUpperCase() !== "A" || text(row.TipoPermi_Id).toUpperCase() === "NPI") continue;
    const order = text(row.Segmento);
    if (!orders.has(order)) continue;
    const lineNumber = Math.trunc(number(row.Renglon_OC));
    const product = text(row.Producto_id);
    if (!Number.isInteger(lineNumber) || lineNumber < 1) { skipped.row.add(order); continue; }
    if (!product) { skipped.product.add(order); continue; }
    const pending = number(row.CantidadPendiente);
    if (pending < 0) { skipped.negative.add(`${order}/${lineNumber}`); continue; }
    const key = `${order}::${lineNumber}`;
    if (lineKeys.has(key)) throw new Error(`La OC ${order} repite el renglón ${lineNumber}.`);
    lineKeys.add(key);
    const price = text(row.Precio);
    const line = {
      renglon: lineNumber, producto_codigo: product,
      descripcion_producto: text(row.DescripcionProducto) || null,
      unidad_medida: text(row.Medida_Id) || null,
      moneda: text(row.Moneda_Id) || null,
      cantidad_ordenada: number(row.Cantidad),
      cantidad_recibida: number(row.Cantidad_Recibida),
      cantidad_pendiente: pending,
      precio_unitario: price ? number(row.Precio) : null,
    };
    const list = linesByOrder.get(order) || [];
    list.push(line);
    linesByOrder.set(order, list);
  }

  const currentSuppliers = await db.collection("proveedores").get();
  const currentOrders = await db.collection("ordenes_compra").get();
  const byNumber = new Map(currentOrders.docs.map((doc) => [doc.id, doc.data()]));
  const newOrders = [...orders.keys()].filter((order) => !byNumber.has(order));
  const reopened = [...orders.keys()].filter((order) => byNumber.get(order)?.estado === "cerrada");
  const closures = currentOrders.docs.filter((doc) => doc.data().estado === "abierta" && !orders.has(doc.id) && !protectedNumbers.has(doc.id)).map((doc) => doc.id);
  const currentOpen = currentOrders.docs.filter((doc) => doc.data().estado === "abierta").length;
  const currentProtectedOpen = currentOrders.docs.filter((doc) => doc.data().estado === "abierta" && protectedNumbers.has(doc.id) && !orders.has(doc.id)).length;
  if (currentOpen >= 20 && orders.size < currentOpen / 2) throw new Error("El reporte tiene menos de la mitad de las OCs abiertas actuales.");
  const lineCount = [...linesByOrder.values()].reduce((sum, list) => sum + list.length, 0);
  const lineChanges = [...orders.keys()].filter((order) => {
    const next = linesByOrder.get(order);
    return next && JSON.stringify(next) !== JSON.stringify(byNumber.get(order)?.lineas || []);
  });
  const protectedUnresolved = [...protectedNumbers].filter((order) => !orders.has(order));
  const report = {
    files: files.map((file) => ({ name: path.basename(file), modified: fs.statSync(file).mtime.toISOString() })),
    sourceRows: { oc: oc.length, catalog: catalog.length },
    current: { suppliers: currentSuppliers.size, orders: currentOrders.size, open: currentOpen },
    incoming: { suppliers: suppliers.size, orders: orders.size, lines: lineCount },
    changes: { newOrders: newOrders.length, reopened: reopened.length, closing: closures.length, lineUpdates: lineChanges.length },
    newOrderNumbers: newOrders,
    reopenNumbers: reopened,
    closingNumbers: closures,
    protectedUnresolved,
    warnings: { missingCatalog: [...missingCatalog], missingCuit: [...missingCuit], skippedRow: skipped.row.size, skippedProduct: skipped.product.size, skippedNegative: skipped.negative.size },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;
  const reportAge = Date.now() - fs.statSync(files[0]).mtimeMs;
  if (reportAge > 4 * 60 * 60 * 1000 || reportAge < -5 * 60 * 1000) {
    throw new Error("El reporte de OCs tiene más de cuatro horas o una fecha incorrecta. Exportá uno nuevo de Summa.");
  }
  const local = path.resolve(__dirname, "../.local");
  fs.mkdirSync(local, { recursive: true });
  const backup = path.join(local, `summa-before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify({ suppliers: currentSuppliers.docs.map((doc) => ({ id: doc.id, data: doc.data() })), orders: currentOrders.docs.map((doc) => ({ id: doc.id, data: doc.data() })) }));
  console.log(`Respaldo local: ${backup}`);
  const now = new Date().toISOString();
  const writes = [];
  for (const row of suppliers.values()) {
    const data = { cuit: row.cuit, razon_social: row.razon_social, codigo_externo: row.codigo_externo, email: row.email, habilitado: true, updated_at: now };
    if (!data.email) delete data.email;
    writes.push({ ref: db.collection("proveedores").doc(row.cuit.replace(/\D/g, "")), data });
  }
  for (const row of orders.values()) {
    const data = { numero: row.numero, proveedor_cuit: row.proveedor_cuit, estado: "abierta", fecha: row.fecha || null, updated_at: now };
    if (linesByOrder.has(row.numero)) data.lineas = linesByOrder.get(row.numero);
    writes.push({ ref: db.collection("ordenes_compra").doc(row.numero), data });
  }
  for (const order of closures) writes.push({ ref: db.collection("ordenes_compra").doc(order), data: { estado: "cerrada", updated_at: now } });
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 400)) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
  }
  const verified = await db.collection("ordenes_compra").get();
  const verifiedOpen = verified.docs.filter((doc) => doc.data().estado === "abierta").length;
  if (verifiedOpen !== orders.size + currentProtectedOpen) throw new Error(`La verificación encontró ${verifiedOpen} OCs abiertas; se esperaban ${orders.size + currentProtectedOpen}.`);
  console.log(`Actualización aplicada: ${suppliers.size} proveedores, ${orders.size} OCs, ${lineCount} renglones, ${closures.length} cierres; ${verifiedOpen} OCs abiertas verificadas.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
