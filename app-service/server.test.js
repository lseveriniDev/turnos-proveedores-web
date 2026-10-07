/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createServer } = require("./server");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("serves exported pages and forwards API request bodies to the existing service", async (context) => {
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnos-app-service-"));
  fs.mkdirSync(path.join(staticDir, "panel"));
  fs.writeFileSync(path.join(staticDir, "index.html"), "Portal público");
  fs.writeFileSync(path.join(staticDir, "panel", "index.html"), "Agenda trasladada");
  context.after(() => fs.rmSync(staticDir, { recursive: true, force: true }));

  const upstream = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ route: request.url, body }));
  });
  const upstreamUrl = await listen(upstream);
  context.after(() => upstream.close());

  const app = createServer({ staticDir, upstream: upstreamUrl });
  const base = await listen(app);
  context.after(() => app.close());

  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.equal(await home.text(), "Portal público");

  const panel = await fetch(`${base}/panel/`);
  assert.equal(panel.status, 200);
  assert.equal(await panel.text(), "Agenda trasladada");

  const api = await fetch(`${base}/api/book?source=test`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"turno":1}',
  });
  assert.equal(api.status, 201);
  assert.deepEqual(await api.json(), { route: "/api/book?source=test", body: '{"turno":1}' });

  const form = new FormData();
  form.set("datos", '{"ordenCompra":"9032"}');
  form.set("archivo", new Blob(["remito de prueba"], { type: "application/pdf" }), "remito.pdf");
  const upload = await fetch(`${base}/api/book`, { method: "POST", body: form });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  assert.equal(uploaded.route, "/api/book");
  assert.match(uploaded.body, /remito de prueba/);
  assert.match(uploaded.body, /ordenCompra/);
});
