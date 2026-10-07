/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const defaultUpstream = "https://green-forest-0f3977b0f.2.azurestaticapps.net";
const contentTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function createServer({ staticDir = path.resolve(__dirname, "../out"), upstream = defaultUpstream } = {}) {
  const root = path.resolve(staticDir);
  const upstreamOrigin = new URL(upstream);
  const requestUpstream = upstreamOrigin.protocol === "http:" ? http : https;

  return http.createServer((request, response) => {
    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      const destination = new URL(url.pathname + url.search, upstreamOrigin);
      const headers = {};
      for (const name of ["accept", "content-type", "content-length", "user-agent"]) {
        if (request.headers[name]) headers[name] = request.headers[name];
      }
      const proxy = requestUpstream.request(destination, { method: request.method, headers }, (upstreamResponse) => {
        const responseHeaders = {};
        for (const name of ["content-type", "cache-control", "x-content-type-options"]) {
          if (upstreamResponse.headers[name]) responseHeaders[name] = upstreamResponse.headers[name];
        }
        response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
        upstreamResponse.pipe(response);
      });
      proxy.setTimeout(120_000, () => proxy.destroy(new Error("La API tardó demasiado en responder.")));
      proxy.on("error", (error) => {
        console.error("Error al consultar la API de turnos:", error.message);
        if (!response.headersSent) {
          response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "No pudimos conectar con el servicio de turnos." }));
        } else {
          response.destroy(error);
        }
      });
      request.pipe(proxy);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (pathname.includes("\0")) {
      response.writeHead(400).end();
      return;
    }
    const filePath = path.resolve(root, "." + pathname);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    fs.stat(filePath, (error, stats) => {
      const target = !error && stats.isDirectory() ? path.join(filePath, "index.html") : filePath;
      fs.stat(target, (targetError, targetStats) => {
        if (targetError || !targetStats.isFile()) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          "Content-Type": contentTypes[path.extname(target).toLowerCase()] || "application/octet-stream",
          "Content-Length": targetStats.size,
          "Cache-Control": pathname.startsWith("/_next/static/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        });
        if (request.method === "HEAD") response.end();
        else fs.createReadStream(target).pipe(response);
      });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createServer({
    staticDir: process.env.STATIC_DIR || path.resolve(__dirname, "../out"),
    upstream: process.env.UPSTREAM_API_ORIGIN || defaultUpstream,
  }).listen(port, "0.0.0.0", () => console.log(`Portal de proveedores escuchando en ${port}`));
}

module.exports = { createServer };
