"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { TurnoAgenda } from "@/lib/domain";
import { LecturaRemito, sugerirCodigo } from "@/lib/remito/parse";
import { obtenerSupabase } from "@/lib/supabase/client";

type LineaOrden = {
  id: string;
  renglon: number;
  producto_codigo: string;
  descripcion_producto: string | null;
  unidad_medida: string | null;
  moneda: string | null;
  cantidad_pendiente: number | string;
  precio_unitario: number | string | null;
};

type LineaRemito = {
  id: string;
  renglon: number;
  producto_codigo: string;
  descripcion_producto: string | null;
  unidad_medida: string | null;
  moneda: string | null;
  cantidad: number | string;
  precio_unitario: number | string | null;
};

type ProductoOc = {
  codigo: string;
  descripcion: string | null;
  unidad: string | null;
  pendiente: number;
  precio: number | null;
};

type PropuestaRemito = {
  id: number;
  codigo: string;
  cantidad: string;
  descripcion: string;
};

const LINEAS_DEMO: LineaOrden[] = [
  { id: "demo-1", renglon: 1, producto_codigo: "PAP-A4-80", descripcion_producto: "Resma papel A4 80 g", unidad_medida: "UN", moneda: "ARS", cantidad_pendiente: 40, precio_unitario: 7500 },
  { id: "demo-2", renglon: 2, producto_codigo: "SOB-OF-90", descripcion_producto: "Sobre oficio blanco", unidad_medida: "UN", moneda: "ARS", cantidad_pendiente: 100, precio_unitario: 185 },
];

function normalizarCodigo(valor: string) {
  return valor.trim().toUpperCase();
}

function normalizarNumeroRemito(valor: string) {
  return valor.match(/\d+/g)?.map((parte) => parte.replace(/^0+(?=\d)/, "")).join("-") ?? valor.trim().toUpperCase();
}

function numero(valor: number | string | null | undefined) {
  if (typeof valor === "number") return valor;
  if (!valor) return 0;
  const convertido = Number(String(valor).replace(",", "."));
  return Number.isFinite(convertido) ? convertido : 0;
}

function formatoNumero(valor: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(valor);
}

function formatoPrecio(valor: number | null, moneda: string | null) {
  if (valor === null) return "—";
  const prefijo = moneda ? `${moneda} ` : "";
  return `${prefijo}${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(valor)}`;
}

export function DetalleRecepcion({
  turno,
  modoDemo,
  informar,
  cerrar,
}: {
  turno: TurnoAgenda;
  modoDemo: boolean;
  informar: (texto: string, esError?: boolean) => void;
  cerrar: () => void;
}) {
  const [lineasOc, setLineasOc] = useState<LineaOrden[]>(() => modoDemo ? LINEAS_DEMO : []);
  const [lineasRemito, setLineasRemito] = useState<LineaRemito[]>([]);
  const [remitoId, setRemitoId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(!modoDemo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [precio, setPrecio] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [progresoLectura, setProgresoLectura] = useState("");
  const [lectura, setLectura] = useState<LecturaRemito | null>(null);
  const [propuestas, setPropuestas] = useState<PropuestaRemito[]>([]);
  const [guardandoPropuesta, setGuardandoPropuesta] = useState<number | null>(null);

  useEffect(() => {
    if (modoDemo) return;

    let vigente = true;
    void (async () => {
      const supabase = obtenerSupabase();
      if (!supabase) {
        if (vigente) {
          setError("No encontramos la conexión para cargar el control.");
          setCargando(false);
        }
        return;
      }
      const [{ data: orden, error: errorOrden }, { data: remito, error: errorRemito }] = await Promise.all([
        supabase.from("ordenes_compra").select("id").eq("numero", turno.ordenCompra).maybeSingle(),
        supabase.from("remitos").select("id").eq("turno_id", turno.id).maybeSingle(),
      ]);
      if (!vigente) return;
      if (errorOrden || errorRemito || !orden || !remito) {
        setError("No pudimos encontrar la OC o el remito de este turno.");
        setCargando(false);
        return;
      }

      const [{ data: detalleOc, error: errorDetalleOc }, { data: detalleRemito, error: errorDetalleRemito }] = await Promise.all([
        supabase.from("lineas_orden_compra").select("id,renglon,producto_codigo,descripcion_producto,unidad_medida,moneda,cantidad_pendiente,precio_unitario").eq("orden_compra_id", orden.id).order("renglon"),
        supabase.from("lineas_remito").select("id,renglon,producto_codigo,descripcion_producto,unidad_medida,moneda,cantidad,precio_unitario").eq("remito_id", remito.id).order("renglon"),
      ]);
      if (!vigente) return;
      if (errorDetalleOc || errorDetalleRemito) {
        setError("No pudimos cargar el detalle. Verificá que la actualización de Summa haya terminado.");
        setCargando(false);
        return;
      }
      setLineasOc((detalleOc ?? []) as LineaOrden[]);
      setLineasRemito((detalleRemito ?? []) as LineaRemito[]);
      setRemitoId(remito.id);
      setCargando(false);
    })();

    return () => { vigente = false; };
  }, [modoDemo, turno]);

  const productosOc = useMemo(() => {
    const productos = new Map<string, ProductoOc>();
    lineasOc.forEach((linea) => {
      const codigoProducto = normalizarCodigo(linea.producto_codigo);
      const anterior = productos.get(codigoProducto);
      productos.set(codigoProducto, {
        codigo: codigoProducto,
        descripcion: anterior?.descripcion ?? linea.descripcion_producto,
        unidad: anterior?.unidad ?? linea.unidad_medida,
        pendiente: (anterior?.pendiente ?? 0) + numero(linea.cantidad_pendiente),
        precio: anterior?.precio ?? (linea.precio_unitario === null ? null : numero(linea.precio_unitario)),
      });
    });
    return productos;
  }, [lineasOc]);

  const recibidoPorProducto = useMemo(() => {
    const recibidos = new Map<string, number>();
    lineasRemito.forEach((linea) => {
      const codigoProducto = normalizarCodigo(linea.producto_codigo);
      recibidos.set(codigoProducto, (recibidos.get(codigoProducto) ?? 0) + numero(linea.cantidad));
    });
    return recibidos;
  }, [lineasRemito]);

  const resumen = useMemo(() => {
    let coincide = 0;
    let revisar = 0;
    let parcial = 0;
    productosOc.forEach((producto) => {
      const recibido = recibidoPorProducto.get(producto.codigo) ?? 0;
      if (recibido > producto.pendiente) revisar += 1;
      else if (recibido > 0 && recibido < producto.pendiente) parcial += 1;
      else if (recibido === producto.pendiente && recibido > 0) coincide += 1;
    });
    lineasRemito.forEach((linea) => {
      if (!productosOc.has(normalizarCodigo(linea.producto_codigo))) revisar += 1;
    });
    return { coincide, revisar, parcial };
  }, [lineasRemito, productosOc, recibidoPorProducto]);

  const completarProducto = (valor: string) => {
    setCodigo(valor);
    const producto = productosOc.get(normalizarCodigo(valor));
    if (producto) {
      setDescripcion(producto.descripcion ?? "");
      setPrecio(producto.precio === null ? "" : String(producto.precio));
    }
  };

  const analizarArchivo = async () => {
    if (modoDemo || !turno.rutaRemito) {
      setError("Este turno no tiene un archivo de remito para leer.");
      return;
    }
    const supabase = obtenerSupabase();
    if (!supabase) return;
    setLeyendo(true);
    setError("");
    setProgresoLectura("Abriendo el remito…");
    try {
      const { data, error: errorUrl } = await supabase.storage.from("remitos").createSignedUrl(turno.rutaRemito, 300);
      if (errorUrl || !data) throw new Error("No pudimos abrir el archivo del remito.");
      const respuesta = await fetch(data.signedUrl);
      if (!respuesta.ok) throw new Error("No pudimos descargar el archivo del remito.");
      const archivoDescargado = await respuesta.blob();
      const archivo = new Blob([archivoDescargado], { type: turno.tipoRemito || archivoDescargado.type });
      if (!archivo.type.includes("pdf") && !archivo.type.startsWith("image/")) throw new Error("Este tipo de archivo no se puede leer automáticamente.");
      const { leerRemito } = await import("@/lib/remito/reader");
      const resultado = await leerRemito(archivo, setProgresoLectura);
      setLectura(resultado);
      setPropuestas(resultado.renglones.map((renglon, indice) => ({
        id: indice,
        codigo: sugerirCodigo(renglon.descripcion, [...productosOc.values()]),
        cantidad: renglon.cantidad,
        descripcion: renglon.descripcion,
      })));
      if (resultado.renglones.length === 0) setError("No pudimos distinguir renglones en el archivo. Podés registrarlos manualmente mirando el remito.");
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "Falló la lectura del remito. Podés cargar los renglones manualmente.");
    } finally {
      setLeyendo(false);
      setProgresoLectura("");
    }
  };

  const actualizarPropuesta = (id: number, campo: "codigo" | "cantidad" | "descripcion", valor: string) => {
    setPropuestas((actuales) => actuales.map((propuesta) => propuesta.id === id ? { ...propuesta, [campo]: valor } : propuesta));
  };

  const registrarPropuesta = async (propuesta: PropuestaRemito) => {
    const codigoLimpio = normalizarCodigo(propuesta.codigo);
    const cantidadNumerica = numero(propuesta.cantidad);
    if (!codigoLimpio || !/^\d+(?:[.,]\d{1,4})?$/.test(propuesta.cantidad.trim()) || cantidadNumerica <= 0) {
      setError("Revisá el código y la cantidad del renglón. Se admiten hasta cuatro decimales.");
      return;
    }
    if (!propuesta.descripcion.trim()) {
      setError("Completá la descripción que figura en el remito.");
      return;
    }
    if (!remitoId) {
      setError("Todavía estamos cargando el remito. Intentá nuevamente en unos segundos.");
      return;
    }
    const productoOc = productosOc.get(codigoLimpio);
    const nuevaLinea = {
      remito_id: remitoId,
      renglon: Math.max(0, ...lineasRemito.map((linea) => linea.renglon)) + 1,
      producto_codigo: codigoLimpio,
      descripcion_producto: propuesta.descripcion.trim(),
      unidad_medida: productoOc?.unidad ?? null,
      moneda: lineasOc.find((linea) => normalizarCodigo(linea.producto_codigo) === codigoLimpio)?.moneda ?? null,
      cantidad: cantidadNumerica,
      precio_unitario: null,
    };
    const supabase = obtenerSupabase();
    if (!supabase) return;
    setGuardandoPropuesta(propuesta.id);
    setError("");
    const { data, error: errorGuardar } = await supabase.from("lineas_remito")
      .insert(nuevaLinea)
      .select("id,renglon,producto_codigo,descripcion_producto,unidad_medida,moneda,cantidad,precio_unitario")
      .single();
    setGuardandoPropuesta(null);
    if (errorGuardar || !data) {
      setError("No pudimos guardar este renglón. Revisá los datos e intentá de nuevo.");
      return;
    }
    setLineasRemito((actuales) => [...actuales, data as LineaRemito]);
    setPropuestas((actuales) => actuales.filter((item) => item.id !== propuesta.id));
    informar("Renglón del remito registrado. La OC no fue modificada.");
  };

  const guardarLinea = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const codigoLimpio = normalizarCodigo(codigo);
    const cantidadNumerica = numero(cantidad);
    const precioNumerico = precio.trim() ? numero(precio) : null;
    const precioValido = !precio.trim() || (Number.isFinite(Number(precio.trim().replace(",", "."))) && (precioNumerico ?? 0) >= 0);
    if (!codigoLimpio || cantidadNumerica <= 0) {
      setError("Indicá el código del producto y una cantidad mayor que cero.");
      return;
    }
    if (!precioValido) {
      setError("El precio debe ser un número válido si querés registrarlo.");
      return;
    }

    const productoOc = productosOc.get(codigoLimpio);
    const nuevaLinea: LineaRemito = {
      id: `temporal-${Date.now()}`,
      renglon: Math.max(0, ...lineasRemito.map((linea) => linea.renglon)) + 1,
      producto_codigo: codigoLimpio,
      descripcion_producto: descripcion.trim() || productoOc?.descripcion || null,
      unidad_medida: productoOc?.unidad ?? null,
      moneda: productoOc?.precio === null ? null : lineasOc.find((linea) => normalizarCodigo(linea.producto_codigo) === codigoLimpio)?.moneda ?? null,
      cantidad: cantidadNumerica,
      precio_unitario: precioNumerico,
    };

    if (modoDemo) {
      setLineasRemito((actuales) => [...actuales, nuevaLinea]);
      setCantidad("");
      setError("");
      informar("Renglón agregado a la prueba. En el panel real se guarda en el remito.");
      return;
    }
    if (!remitoId) {
      setError("Todavía estamos cargando el remito. Intentá nuevamente en unos segundos.");
      return;
    }
    const supabase = obtenerSupabase();
    if (!supabase) return;
    setGuardando(true);
    setError("");
    const { data, error: errorGuardar } = await supabase
      .from("lineas_remito")
      .insert({
        remito_id: remitoId,
        renglon: nuevaLinea.renglon,
        producto_codigo: nuevaLinea.producto_codigo,
        descripcion_producto: nuevaLinea.descripcion_producto,
        unidad_medida: nuevaLinea.unidad_medida,
        moneda: nuevaLinea.moneda,
        cantidad: nuevaLinea.cantidad,
        precio_unitario: nuevaLinea.precio_unitario,
      })
      .select("id,renglon,producto_codigo,descripcion_producto,unidad_medida,moneda,cantidad,precio_unitario")
      .single();
    setGuardando(false);
    if (errorGuardar || !data) {
      setError("No pudimos guardar ese renglón del remito. Revisá los datos e intentá otra vez.");
      return;
    }
    setLineasRemito((actuales) => [...actuales, data as LineaRemito]);
    setCantidad("");
    setError("");
    informar("Renglón del remito registrado. La OC no fue modificada.");
  };

  return (
    <section className="detail-card" aria-labelledby="control-detallado-titulo">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Control de recepción</p>
          <h2 id="control-detallado-titulo">Remito {turno.remito}</h2>
          <p>{turno.proveedor} · OC {turno.ordenCompra}</p>
        </div>
        <button className="text-button" type="button" onClick={cerrar}>Cerrar control</button>
      </div>

      <p className="detail-note">Este control registra lo que llegó, pero no cierra ni modifica la OC automáticamente. El precio queda solo como referencia.</p>
      {error && <p className="form-alert error" role="alert">{error}</p>}
      {cargando && <p className="form-alert info" role="status">Cargando el detalle de la OC y del remito…</p>}

      {!cargando && lineasOc.length === 0 && (
        <p className="form-alert warning">Todavía no hay productos de esta OC. Ejecutá y confirmá una actualización de Summa con los dos Excel para habilitar la comparación.</p>
      )}

      {!cargando && lineasOc.length > 0 && (
        <>
          <section className="remito-reading" aria-labelledby="lectura-remito-titulo">
            <div className="remito-reading-heading">
              <div>
                <h3 id="lectura-remito-titulo">Leer remito automáticamente</h3>
                <p>La lectura propone datos del archivo. Revisá cada renglón contra el PDF antes de registrarlo; los escaneos pueden confundir números.</p>
              </div>
              <button className="secondary-button" type="button" disabled={leyendo || guardandoPropuesta !== null || modoDemo || !turno.rutaRemito} onClick={analizarArchivo}>
                {leyendo ? "Leyendo…" : lectura ? "Volver a leer" : "Analizar remito"}
              </button>
            </div>
            {modoDemo && <p className="remito-reading-hint">La lectura está disponible en turnos reales con un archivo adjunto.</p>}
            {leyendo && <p className="form-alert info" role="status">{progresoLectura}</p>}
            {lectura && !leyendo && <>
              <p className="remito-reading-hint">{lectura.metodo === "ocr" ? "Lectura de imagen (OCR)" : "Texto del PDF"} · {lectura.paginas} página{lectura.paginas === 1 ? "" : "s"} revisada{lectura.paginas === 1 ? "" : "s"}. {lectura.incompleto ? "El archivo tiene más páginas; revisá las restantes manualmente." : ""}</p>
              <p className={lectura.numero && normalizarNumeroRemito(lectura.numero) !== normalizarNumeroRemito(turno.remito) ? "form-alert warning" : "remito-reading-hint"}>
                Número leído: <b>{lectura.numero ?? "no reconocido"}</b> · Número del turno: <b>{turno.remito}</b>
                {lectura.numero && normalizarNumeroRemito(lectura.numero) !== normalizarNumeroRemito(turno.remito) ? ". Verificá que sea el remito correcto antes de registrar datos." : ""}
              </p>
              {propuestas.length > 0 && <div className="remito-proposals">
                {propuestas.map((propuesta) => <div className="remito-proposal" key={propuesta.id}>
                  <p><b>Renglón leído {propuesta.id + 1}</b>{propuesta.codigo ? " · Código sugerido; confirmalo" : " · Seleccioná el producto de la OC"}</p>
                  <div className="remito-proposal-fields">
                    <label className="field"><span>Código de producto</span><input list="productos-oc" value={propuesta.codigo} onChange={(e) => actualizarPropuesta(propuesta.id, "codigo", e.target.value)} placeholder="Elegí un producto de la OC" /></label>
                    <label className="field"><span>Cantidad</span><input inputMode="decimal" value={propuesta.cantidad} onChange={(e) => actualizarPropuesta(propuesta.id, "cantidad", e.target.value)} /></label>
                    <label className="field remito-proposal-description"><span>Descripción del remito</span><input value={propuesta.descripcion} onChange={(e) => actualizarPropuesta(propuesta.id, "descripcion", e.target.value)} /></label>
                    <button className="secondary-button" type="button" disabled={guardandoPropuesta !== null} onClick={() => void registrarPropuesta(propuesta)}>{guardandoPropuesta === propuesta.id ? "Guardando…" : "Confirmar renglón"}</button>
                  </div>
                  {propuesta.codigo && !productosOc.has(normalizarCodigo(propuesta.codigo)) && <small className="remito-proposal-warning">Este código no figura en la OC y quedará marcado para revisar.</small>}
                  {propuesta.codigo && productosOc.has(normalizarCodigo(propuesta.codigo)) && numero(propuesta.cantidad) > (productosOc.get(normalizarCodigo(propuesta.codigo))?.pendiente ?? 0) && <small className="remito-proposal-warning">La cantidad propuesta supera lo pendiente en la OC. Revisá el archivo y corregí la cifra si el OCR la leyó mal.</small>}
                  {lineasRemito.some((linea) => normalizarCodigo(linea.producto_codigo) === normalizarCodigo(propuesta.codigo) && numero(linea.cantidad) === numero(propuesta.cantidad) && linea.descripcion_producto?.trim().toUpperCase() === propuesta.descripcion.trim().toUpperCase()) && <small className="remito-proposal-warning">Ya hay un renglón igual registrado. Comprobá que no lo estés cargando de nuevo.</small>}
                </div>)}
              </div>}
              <details className="remito-extracted-text"><summary>Ver texto leído</summary><pre>{lectura.texto || "Sin texto reconocido"}</pre></details>
            </>}
          </section>

          <div className="detail-summary" aria-label="Resumen del control">
            <span><b>{resumen.coincide}</b> coincide</span>
            <span><b>{resumen.parcial}</b> entrega parcial</span>
            <span className={resumen.revisar ? "needs-review" : ""}><b>{resumen.revisar}</b> a revisar</span>
          </div>

          <div className="detail-table-wrap">
            <table className="detail-table">
              <thead><tr><th>Producto</th><th>Pendiente OC</th><th>Recibido</th><th>Saldo</th><th>Estado</th></tr></thead>
              <tbody>
                {[...productosOc.values()].map((producto) => {
                  const recibido = recibidoPorProducto.get(producto.codigo) ?? 0;
                  const saldo = producto.pendiente - recibido;
                  const excede = recibido > producto.pendiente;
                  const parcial = recibido > 0 && recibido < producto.pendiente;
                  const coincide = recibido === producto.pendiente && recibido > 0;
                  return <tr key={producto.codigo}>
                    <td><b>{producto.codigo}</b><small>{producto.descripcion ?? "Sin descripción"}</small><small>Referencia: {formatoPrecio(producto.precio, lineasOc.find((linea) => normalizarCodigo(linea.producto_codigo) === producto.codigo)?.moneda ?? null)}</small></td>
                    <td>{formatoNumero(producto.pendiente)} {producto.unidad ?? ""}</td>
                    <td>{formatoNumero(recibido)} {producto.unidad ?? ""}</td>
                    <td>{formatoNumero(Math.abs(saldo))} {saldo < 0 ? "de más" : producto.unidad ?? ""}</td>
                    <td><span className={`detail-status ${excede ? "review" : coincide ? "match" : parcial ? "partial" : "pending"}`}>{excede ? "Supera pendiente" : coincide ? "Coincide" : parcial ? "Entrega parcial" : "Sin registrar"}</span></td>
                  </tr>;
                })}
                {lineasRemito.filter((linea) => !productosOc.has(normalizarCodigo(linea.producto_codigo))).map((linea) => (
                  <tr key={linea.id} className="unlisted-product"><td><b>{linea.producto_codigo}</b><small>{linea.descripcion_producto ?? "Producto no informado en OC"}</small></td><td>—</td><td>{formatoNumero(numero(linea.cantidad))} {linea.unidad_medida ?? ""}</td><td>—</td><td><span className="detail-status review">No figura en OC</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <form className="detail-form" onSubmit={guardarLinea}>
            <div>
              <h3>Registrar un renglón del remito</h3>
              <p>Seleccioná el código de la OC y registrá la cantidad que figura en el remito. La comparación se actualiza al guardarlo.</p>
            </div>
            <div className="detail-form-fields">
              <label className="field"><span>Código de producto</span><input list="productos-oc" required value={codigo} onChange={(e) => completarProducto(e.target.value)} placeholder="Ej.: PAP-A4-80" /><datalist id="productos-oc">{[...productosOc.values()].map((producto) => <option key={producto.codigo} value={producto.codigo}>{producto.descripcion ?? producto.codigo}</option>)}</datalist></label>
              <label className="field"><span>Cantidad recibida</span><input required inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" /></label>
              <label className="field"><span>Precio unitario <em>opcional</em></span><input inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Solo referencia" /></label>
              <label className="field detail-description"><span>Descripción <em>opcional</em></span><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Solo si el código no figura en la OC" /></label>
              <button className="secondary-button" type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Registrar renglón"}</button>
            </div>
          </form>

          {lineasRemito.length > 0 && <p className="detail-recorded">{lineasRemito.length} renglón{lineasRemito.length === 1 ? "" : "es"} registrado{lineasRemito.length === 1 ? "" : "s"} en este remito.</p>}
        </>
      )}
    </section>
  );
}
