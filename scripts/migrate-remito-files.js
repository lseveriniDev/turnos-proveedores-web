const fs = require("node:fs");
const path = require("node:path");
const { db, remitoNormalizado } = require("../api/src/common");
const { uploadRemito } = require("../api/src/graph");

const root = path.resolve(__dirname, "../.local/remitos");
const snapshot = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../.local/supabase-snapshot.json"), "utf8"));
const dryRun = process.argv.includes("--dry-run");
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;

const suppliers = new Map(snapshot.tables.proveedores.map((row) => [row.id, row]));
const orders = new Map(snapshot.tables.ordenes_compra.map((row) => [row.id, row]));
const remitos = new Map(snapshot.tables.remitos.map((row) => [row.turno_id, row]));
const files = fs.existsSync(root) ? fs.readdirSync(root) : [];
const selected = snapshot.tables.turnos.flatMap((turn) => {
  const prefix = `${turn.codigo}.`;
  const matches = files.filter((file) => file.startsWith(prefix));
  if (matches.length > 1) throw new Error(`Hay más de un archivo local para ${turn.codigo}.`);
  const remito = remitos.get(turn.id);
  if (!matches.length || !remito) return [];
  const supplier = suppliers.get(turn.proveedor_id);
  const order = orders.get(turn.orden_compra_id);
  if (!supplier || !order) throw new Error(`Falta proveedor u OC de ${turn.codigo}.`);
  return [{ turn, remito, supplier, order, file: matches[0] }];
});

async function main() {
  console.log(JSON.stringify({ archivosLocales: selected.map(({ turn }) => turn.codigo), dryRun }));
  if (dryRun) return;
  if (!serviceAccount) throw new Error("Configurá FIREBASE_SERVICE_ACCOUNT_FILE con la ruta del JSON privado.");
  process.env.FIREBASE_SERVICE_ACCOUNT_B64 = fs.readFileSync(serviceAccount).toString("base64");
  const database = db();
  for (const { turn, remito, supplier, order, file } of selected) {
    const ref = database.collection("turnos").doc(turn.id);
    const existing = await ref.get();
    if (!existing.exists) throw new Error(`Todavía no se migró ${turn.codigo} a Firestore.`);
    if (existing.data()?.remito?.sharepoint_item_id) continue;
    const ext = path.extname(file).toLowerCase();
    const date = existing.data().fecha;
    const number = remitoNormalizado(remito.numero).replace(/[^A-Z0-9-]/gi, "-");
    const name = `${number}_${date}_${turn.codigo}${ext}`;
    const saved = await uploadRemito(
      fs.readFileSync(path.join(root, file)), name, remito.mime_type || "application/octet-stream",
      supplier.razon_social, supplier.cuit, order.numero,
    );
    await ref.update({
      "remito.sharepoint_item_id": saved.itemId,
      "remito.sharepoint_web_url": saved.webUrl,
    });
    console.log(`${turn.codigo}: copiado a SharePoint`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
