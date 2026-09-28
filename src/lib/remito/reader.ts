import { analizarTextoRemito, LecturaRemito } from "./parse";

const MAX_PAGINAS = 3;

async function reconocerImagen(imagen: Blob | HTMLCanvasElement, progreso: (mensaje: string) => void) {
  const { createWorker } = await import("tesseract.js");
  progreso("Preparando lectura de la imagen…");
  const worker = await createWorker(["spa", "eng"]);
  try {
    const resultado = await worker.recognize(imagen);
    return resultado.data.text;
  } finally {
    await worker.terminate();
  }
}

export async function leerRemito(archivo: Blob, progreso: (mensaje: string) => void): Promise<LecturaRemito> {
  if (!archivo.type.includes("pdf")) {
    progreso("Leyendo la foto del remito…");
    const texto = await reconocerImagen(archivo, progreso);
    return { ...analizarTextoRemito(texto), texto, metodo: "ocr", paginas: 1, incompleto: false };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const carga = pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) });
  const documento = await carga.promise;
  const totalPaginas = documento.numPages;
  const paginas = Math.min(totalPaginas, MAX_PAGINAS);
  const textos: string[] = [];
  let usoOcr = false;

  try {
    for (let indice = 1; indice <= paginas; indice += 1) {
      progreso(`Leyendo página ${indice} de ${paginas}…`);
      const pagina = await documento.getPage(indice);
      const contenido = await pagina.getTextContent();
      let texto = contenido.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("");
      if (texto.trim().length < 35 || analizarTextoRemito(texto).renglones.length === 0) {
        usoOcr = true;
        progreso(`Reconociendo imagen de la página ${indice} de ${paginas}…`);
        const viewport = pagina.getViewport({ scale: 2.5 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const contexto = canvas.getContext("2d");
        if (!contexto) throw new Error("No se pudo preparar la imagen del PDF.");
        await pagina.render({ canvas, canvasContext: contexto, viewport }).promise;
        texto = await reconocerImagen(canvas, progreso);
        canvas.width = 0;
        canvas.height = 0;
      }
      textos.push(texto);
      pagina.cleanup();
    }
  } finally {
    await carga.destroy();
  }
  const texto = textos.join("\n");
  return { ...analizarTextoRemito(texto), texto, metodo: usoOcr ? "ocr" : "texto", paginas, incompleto: totalPaginas > MAX_PAGINAS };
}
