import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const nodeBin = join(root, "node_modules", "node", "bin", process.platform === "win32" ? "node.exe" : "node");
const swaCli = join(root, "node_modules", "@azure", "static-web-apps-cli", "dist", "cli", "bin.js");
const apiDependencies = join(root, "api", "node_modules", "@azure", "functions", "package.json");
const localSettings = join(root, "api", "local.settings.json");

if (!existsSync(nodeBin) || !existsSync(swaCli) || !existsSync(apiDependencies)) {
  process.stderr.write("Faltan dependencias locales. Ejecutá npm ci y npm ci --prefix api.\n");
  process.exit(1);
}
if (!existsSync(localSettings)) {
  process.stderr.write("Falta api/local.settings.json. Copiá api/local.settings.example.json y completá la credencial de Firebase para validar CUIT.\n");
  process.exit(1);
}

try {
  const values = JSON.parse(readFileSync(localSettings, "utf8")).Values ?? {};
  if (!values.FIREBASE_SERVICE_ACCOUNT_B64 && !values.FIRESTORE_EMULATOR_HOST) {
    process.stderr.write("Aviso: completá FIREBASE_SERVICE_ACCOUNT_B64 en api/local.settings.json para validar CUIT reales.\n");
  }
} catch {
  process.stderr.write("api/local.settings.json no es JSON válido. Revisá su formato.\n");
  process.exit(1);
}

const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
env[pathKey] = `${dirname(nodeBin)}${delimiter}${env[pathKey] ?? ""}`;

const child = spawn(nodeBin, [
  swaCli, "start", "http://localhost:3000",
  "--api-location", "./api",
  "--swa-config-location", "./public",
  "--run", "npm run dev:frontend",
], { cwd: root, env, stdio: "inherit" });

child.on("error", (error) => {
  process.stderr.write(`No pudimos iniciar el entorno local: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
