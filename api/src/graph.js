const { fail } = require("./common");

let tokenCache = null;

async function accessToken() {
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET } = process.env;
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    fail("El almacenamiento de remitos todavía no está configurado.", 503);
  }
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(GRAPH_TENANT_ID)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GRAPH_CLIENT_ID,
      client_secret: GRAPH_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!response.ok) throw new Error("No pudimos conectar con SharePoint.");
  const data = await response.json();
  tokenCache = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

function driveSettings() {
  const { SHAREPOINT_DRIVE_ID, SHAREPOINT_FOLDER_ID } = process.env;
  if (!SHAREPOINT_DRIVE_ID || !SHAREPOINT_FOLDER_ID) {
    fail("Falta configurar la carpeta de remitos en SharePoint.", 503);
  }
  return { driveId: SHAREPOINT_DRIVE_ID, folderId: SHAREPOINT_FOLDER_ID };
}

async function graphRequest(path, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(options.headers || {}) },
    redirect: "follow",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`SharePoint respondió ${response.status}: ${detail.slice(0, 150)}`);
  }
  return response;
}

function encodePath(value) {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

function safeName(value, max = 90) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|#%]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
}

function folderNameForOrder(proveedor, ordenCompra) {
  const digits = String(ordenCompra).replace(/\D/g, "");
  const suffix = digits.slice(-4) || safeName(ordenCompra, 12);
  return `${safeName(proveedor, 88 - suffix.length)} - ${suffix}`;
}

async function ensureFolder(driveId, parentId, name) {
  const body = JSON.stringify({
    name, folder: {}, "@microsoft.graph.conflictBehavior": "fail",
  });
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children`,
    { method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" }, body }
  );
  if (response.ok) return (await response.json()).id;
  if (response.status !== 409) throw new Error("No pudimos crear una carpeta en SharePoint.");
  const existing = await graphRequest(
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}:/${encodePath(name)}`
  );
  const item = await existing.json();
  if (!item.folder) throw new Error("Ya existe un archivo con el nombre de la carpeta.");
  return item.id;
}

async function uploadRemito(buffer, filename, mimeType, proveedor, ordenCompra) {
  const { driveId, folderId } = driveSettings();
  const orderFolder = await ensureFolder(driveId, folderId, folderNameForOrder(proveedor, ordenCompra));
  const response = await graphRequest(
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(orderFolder)}:/${encodePath(filename)}:/content`,
    { method: "PUT", headers: { "Content-Type": mimeType }, body: buffer }
  );
  const item = await response.json();
  if (!item.id) throw new Error("SharePoint no confirmó el archivo.");
  return { itemId: item.id, webUrl: item.webUrl || null };
}

async function deleteRemito(itemId) {
  const { driveId } = driveSettings();
  await graphRequest(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

module.exports = { uploadRemito, deleteRemito, folderNameForOrder };
