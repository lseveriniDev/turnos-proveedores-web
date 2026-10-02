"use client";

import { ChangeEvent, useEffect, useState } from "react";
import readXlsxFile from "read-excel-file/browser";

import { obtenerSupabase } from "@/lib/supabase/client";

type FilaImportacion = {
  cuit: string;
  razon_social: string;
  email: string | null;
  codigo_externo: string | null;
  orden_compra: string;
  fecha: string | null;
};

type ProveedorImportacion = Pick<FilaImportacion, "cuit" | "razon_social" | "email" | "codigo_externo">;
type OrdenImportacion = Pick<FilaImportacion, "orden_compra" | "cuit" | "fecha">;
type LineaImportacion = {
  orden_compra: string;
  renglon: number;
  producto_codigo: string;
  descripcion_producto: string | null;
  unidad_medida: string | null;
  moneda: string | null;
  cantidad_ordenada: number;
  cantidad_recibida: number;
  cantidad_pendiente: number;
  precio_unitario: number | null;
};
type FuenteImportacion = "csv" | "summa";
type FilaExcel = Record<string, unknown>;

type PropuestaImportacion = {
  fuente: FuenteImportacion;
  proveedores: ProveedorImportacion[];
  ordenes: OrdenImportacion[];
  lineas: LineaImportacion[];
  numerosProtegidos: Set<string>;
  advertencias: string[];
};

type VistaPrevia = PropuestaImportacion & {
  nuevas: number;
  actualizadas: number;
  reabiertas: number;
  aCerrar: string[];
};

type OrdenActual = { numero: string; estado: string };
type ProveedorActual = { cuit: string; email: string | null; codigo_externo: string | null };

const columnasOc = ["Segmento", "Renglon_OC", "Proveed_Id", "RazonSocial", "TipoPermi_Id", "Estado_Id", "Cantidad", "Cantidad_Recibida", "CantidadPendiente", "Moneda_Id", "Producto_id", "DescripcionProducto", "Medida_Id", "Precio", "Fecha"];
const columnasCatalogo = ["Proveed_Id", "RazonSocial", "Cuit", "EMail"];
const VIGENCIA_REPORTE_MS = 4 * 60 * 60 * 1000;

function exigirReporteReciente(archivo: File) {
  const antiguedad = Date.now() - archivo.lastModified;
  if (antiguedad > VIGENCIA_REPORTE_MS || antiguedad < -5 * 60 * 1000) {
    throw new Error("El reporte de OCs tiene más de cuatro horas o una fecha incorrecta. Exportá uno nuevo de Summa antes de actualizar.");
  }
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return "";
    return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, "0")}-${String(valor.getDate()).padStart(2, "0")}`;
  }
  return String(valor).trim();
}

function fechaIso(valor: unknown): string | null {
  const fecha = texto(valor);
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
}

function numero(valor: unknown): number {
  if (typeof valor === "number") return valor;
  const resultado = Number(texto(valor).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(resultado) ? resultado : 0;
}

function normalizarCuit(valor: string): string {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length !== 11 || /^0+$/.test(digitos)) return "";
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
}

function partirLinea(linea: string, separador: string): string[] {
  const valores: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let indice = 0; indice < linea.length; indice += 1) {
    const caracter = linea[indice];
    if (caracter === '"') {
      if (entreComillas && linea[indice + 1] === '"') {
        actual += '"';
        indice += 1;
      } else {
        entreComillas = !entreComillas;
      }
    } else if (caracter === separador && !entreComillas) {
      valores.push(actual.trim());
      actual = "";
    } else {
      actual += caracter;
    }
  }
  valores.push(actual.trim());
  return valores;
}

function clave(valor: string) {
  return valor.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
}

function valorCsv(celdas: string[], encabezados: string[], nombres: string[]): string {
  const indice = encabezados.findIndex((encabezado) => nombres.includes(encabezado));
  return indice >= 0 ? (celdas[indice] ?? "").trim() : "";
}

function leerCsv(contenido: string): FilaImportacion[] {
  const lineas = contenido.replace(/^\uFEFF/, "").split(/\r?\n/).filter((linea) => linea.trim());
  if (lineas.length < 2) throw new Error("El CSV no tiene filas para importar.");
  const separador = lineas[0].includes(";") ? ";" : ",";
  const encabezados = partirLinea(lineas[0], separador).map(clave);
  if (!encabezados.includes("cuit") || !encabezados.includes("razon_social")) {
    throw new Error("El CSV necesita las columnas cuit y razon_social.");
  }
  return lineas.slice(1).map((linea, indice) => {
    const celdas = partirLinea(linea, separador);
    const cuit = normalizarCuit(valorCsv(celdas, encabezados, ["cuit", "cuit_proveedor"]));
    const razon_social = valorCsv(celdas, encabezados, ["razon_social", "razon", "proveedor"]);
    if (!cuit || !razon_social) throw new Error(`Revisá la fila ${indice + 2}: falta CUIT o razón social.`);
    return {
      cuit,
      razon_social,
      email: valorCsv(celdas, encabezados, ["email", "correo"]) || null,
      codigo_externo: valorCsv(celdas, encabezados, ["codigo_externo", "codigo_proveedor", "proveed_id", "codigo_summa"]) || null,
      orden_compra: valorCsv(celdas, encabezados, ["orden_compra", "oc", "numero_oc"]),
      fecha: null,
    };
  });
}

async function leerPlanilla(archivo: File): Promise<FilaExcel[]> {
  const planillas = await readXlsxFile(archivo);
  const filasCrudas = planillas[0]?.data ?? [];
  if (filasCrudas.length < 2) throw new Error(`La planilla ${archivo.name} no tiene filas para procesar.`);
  const encabezados = filasCrudas[0].map(texto);
  if (encabezados.some((encabezado) => !encabezado)) throw new Error(`La primera fila de ${archivo.name} debe contener los encabezados.`);
  return filasCrudas.slice(1).map((celdas) => Object.fromEntries(encabezados.map((encabezado, indice) => [encabezado, celdas[indice]])));
}

function exigirColumnas(filas: FilaExcel[], esperadas: string[], nombre: string) {
  const columnas = new Set(Object.keys(filas[0] ?? {}));
  const faltantes = esperadas.filter((columna) => !columnas.has(columna));
  if (faltantes.length) throw new Error(`${nombre} no coincide con el formato de Summa. Faltan: ${faltantes.join(", ")}.`);
}

function agruparImportacion(filas: FilaImportacion[], fuente: FuenteImportacion, advertencias: string[] = [], numerosProtegidos = new Set<string>(), lineas: LineaImportacion[] = []): PropuestaImportacion {
  const proveedoresPorCuit = new Map<string, ProveedorImportacion>();
  const ordenesPorNumero = new Map<string, OrdenImportacion>();

  for (const fila of filas) {
    if (!fila.cuit || !fila.razon_social || !fila.orden_compra) continue;
    const proveedorExistente = proveedoresPorCuit.get(fila.cuit);
    proveedoresPorCuit.set(fila.cuit, {
      cuit: fila.cuit,
      razon_social: fila.razon_social,
      email: fila.email || proveedorExistente?.email || null,
      codigo_externo: fila.codigo_externo || proveedorExistente?.codigo_externo || null,
    });
    const ordenExistente = ordenesPorNumero.get(fila.orden_compra);
    if (ordenExistente && ordenExistente.cuit !== fila.cuit) {
      throw new Error(`La OC ${fila.orden_compra} aparece asociada a más de un proveedor.`);
    }
    ordenesPorNumero.set(fila.orden_compra, {
      orden_compra: fila.orden_compra,
      cuit: fila.cuit,
      fecha: ordenExistente?.fecha || fila.fecha,
    });
  }

  if (!ordenesPorNumero.size) throw new Error("No encontramos OCs válidas para actualizar. Revisá que haya CUIT, razón social y número de OC.");
  return { fuente, proveedores: [...proveedoresPorCuit.values()], ordenes: [...ordenesPorNumero.values()], lineas, numerosProtegidos, advertencias };
}

async function prepararReporteSumma(archivoOc: File, archivoCatalogo: File): Promise<PropuestaImportacion> {
  const [oc, catalogo] = await Promise.all([leerPlanilla(archivoOc), leerPlanilla(archivoCatalogo)]);
  exigirColumnas(oc, columnasOc, "El reporte de OCs");
  exigirColumnas(catalogo, columnasCatalogo, "El catálogo de proveedores");

  const catalogoPorCodigo = new Map(catalogo.map((fila) => [texto(fila.Proveed_Id), fila]));
  const candidatas = new Map<string, { codigoProveedor: string; razonSocial: string; fecha: string | null; tienePendiente: boolean }>();

  for (const fila of oc) {
    if (texto(fila.Estado_Id).toUpperCase() !== "A" || texto(fila.TipoPermi_Id).toUpperCase() === "NPI") continue;
    const ordenCompra = texto(fila.Segmento);
    const codigoProveedor = texto(fila.Proveed_Id);
    if (!ordenCompra || !codigoProveedor) continue;
    const existente = candidatas.get(ordenCompra);
    if (existente && existente.codigoProveedor !== codigoProveedor) {
      throw new Error(`La OC ${ordenCompra} aparece asociada a más de un proveedor en Summa.`);
    }
    candidatas.set(ordenCompra, {
      codigoProveedor,
      razonSocial: texto(fila.RazonSocial),
      fecha: existente?.fecha || fechaIso(fila.Fecha),
      tienePendiente: Boolean(existente?.tienePendiente) || numero(fila.CantidadPendiente) > 0,
    });
  }

  const filas: FilaImportacion[] = [];
  const numerosProtegidos = new Set<string>();
  const sinCatalogo = new Set<string>();
  const sinCuit = new Set<string>();
  for (const [ordenCompra, candidata] of candidatas) {
    if (!candidata.tienePendiente) continue;
    numerosProtegidos.add(ordenCompra);
    const proveedor = catalogoPorCodigo.get(candidata.codigoProveedor);
    if (!proveedor) {
      sinCatalogo.add(candidata.codigoProveedor);
      continue;
    }
    const cuit = normalizarCuit(texto(proveedor.Cuit));
    if (!cuit) {
      sinCuit.add(candidata.codigoProveedor);
      continue;
    }
    filas.push({
      cuit,
      razon_social: texto(proveedor.RazonSocial) || candidata.razonSocial,
      email: texto(proveedor.EMail) || null,
      codigo_externo: candidata.codigoProveedor,
      orden_compra: ordenCompra,
      fecha: candidata.fecha,
    });
  }

  const cuitPorOrden = new Map(filas.map((fila) => [fila.orden_compra, fila.cuit]));
  const lineas: LineaImportacion[] = [];
  const clavesLinea = new Set<string>();
  const sinRenglon = new Set<string>();
  const sinProducto = new Set<string>();
  const pendienteNegativo = new Set<string>();
  for (const fila of oc) {
    if (texto(fila.Estado_Id).toUpperCase() !== "A" || texto(fila.TipoPermi_Id).toUpperCase() === "NPI") continue;
    const ordenCompra = texto(fila.Segmento);
    if (!cuitPorOrden.has(ordenCompra)) continue;
    const renglon = Math.trunc(numero(fila.Renglon_OC));
    const producto = texto(fila.Producto_id);
    if (!Number.isInteger(renglon) || renglon < 1) {
      sinRenglon.add(ordenCompra);
      continue;
    }
    if (!producto) {
      sinProducto.add(ordenCompra);
      continue;
    }
    const cantidadPendiente = numero(fila.CantidadPendiente);
    if (cantidadPendiente < 0) {
      pendienteNegativo.add(`${ordenCompra} / renglón ${renglon}`);
      continue;
    }
    const claveLinea = `${ordenCompra}::${renglon}`;
    if (clavesLinea.has(claveLinea)) throw new Error(`La OC ${ordenCompra} repite el renglón ${renglon} en el reporte de Summa.`);
    clavesLinea.add(claveLinea);
    const precio = texto(fila.Precio);
    lineas.push({
      orden_compra: ordenCompra,
      renglon,
      producto_codigo: producto,
      descripcion_producto: texto(fila.DescripcionProducto) || null,
      unidad_medida: texto(fila.Medida_Id) || null,
      moneda: texto(fila.Moneda_Id) || null,
      cantidad_ordenada: numero(fila.Cantidad),
      cantidad_recibida: numero(fila.Cantidad_Recibida),
      cantidad_pendiente: cantidadPendiente,
      precio_unitario: precio ? numero(fila.Precio) : null,
    });
  }

  const advertencias: string[] = [];
  if (sinCatalogo.size) advertencias.push(`${sinCatalogo.size} proveedor(es) del reporte no figura(n) en el catálogo: ${[...sinCatalogo].join(", ")}. Sus OCs quedan protegidas y no se cierran.`);
  if (sinCuit.size) advertencias.push(`${sinCuit.size} proveedor(es) del catálogo no tiene(n) un CUIT válido. Sus OCs quedan protegidas y no se cargan.`);
  if (sinRenglon.size) advertencias.push(`${sinRenglon.size} OC(s) no tienen un renglón válido para el control detallado. Sus cabeceras se cargan igual.`);
  if (sinProducto.size) advertencias.push(`${sinProducto.size} OC(s) tienen renglones sin producto. Esos renglones no se incluirán en el control detallado.`);
  if (pendienteNegativo.size) advertencias.push(`${pendienteNegativo.size} renglón(es) tienen saldo pendiente negativo en Summa (ya superaron lo pedido). Se excluyen del control detallado.`);
  return agruparImportacion(filas, "summa", advertencias, numerosProtegidos, lineas);
}

async function crearVistaPrevia(propuesta: PropuestaImportacion): Promise<VistaPrevia> {
  const supabase = obtenerSupabase();
  if (!supabase) throw new Error("No encontramos la conexión a la base de datos.");
  const { data, error } = await supabase.from("ordenes_compra").select("numero,estado").range(0, 4999);
  if (error) throw new Error("No pudimos consultar las OCs actuales. Verificá tu acceso al panel.");
  const actuales = (data ?? []) as OrdenActual[];
  const actualPorNumero = new Map(actuales.map((orden) => [orden.numero.trim(), orden]));
  let nuevas = 0;
  let actualizadas = 0;
  let reabiertas = 0;
  for (const orden of propuesta.ordenes) {
    const actual = actualPorNumero.get(orden.orden_compra);
    if (!actual) nuevas += 1;
    else if (actual.estado === "cerrada") reabiertas += 1;
    else actualizadas += 1;
  }
  const entrantes = new Set(propuesta.ordenes.map((orden) => orden.orden_compra));
  const aCerrar = propuesta.fuente === "summa"
    ? actuales.filter((orden) => orden.estado === "abierta" && !entrantes.has(orden.numero) && !propuesta.numerosProtegidos.has(orden.numero)).map((orden) => orden.numero)
    : [];
  const advertencias = [...propuesta.advertencias];
  const abiertas = actuales.filter((orden) => orden.estado === "abierta").length;
  if (propuesta.fuente === "summa" && abiertas >= 20 && propuesta.ordenes.length < abiertas / 2) {
    advertencias.push("El reporte tiene menos de la mitad de las OCs abiertas actuales. Confirmá que exportaste el reporte completo antes de aplicarlo.");
  }
  return { ...propuesta, nuevas, actualizadas, reabiertas, aCerrar, advertencias };
}

function crearVistaPreviaDemo(propuesta: PropuestaImportacion): VistaPrevia {
  return { ...propuesta, nuevas: propuesta.ordenes.length, actualizadas: 0, reabiertas: 0, aCerrar: [] };
}

export function CsvImporter({ modoDemo, informar }: { modoDemo: boolean; informar: (texto: string, esError?: boolean) => void }) {
  const [archivoOc, setArchivoOc] = useState<File | null>(null);
  const [archivoCatalogo, setArchivoCatalogo] = useState<File | null>(null);
  const [archivoCsv, setArchivoCsv] = useState<File | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<VistaPrevia | null>(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [errorLocal, setErrorLocal] = useState("");
  const [progreso, setProgreso] = useState("");
  const [ultimaActualizacion, setUltimaActualizacion] = useState<string | null>(null);
  const [cargaVencida, setCargaVencida] = useState(false);

  useEffect(() => {
    if (modoDemo) return;
    let vigente = true;
    const consultar = async () => {
      const supabase = obtenerSupabase();
      if (!supabase) return;
      const { data } = await supabase.from("ordenes_compra")
        .select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (vigente) {
        const fecha = data?.updated_at ?? null;
        setUltimaActualizacion(fecha);
        setCargaVencida(Boolean(fecha && Date.now() - new Date(fecha).getTime() > VIGENCIA_REPORTE_MS));
      }
    };
    void consultar();
    const intervalo = window.setInterval(() => void consultar(), 5 * 60 * 1000);
    return () => { vigente = false; window.clearInterval(intervalo); };
  }, [modoDemo]);

  const notificar = (texto: string, esError = false) => {
    setAviso(esError ? "" : texto);
    setErrorLocal(esError ? texto : "");
    informar(texto, esError);
  };

  const limpiarVista = () => {
    setVistaPrevia(null);
    setConfirmarCierre(false);
  };

  const revisarSumma = async () => {
    if (!archivoOc || !archivoCatalogo) {
      notificar("Elegí el reporte de OCs y el catálogo de proveedores de Summa.", true);
      return;
    }
    setOcupado(true);
    notificar("");
    setProgreso("Leyendo las planillas de Summa…");
    try {
      exigirReporteReciente(archivoOc);
      const propuesta = await prepararReporteSumma(archivoOc, archivoCatalogo);
      setProgreso("Comparando las OCs con la agenda actual…");
      setVistaPrevia(modoDemo ? crearVistaPreviaDemo(propuesta) : await crearVistaPrevia(propuesta));
      notificar("Vista previa lista. Revisá los resultados antes de confirmar.");
    } catch (error) {
      notificar(error instanceof Error ? error.message : "No pudimos revisar las planillas.", true);
    } finally {
      setProgreso("");
      setOcupado(false);
    }
  };

  const revisarCsv = async () => {
    if (!archivoCsv) {
      notificar("Elegí primero el archivo CSV.", true);
      return;
    }
    setOcupado(true);
    notificar("");
    setProgreso("Leyendo el CSV…");
    try {
      const propuesta = agruparImportacion(leerCsv(await archivoCsv.text()), "csv");
      setProgreso("Comparando las OCs con la agenda actual…");
      setVistaPrevia(modoDemo ? crearVistaPreviaDemo(propuesta) : await crearVistaPrevia(propuesta));
      notificar("Vista previa lista. Revisá los resultados antes de confirmar.");
    } catch (error) {
      notificar(error instanceof Error ? error.message : "No pudimos revisar el CSV.", true);
    } finally {
      setProgreso("");
      setOcupado(false);
    }
  };

  const confirmarImportacion = async () => {
    if (!vistaPrevia) return;
    if (vistaPrevia.fuente === "summa" && archivoOc) {
      try { exigirReporteReciente(archivoOc); }
      catch (error) { notificar(error instanceof Error ? error.message : "Exportá un reporte nuevo de Summa.", true); return; }
    }
    if (vistaPrevia.aCerrar.length && !confirmarCierre) {
      notificar("Confirmá el cierre de OCs antes de aplicar esta actualización.", true);
      return;
    }
    if (modoDemo) {
      notificar(`Vista de prueba: se revisarían ${vistaPrevia.proveedores.length} proveedores y ${vistaPrevia.ordenes.length} OCs.`);
      return;
    }
    const supabase = obtenerSupabase();
    if (!supabase) {
      notificar("No encontramos la conexión a la base de datos.", true);
      return;
    }
    setOcupado(true);
    notificar("");
    setProgreso("Guardando la actualización…");
    try {
      const cuits = vistaPrevia.proveedores.map((proveedor) => proveedor.cuit);
      const { data: proveedoresExistentes, error: errorExistentes } = await supabase
        .from("proveedores")
        .select("cuit,email,codigo_externo")
        .in("cuit", cuits);
      if (errorExistentes) throw new Error("No pudimos consultar los proveedores existentes.");
      const existentePorCuit = new Map(((proveedoresExistentes ?? []) as ProveedorActual[]).map((proveedor) => [proveedor.cuit, proveedor]));
      const { data: proveedoresGuardados, error: errorProveedores } = await supabase
        .from("proveedores")
        .upsert(vistaPrevia.proveedores.map((proveedor) => {
          const existente = existentePorCuit.get(proveedor.cuit);
          return {
            cuit: proveedor.cuit,
            razon_social: proveedor.razon_social,
            email: proveedor.email || existente?.email || null,
            codigo_externo: proveedor.codigo_externo || existente?.codigo_externo || null,
            habilitado: true,
          };
        }), { onConflict: "cuit" })
        .select("id,cuit");
      if (errorProveedores || !proveedoresGuardados) throw new Error("No pudimos actualizar los proveedores.");
      const idPorCuit = new Map((proveedoresGuardados as { id: string; cuit: string }[]).map((proveedor) => [proveedor.cuit, proveedor.id]));
      const { data: ordenesGuardadas, error: errorOrdenes } = await supabase
        .from("ordenes_compra")
        .upsert(vistaPrevia.ordenes.map((orden) => ({
          numero: orden.orden_compra,
          proveedor_id: idPorCuit.get(orden.cuit),
          estado: "abierta",
          ...(orden.fecha ? { fecha: orden.fecha } : {}),
        })), { onConflict: "numero" })
        .select("id,numero");
      if (errorOrdenes || !ordenesGuardadas) throw new Error("No pudimos actualizar las órdenes de compra.");
      let lineasActualizadas = 0;
      let controlDetalladoPendiente = false;
      if (vistaPrevia.lineas.length) {
        const idPorNumero = new Map((ordenesGuardadas as { id: string; numero: string }[]).map((orden) => [orden.numero, orden.id]));
        const lineasParaGuardar = vistaPrevia.lineas.map((linea) => {
          const ordenCompraId = idPorNumero.get(linea.orden_compra);
          if (!ordenCompraId) throw new Error(`No encontramos la OC ${linea.orden_compra} después de actualizarla.`);
          return { ...linea, orden_compra_id: ordenCompraId };
        });
        const { error: errorLineas } = await supabase
          .from("lineas_orden_compra")
          .upsert(lineasParaGuardar.map((linea) => ({
            orden_compra_id: linea.orden_compra_id,
            renglon: linea.renglon,
            producto_codigo: linea.producto_codigo,
            descripcion_producto: linea.descripcion_producto,
            unidad_medida: linea.unidad_medida,
            moneda: linea.moneda,
            cantidad_ordenada: linea.cantidad_ordenada,
            cantidad_recibida: linea.cantidad_recibida,
            cantidad_pendiente: linea.cantidad_pendiente,
            precio_unitario: linea.precio_unitario,
          })), { onConflict: "orden_compra_id,renglon" });
        if (errorLineas) {
          if (errorLineas.code === "42P01" || errorLineas.code === "PGRST205") controlDetalladoPendiente = true;
          else throw new Error(`Actualizamos las OCs, pero no pudimos guardar su detalle por renglón (${errorLineas.code ?? "sin código"}: ${errorLineas.message}).`);
        } else {
          lineasActualizadas = lineasParaGuardar.length;
        }
      }
      if (vistaPrevia.aCerrar.length) {
        const { error: errorCierre } = await supabase.from("ordenes_compra").update({ estado: "cerrada" }).in("numero", vistaPrevia.aCerrar);
        if (errorCierre) throw new Error("Actualizamos las OCs vigentes, pero no pudimos cerrar las que ya no están en el reporte.");
      }
      notificar(`Actualización lista: ${vistaPrevia.proveedores.length} proveedores y ${vistaPrevia.ordenes.length} OCs procesadas${lineasActualizadas ? `; ${lineasActualizadas} renglones actualizados.` : ""}${controlDetalladoPendiente ? "; el detalle por renglón se activará cuando apliques la migración pendiente." : ""}${vistaPrevia.aCerrar.length ? `; ${vistaPrevia.aCerrar.length} OCs cerradas.` : "."}`);
      if (vistaPrevia.fuente === "summa") {
        setUltimaActualizacion(new Date().toISOString());
        setCargaVencida(false);
      }
      limpiarVista();
    } catch (error) {
      notificar(error instanceof Error ? error.message : "No pudimos aplicar la actualización.", true);
    } finally {
      setProgreso("");
      setOcupado(false);
    }
  };

  const seleccionarOc = (evento: ChangeEvent<HTMLInputElement>) => {
    setArchivoOc(evento.target.files?.[0] ?? null);
    limpiarVista();
  };
  const seleccionarCatalogo = (evento: ChangeEvent<HTMLInputElement>) => {
    setArchivoCatalogo(evento.target.files?.[0] ?? null);
    limpiarVista();
  };
  const seleccionarCsv = (evento: ChangeEvent<HTMLInputElement>) => {
    setArchivoCsv(evento.target.files?.[0] ?? null);
    limpiarVista();
  };

  return (
    <section className="import-card" aria-labelledby="importacion-titulo">
      <div>
        <p className="eyebrow">Sincronización Summa</p>
        <h2 id="importacion-titulo">Actualizar proveedores y OCs</h2>
        <p>Elegí las dos exportaciones originales. Primero vas a ver qué se dará de alta, actualizará o cerrará; nada cambia hasta confirmarlo.</p>
        {!modoDemo && ultimaActualizacion && <p className={cargaVencida ? "sync-age stale" : "sync-age"}>
          Último cambio registrado en OCs: {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(ultimaActualizacion))}.
          {cargaVencida && " Pasaron más de cuatro horas: actualizá Summa antes de usar estos datos para nuevas entregas."}
        </p>}
      </div>
      <div className="import-actions">
        <label className="file-picker"><span>Reporte de OCs (.xlsx)</span><input type="file" accept=".xlsx" onChange={seleccionarOc} /><b>{archivoOc?.name ?? "Elegir archivo"}</b></label>
        <label className="file-picker"><span>Catálogo de proveedores (.xlsx)</span><input type="file" accept=".xlsx" onChange={seleccionarCatalogo} /><b>{archivoCatalogo?.name ?? "Elegir archivo"}</b></label>
        <button className="secondary-button" type="button" disabled={ocupado} onClick={() => void revisarSumma()}>{ocupado ? "Revisando…" : "Revisar actualización"}</button>
      </div>
      {progreso && <p className="import-progress" role="status">{progreso}</p>}
      {aviso && <p className="form-alert success import-feedback" role="status">{aviso}</p>}
      {errorLocal && <p className="form-alert error import-feedback" role="alert">{errorLocal}</p>}

      {vistaPrevia && (
        <div className="sync-preview" aria-live="polite">
          <strong>Vista previa — todavía no se guardó nada</strong>
          <span>{vistaPrevia.proveedores.length} proveedores · {vistaPrevia.ordenes.length} OCs del reporte</span>
          {vistaPrevia.lineas.length > 0 && <span>{vistaPrevia.lineas.length} renglones de OC para el control detallado</span>}
          <span>{vistaPrevia.nuevas} nuevas · {vistaPrevia.actualizadas} vigentes a actualizar · {vistaPrevia.reabiertas} a reabrir</span>
          {vistaPrevia.aCerrar.length > 0 && <label className="sync-confirm"><input type="checkbox" checked={confirmarCierre} onChange={(evento) => setConfirmarCierre(evento.target.checked)} />Cerrar {vistaPrevia.aCerrar.length} OCs abiertas que ya no figuran en el reporte</label>}
          {vistaPrevia.advertencias.map((advertencia) => <p key={advertencia}>{advertencia}</p>)}
          <button className="primary-button" type="button" disabled={ocupado || (vistaPrevia.aCerrar.length > 0 && !confirmarCierre)} onClick={() => void confirmarImportacion()}>{modoDemo ? "Simular actualización" : "Confirmar y actualizar"}</button>
        </div>
      )}

      <details className="csv-import">
        <summary>Usar un CSV preparado en lugar de las exportaciones originales</summary>
        <div className="import-actions">
          <label className="file-picker"><span>Archivo CSV</span><input type="file" accept=".csv,text/csv" onChange={seleccionarCsv} /><b>{archivoCsv?.name ?? "Elegir archivo"}</b></label>
          <button className="secondary-button" type="button" disabled={ocupado} onClick={() => void revisarCsv()}>Revisar CSV</button>
        </div>
        <small>El CSV crea o actualiza datos, pero nunca cierra OCs porque puede ser una carga parcial.</small>
      </details>
    </section>
  );
}
