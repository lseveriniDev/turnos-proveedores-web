const test = require("node:test");
const assert = require("node:assert/strict");
const { folderNameForOrder } = require("../src/graph");

test("la carpeta del remito identifica al proveedor y los cuatro dígitos finales de la OC", () => {
  assert.equal(folderNameForOrder("GRANT", "OC-00009032"), "GRANT - 9032");
  assert.equal(folderNameForOrder("ACEROS / SUR S.A.", "OC-00009613"), "ACEROS - SUR S.A. - 9613");
});
