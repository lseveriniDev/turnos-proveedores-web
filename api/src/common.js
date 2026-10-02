const crypto = require("node:crypto");
const admin = require("firebase-admin");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "turnos-proveedores-gottert";
const TIME_ZONE = "America/Argentina/Buenos_Aires";
const HORARIOS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
const ESTADOS_ACTIVOS = new Set(["reservado", "retenido", "confirmado", "en_planta"]);
const TIPOS_ARCHIVO = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);

function db() {
  if (!admin.apps.length) {
    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
    if (encoded) {
      const account = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      admin.initializeApp({ credential: admin.credential.cert(account), projectId: PROJECT_ID });
    } else if (process.env.FIRESTORE_EMULATOR_HOST) {
      admin.initializeApp({ projectId: PROJECT_ID });
    } else {
      throw new Error("Falta configurar la cuenta de servicio de Firebase.");
    }
  }
  return admin.firestore();
}

function json(body, status = 200) {
  return { status, jsonBody: body, headers: { "Cache-Control": "no-store" } };
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cuitNormalizado(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && !/^0+$/.test(digits)
    ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
    : null;
}

function remitoNormalizado(value) {
  const parts = String(value || "").toUpperCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").match(/[A-Z]+|\d+/g) || [];
  return parts.map((part) => /^\d+$/.test(part) ? part.replace(/^0+(?=\d)/, "") : part).join("-");
}

function fechaHoraArgentina(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { fecha: `${get("year")}-${get("month")}-${get("day")}`, hora: `${get("hour")}:${get("minute")}` };
}

function fechaLocalHoy() {
  return fechaHoraArgentina(new Date()).fecha;
}

function inicioUtc(fecha, hora) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !HORARIOS.includes(hora)) fail("Elegí un día y horario válidos.");
  const date = new Date(`${fecha}T${hora}:00-03:00`);
  if (Number.isNaN(date.getTime()) || fechaHoraArgentina(date).fecha !== fecha || fechaHoraArgentina(date).hora !== hora) {
    fail("Elegí un día y horario válidos.");
  }
  return date;
}

function diaHabil(fecha) {
  const d = new Date(`${fecha}T12:00:00-03:00`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
}

function validarFechaHora(fecha, hora, anticipacionMinutos = 120) {
  if (!diaHabil(fecha) || fecha < fechaLocalHoy()) fail("Solo se pueden reservar días hábiles futuros.");
  const date = inicioUtc(fecha, hora);
  if (date.getTime() <= Date.now() + anticipacionMinutos * 60_000) fail("Reservá con la anticipación mínima requerida.");
  return date;
}

function escaparHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function similitudDescripcion(a, b) {
  const words = (value) => new Set(String(value || "").toUpperCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").match(/[A-Z0-9]{2,}/g) || []);
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  return [...x].filter((word) => y.has(word)).length / Math.max(x.size, y.size);
}

function evaluarLineas(lineasOc, lineasDeclaradas, lecturaIncompleta) {
  if (!Array.isArray(lineasDeclaradas) || lineasDeclaradas.length > 100) fail("Revisá los renglones del remito.");
  const byNumber = new Map((lineasOc || []).map((line) => [Number(line.renglon), line]));
  const quantities = new Map();
  for (const line of lineasDeclaradas) {
    const row = Number(line.renglonOc);
    const quantity = Number(line.cantidad);
    if (!Number.isInteger(row) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000 || !byNumber.has(row)) {
      fail("Un producto del remito no figura en la OC o tiene una cantidad inválida.");
    }
    quantities.set(row, (quantities.get(row) || 0) + quantity);
  }
  const exceeds = [...quantities].some(([row, quantity]) => {
    const line = byNumber.get(row);
    return Number(line.cantidad_recibida) + quantity > Number(line.cantidad_ordenada) * 1.1 + 0.000001;
  });
  if (exceeds) fail("El remito supera el límite permitido de la OC. Consultá con recepción.", 422);
  const doubtful = lineasDeclaradas.filter((line) =>
    similitudDescripcion(line.descripcion, byNumber.get(Number(line.renglonOc))?.descripcion_producto) < 0.85
  ).map((line) => line.renglonOc);
  const reasons = [
    doubtful.length ? `La descripción de los renglones ${[...new Set(doubtful)].join(", ")} no coincide claramente con la OC.` : null,
    lecturaIncompleta || !lineasDeclaradas.length || !lineasOc.length ? "No se pudo verificar automáticamente todo el remito." : null,
  ].filter(Boolean);
  return reasons.join(" ") || null;
}

async function requireAdmin(request) {
  const header = request.headers.get("x-ms-client-principal");
  if (!header) fail("Iniciá sesión con tu cuenta de Microsoft para acceder al panel.", 401);
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch { fail("La sesión no es válida.", 401); }
  if (!decoded || typeof decoded !== "object" || !Array.isArray(decoded.userRoles)) {
    fail("La sesión no es válida.", 401);
  }
  if (decoded.identityProvider !== "aad" || !decoded.userRoles?.includes("authenticated")) {
    fail("Iniciá sesión con tu cuenta de Microsoft para acceder al panel.", 401);
  }
  const allowed = new Set((process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (typeof decoded.userDetails !== "string" || !allowed.has(decoded.userDetails.trim().toLowerCase())) fail("Tu cuenta no tiene acceso al panel.", 403);
  return decoded;
}

function newId() { return crypto.randomUUID(); }

module.exports = {
  PROJECT_ID, TIME_ZONE, HORARIOS, ESTADOS_ACTIVOS, TIPOS_ARCHIVO, db, json, fail, cuitNormalizado,
  remitoNormalizado, fechaHoraArgentina, fechaLocalHoy, inicioUtc, diaHabil, validarFechaHora,
  escaparHtml, similitudDescripcion, evaluarLineas, requireAdmin, newId,
};
