const test = require("node:test");
const assert = require("node:assert/strict");
const { cuitNormalizado, remitoNormalizado, evaluarLineas, validarFechaHora } = require("../src/common");

const oc = [{
  renglon: 1,
  descripcion_producto: "PANEL DE SEGURIDAD",
  cantidad_ordenada: 100,
  cantidad_recibida: 40,
}];

test("el mismo número de remito conserva una clave comparable", () => {
  assert.equal(remitoNormalizado("00003-00021008"), remitoNormalizado("3-21008"));
  assert.notEqual(remitoNormalizado("PRUEBA-CODEX-20260928-B"), remitoNormalizado("PRUEBA-CODEX-20260928-C"));
  assert.equal(cuitNormalizado("30-70901842-2"), "30-70901842-2");
});

test("acepta entregas parciales y el límite inclusivo de 110 % acumulado", () => {
  assert.equal(evaluarLineas(oc, [{ renglonOc: 1, cantidad: 20, descripcion: "PANEL DE SEGURIDAD" }], false), null);
  assert.equal(evaluarLineas(oc, [{ renglonOc: 1, cantidad: 70, descripcion: "PANEL DE SEGURIDAD" }], false), null);
  assert.throws(() => evaluarLineas(oc, [{ renglonOc: 1, cantidad: 70.01, descripcion: "PANEL DE SEGURIDAD" }], false), /supera/);
});

test("una lectura dudosa queda para revisión interna", () => {
  assert.match(evaluarLineas(oc, [], true), /verificar/);
});

test("impide fechas pasadas o días no hábiles", () => {
  assert.throws(() => validarFechaHora("2026-09-01", "09:00"), /hábiles/);
  assert.throws(() => validarFechaHora("2026-10-03", "09:00"), /hábiles/);
});
