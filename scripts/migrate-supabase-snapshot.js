// One-time, idempotent migration. Reads the ignored .local snapshot, never commits it.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const admin = require("../api/node_modules/firebase-admin");
const { fechaHoraArgentina, remitoNormalizado } = require("../api/src/common");

const filename = path.resolve(__dirname, "../.local/supabase-snapshot.json");
const dryRun = process.argv.includes("--dry-run");
const accountFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
if (!dryRun && !accountFile) throw new Error("Configurá FIREBASE_SERVICE_ACCOUNT_FILE con la ruta del JSON privado.");
if (!dryRun) {
  const account = JSON.parse(fs.readFileSync(accountFile, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(account), projectId: "turnos-proveedores-gottert" });
}
const { tables } = JSON.parse(fs.readFileSync(filename, "utf8"));

const suppliersById = new Map(tables.proveedores.map((row) => [row.id, row]));
const ordersById = new Map(tables.ordenes_compra.map((row) => [row.id, row]));
const remitosByTurn = new Map(tables.remitos.map((row) => [row.turno_id, row]));
const linesByOrder = new Map();
const linesByRemito = new Map();
for (const line of tables.lineas_orden_compra) {
  const rows = linesByOrder.get(line.orden_compra_id) || [];
  rows.push(line);
  linesByOrder.set(line.orden_compra_id, rows);
}
for (const line of tables.lineas_remito) {
  const rows = linesByRemito.get(line.remito_id) || [];
  rows.push(line);
  linesByRemito.set(line.remito_id, rows);
}

const writes = [];
function put(collection, id, data) { writes.push({ collection, id, data }); }
for (const supplier of tables.proveedores) {
  put("proveedores", supplier.cuit.replace(/\D/g, ""), {
    ...supplier, source_id: supplier.id,
  });
}
for (const order of tables.ordenes_compra) {
  const supplier = suppliersById.get(order.proveedor_id);
  put("ordenes_compra", order.numero, {
    ...order,
    proveedor_cuit: supplier?.cuit || null,
    lineas: (linesByOrder.get(order.id) || []).sort((a, b) => a.renglon - b.renglon),
  });
}
let largest = 0;
for (const turn of tables.turnos) {
  const supplier = suppliersById.get(turn.proveedor_id);
  const order = ordersById.get(turn.orden_compra_id);
  const remito = remitosByTurn.get(turn.id);
  const local = fechaHoraArgentina(new Date(turn.inicio));
  const importedRemito = remito ? {
    numero: remito.numero,
    numero_normalizado: remitoNormalizado(remito.numero),
    mime_type: remito.mime_type,
    bytes: remito.bytes,
    sharepoint_item_id: null,
    legacy_storage_path: remito.storage_path,
    lineas_declaradas: remito.lineas_declaradas || [],
    lineas_legacy: (linesByRemito.get(remito.id) || []).sort((a, b) => a.renglon - b.renglon),
    motivo_revision: remito.motivo_revision || null,
  } : null;
  put("turnos", turn.id, {
    ...turn,
    orden_compra: order?.numero || null,
    proveedor_cuit: supplier?.cuit || null,
    proveedor_nombre: supplier?.razon_social || "Proveedor",
    fecha: local.fecha, hora: local.hora,
    inicio: new Date(turn.inicio).toISOString(),
    remito: importedRemito,
  });
  const sequence = Number(turn.codigo?.match(/\d+$/)?.[0] || 0);
  largest = Math.max(largest, sequence);
  if (["reservado", "retenido", "confirmado", "en_planta"].includes(turn.estado)) {
    put("slots", `${local.fecha}_${local.hora.replace(":", "")}`, {
      tipo: "turno", turno_id: turn.id, fecha: local.fecha, hora: local.hora,
    });
  }
  if (remito && supplier) {
    const key = crypto.createHash("sha256").update(`${supplier.cuit}|${remitoNormalizado(remito.numero)}`).digest("hex");
    put("remitoKeys", key, { turno_id: turn.id, proveedor_cuit: supplier.cuit, numero: remito.numero });
  }
}
for (const block of tables.bloqueos) {
  const local = fechaHoraArgentina(new Date(block.desde));
  put("slots", `${local.fecha}_${local.hora.replace(":", "")}`, {
    tipo: "bloqueo", fecha: local.fecha, hora: local.hora, motivo: block.motivo, created_at: block.created_at,
  });
}
const settings = tables.configuracion[0] || {};
put("configuracion", "principal", settings);
put("counters", "turnos", { next: largest + 1 });

async function main() {
  const unique = new Set();
  for (const row of writes) {
    const key = `${row.collection}/${row.id}`;
    if (unique.has(key)) throw new Error(`El histórico tiene un documento repetido: ${key}`);
    unique.add(key);
  }
  const summary = {
    proveedores: tables.proveedores.length, ordenes: tables.ordenes_compra.length,
    renglones: tables.lineas_orden_compra.length, turnos: tables.turnos.length,
    remitos: tables.remitos.length, documentos: writes.length,
  };
  if (dryRun) {
    console.log(JSON.stringify({ ...summary, dryRun: true }));
    return;
  }
  const db = admin.firestore();
  const existing = await db.collection("turnos").limit(1).get();
  if (!existing.empty && process.env.ALLOW_EXISTING_MIGRATION !== "yes") {
    throw new Error("Firebase ya tiene turnos. No sobreescribo datos sin ALLOW_EXISTING_MIGRATION=yes.");
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const row of writes.slice(i, i + 400)) {
      batch.set(db.collection(row.collection).doc(row.id), row.data);
    }
    await batch.commit();
  }
  console.log(JSON.stringify(summary));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
