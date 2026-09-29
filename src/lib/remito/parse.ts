export type RenglonDetectado = {
  descripcion: string;
  cantidad: string;
};

export type LecturaRemito = {
  numero: string | null;
  renglones: RenglonDetectado[];
  texto: string;
  metodo: "texto" | "ocr";
  paginas: number;
  incompleto: boolean;
  confianza: number;
};

function limpiarDescripcion(valor: string) {
  return valor.replace(/^[|—–.\s]+|[|—–.\s]+$/g, "").replace(/\s+/g, " ").trim();
}

export function analizarTextoRemito(texto: string) {
  const lineas = texto.split(/\r?\n/).map((linea) => linea.trim());
  const cabecera = lineas.slice(0, Math.min(lineas.length, 20)).join("\n");
  const coincidenciaNumero = cabecera.match(/remito\s*(?:n[°º*o.]?\s*)?[:#-]?\s*(\d{1,5}\s*[-–]\s*\d{4,9}|\d{4,9}(?!\d|\s*[-–]))/i);
  const numero = coincidenciaNumero ? coincidenciaNumero[1].replace(/\s*[-–]\s*/, "-") : null;
  const inicio = lineas.findIndex((linea) => /cantidad\s+descripci[oó]n/i.test(linea));
  const candidatas = inicio >= 0 ? lineas.slice(inicio + 1) : lineas;
  const renglones: RenglonDetectado[] = [];
  let lineasSinProducto = 0;

  for (const linea of candidatas) {
    if (/^(recibi\s*\(?mos|original\s+blanco|firma\s+aclaraci[oó]n|imprenta|cai\s*:)/i.test(linea)) break;
    const coincidencia = linea.match(/^[|—–\s.]*([0-9]{1,5}(?:[.,][0-9]{1,4})?)\s+(.{4,})$/);
    if (!coincidencia) {
      if (renglones.length > 0 && ++lineasSinProducto >= 2) break;
      continue;
    }
    const descripcion = limpiarDescripcion(coincidencia[2]);
    if (descripcion.length < 5 || !/[a-záéíóúñ]{3}/i.test(descripcion)) continue;
    if (/^(?:raz[oó]n social|direcci[oó]n|c[oó]digo postal|fecha|remito|cuit|p[aá]gina|tel[eé]fono)/i.test(descripcion)) continue;
    lineasSinProducto = 0;
    renglones.push({ cantidad: coincidencia[1].replace(",", "."), descripcion });
  }
  return { numero, renglones };
}

function palabras(valor: string) {
  return new Set(valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().match(/[A-Z0-9]+/g) ?? []);
}

export function sugerirCodigo(descripcion: string, productos: { codigo: string; descripcion: string | null }[]) {
  const origen = palabras(descripcion);
  if (origen.size === 0) return "";
  const candidatos = productos.map((producto) => {
    const destino = palabras(producto.descripcion ?? "");
    const comunes = [...origen].filter((palabra) => destino.has(palabra)).length;
    const similitud = comunes / Math.max(origen.size, destino.size, 1);
    return { codigo: producto.codigo, similitud };
  }).sort((a, b) => b.similitud - a.similitud);
  // Only a unique, near-exact description can be matched automatically.
  return candidatos[0]?.similitud >= 0.85 && (candidatos[0].similitud - (candidatos[1]?.similitud ?? 0)) >= 0.15
    ? candidatos[0].codigo
    : "";
}
