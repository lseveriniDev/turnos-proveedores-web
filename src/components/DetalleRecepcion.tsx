"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { TurnoAgenda } from "@/lib/domain";
import { sugerirCodigo } from "@/lib/remito/parse";
import { obtenerSupabase } from "@/lib/supabase/client";

type LineaOrden = {
  renglon: number;
  producto_codigo: string;
  descripcion_producto: string | null;
  unidad_medida: string | null;
  moneda: string | null;
  cantidad_ordenada: number | string;
  cantidad_pendiente: number | string;
};

type LineaGuardada = {
  id: string;
  renglon: number;
  producto_codigo: string;
  descripcion_producto: string | null;
  cantidad: number | string;
};

type LineaControl = {
  clave: string;
  id: string | null;
  renglon: number | null;
  codigo: string;
  descripcion: string;
  cantidad: string;
  pendienteGuardar: boolean;
};

type Edicion = Pick<LineaControl, "clave" | "codigo" | "descripcion" | "cantidad">;

const LINEAS_DEMO: LineaOrden[] = [
  { renglon: 1, producto_codigo: "PAP-A4-80", descripcion_producto: "Resma papel A4 80 g", unidad_medida: "UN", moneda: "ARS", cantidad_ordenada: 40, cantidad_pendiente: 40 },
  { renglon: 2, producto_codigo: "SOB-OF-90", descripcion_producto: "Sobre oficio blanco", unidad_medida: "UN", moneda: "ARS", cantidad_ordenada: 100, cantidad_pendiente: 100 },
];

const CAMPOS_LINEA = "id,renglon,producto_codigo,descripcion_producto,cantidad";

function normalizarCodigo(valor: string) { return valor.trim().toUpperCase(); }
function numero(valor: number | string | null | undefined) { return Number(String(valor ?? "0").replace(",", ".")); }
function formatoNumero(valor: number) { return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(valor); }

export function DetalleRecepcion({ turno, modoDemo, informar, cerrar }: {
  turno: TurnoAgenda;
  modoDemo: boolean;
  informar: (texto: string, esError?: boolean) => void;
  cerrar: () => void;
}) {
  const [lineasOc, setLineasOc] = useState<LineaOrden[]>(modoDemo ? LINEAS_DEMO : []);
  const [lineas, setLineas] = useState<LineaControl[]>([]);
  const [remitoId, setRemitoId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(!modoDemo);
  const [guardando, setGuardando] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [progresoLectura, setProgresoLectura] = useState("");
  const [error, setError] = useState("");
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [errorEdicion, setErrorEdicion] = useState("");

  useEffect(() => {
    if (modoDemo) return;
    let vigente = true;
    void (async () => {
      const supabase = obtenerSupabase();
      if (!supabase) {
        if (vigente) { setError("No encontramos la conexión para cargar el control."); setCargando(false); }
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
        supabase.from("lineas_orden_compra").select("renglon,producto_codigo,descripcion_producto,unidad_medida,moneda,cantidad_ordenada,cantidad_pendiente").eq("orden_compra_id", orden.id).order("renglon"),
        supabase.from("lineas_remito").select(CAMPOS_LINEA).eq("remito_id", remito.id).order("renglon"),
      ]);
      if (!vigente) return;
      if (errorDetalleOc || errorDetalleRemito) {
        setError("No pudimos cargar el control. Intentá abrirlo nuevamente.");
        setCargando(false);
        return;
      }
      const oc = (detalleOc ?? []) as LineaOrden[];
      const guardadas = (detalleRemito ?? []) as LineaGuardada[];
      setLineasOc(oc);
      setRemitoId(remito.id);
      setLineas(guardadas.length ? guardadas.map((linea) => ({
        clave: linea.id, id: linea.id, renglon: linea.renglon,
        codigo: linea.producto_codigo, descripcion: linea.descripcion_producto ?? "",
        cantidad: String(linea.cantidad),
        pendienteGuardar: false,
      })) : (turno.lineasDeclaradas ?? []).map((linea, indice) => {
        const producto = oc.find((item) => item.renglon === linea.renglonOc);
        return {
          clave: `detectada-${indice}`, id: null, renglon: null,
          codigo: producto?.producto_codigo ?? "", descripcion: linea.descripcion,
          cantidad: String(linea.cantidad), pendienteGuardar: true,
        };
      }));
      setCargando(false);
    })();
    return () => { vigente = false; };
  }, [modoDemo, turno]);

  const productosOc = useMemo(() => {
    const productos = new Map<string, { descripcion: string | null; unidad: string | null; moneda: string | null; pactado: number; pendiente: number }>();
    lineasOc.forEach((linea) => {
      const codigo = normalizarCodigo(linea.producto_codigo);
      const anterior = productos.get(codigo);
      productos.set(codigo, {
        descripcion: anterior?.descripcion ?? linea.descripcion_producto,
        unidad: anterior?.unidad ?? linea.unidad_medida,
        moneda: anterior?.moneda ?? linea.moneda,
        pactado: (anterior?.pactado ?? 0) + numero(linea.cantidad_ordenada),
        pendiente: (anterior?.pendiente ?? 0) + numero(linea.cantidad_pendiente),
      });
    });
    return productos;
  }, [lineasOc]);

  const abrirNuevo = () => {
    setErrorEdicion("");
    setEdicion({ clave: "", codigo: "", descripcion: "", cantidad: "" });
  };

  const abrirEdicion = (linea: LineaControl) => {
    setErrorEdicion("");
    setEdicion({ clave: linea.clave, codigo: linea.codigo, descripcion: linea.descripcion, cantidad: linea.cantidad });
  };

  const completarCodigo = (valor: string) => {
    setEdicion((actual) => actual ? { ...actual, codigo: valor } : null);
  };

  const aplicarEdicion = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!edicion) return;
    const codigo = normalizarCodigo(edicion.codigo);
    const cantidad = numero(edicion.cantidad);
    if (!codigo || !/^\d+(?:[.,]\d{1,4})?$/.test(edicion.cantidad.trim()) || !Number.isFinite(cantidad) || cantidad <= 0) {
      setErrorEdicion("Indicá un producto y una cantidad mayor que cero (hasta cuatro decimales).");
      return;
    }
    const descripcion = edicion.descripcion.trim() || productosOc.get(codigo)?.descripcion || "";
    if (!descripcion) { setErrorEdicion("Completá la descripción del remito."); return; }
    if (edicion.clave) {
      setLineas((actuales) => actuales.map((linea) => linea.clave === edicion.clave
        ? { ...linea, codigo, descripcion, cantidad: edicion.cantidad.trim().replace(",", "."), pendienteGuardar: true }
        : linea));
    } else {
      setLineas((actuales) => [...actuales, {
        clave: crypto.randomUUID(), id: null, renglon: null, codigo, descripcion,
        cantidad: edicion.cantidad.trim().replace(",", "."), pendienteGuardar: true,
      }]);
    }
    setEdicion(null);
    setError("");
  };

  const leerArchivo = async () => {
    if (!turno.rutaRemito || modoDemo) return;
    const supabase = obtenerSupabase();
    if (!supabase) return;
    setLeyendo(true);
    setError("");
    setProgresoLectura("Leyendo el remito…");
    try {
      const { data, error: errorUrl } = await supabase.storage.from("remitos").createSignedUrl(turno.rutaRemito, 300);
      if (errorUrl || !data) throw new Error("No pudimos abrir el archivo del remito.");
      const respuesta = await fetch(data.signedUrl);
      if (!respuesta.ok) throw new Error("No pudimos descargar el remito.");
      const archivo = await respuesta.blob();
      const { leerRemito } = await import("@/lib/remito/reader");
      const resultado = await leerRemito(new Blob([archivo], { type: turno.tipoRemito || archivo.type }), setProgresoLectura);
      if (resultado.renglones.length === 0) throw new Error("No pudimos leer los productos. Abrí el PDF y agregalos con el botón +.");
      setLineas(resultado.renglones.map((linea, indice) => ({
        clave: `leida-${indice}`, id: null, renglon: null,
        codigo: sugerirCodigo(linea.descripcion, [...productosOc.entries()].map(([codigo, producto]) => ({ codigo, descripcion: producto.descripcion }))),
        descripcion: linea.descripcion, cantidad: linea.cantidad, pendienteGuardar: true,
      })));
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No pudimos leer el remito.");
    } finally {
      setLeyendo(false);
      setProgresoLectura("");
    }
  };

  const guardarControl = async () => {
    const pendientes = lineas.filter((linea) => linea.pendienteGuardar);
    if (!pendientes.length) return;
    const sinCodigo = pendientes.find((linea) => !normalizarCodigo(linea.codigo) || !Number.isFinite(numero(linea.cantidad)) || numero(linea.cantidad) <= 0);
    if (sinCodigo) { setError("Revisá con el lápiz los renglones que no tienen producto o cantidad válida."); return; }
    if (!modoDemo && !remitoId) { setError("Todavía estamos cargando el remito."); return; }
    setGuardando(true);
    setError("");
    let siguienteRenglon = Math.max(0, ...lineas.map((linea) => linea.renglon ?? 0));
    try {
      for (const linea of pendientes) {
        const producto = productosOc.get(normalizarCodigo(linea.codigo));
        if (modoDemo) {
          setLineas((actuales) => actuales.map((item) => item.clave === linea.clave ? { ...item, pendienteGuardar: false } : item));
          continue;
        }
        const supabase = obtenerSupabase();
        if (!supabase) throw new Error("No pudimos conectar con el panel.");
        const valores = {
          producto_codigo: normalizarCodigo(linea.codigo), descripcion_producto: linea.descripcion,
          unidad_medida: producto?.unidad ?? null, moneda: producto?.moneda ?? null,
          cantidad: numero(linea.cantidad),
        };
        const consulta = linea.id
          ? supabase.from("lineas_remito").update(valores).eq("id", linea.id)
          : supabase.from("lineas_remito").insert({ ...valores, remito_id: remitoId, renglon: ++siguienteRenglon });
        const { data, error: errorGuardar } = await consulta.select(CAMPOS_LINEA).single();
        if (errorGuardar || !data) throw new Error("No pudimos guardar un renglón. Los anteriores sí quedaron registrados; intentá otra vez.");
        const guardada = data as LineaGuardada;
        setLineas((actuales) => actuales.map((item) => item.clave === linea.clave ? {
          ...item, id: guardada.id, renglon: guardada.renglon, pendienteGuardar: false,
        } : item));
      }
      informar(modoDemo ? "Control guardado en la vista de prueba." : "Recepción registrada. La OC no fue modificada.");
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No pudimos guardar el control.");
    } finally {
      setGuardando(false);
    }
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

      {error && <p className="form-alert error" role="alert">{error}</p>}
      {cargando && <p className="form-alert info" role="status">Cargando remito…</p>}
      {!cargando && <>
        <div className="control-list-heading">
          <h3>Productos del remito</h3>
          <button className="control-add-button" type="button" onClick={abrirNuevo} aria-label="Agregar renglón" title="Agregar renglón"><span aria-hidden="true">+</span> Agregar</button>
        </div>
        {lineas.length ? <div className="control-list">
          {lineas.map((linea) => {
            const producto = productosOc.get(normalizarCodigo(linea.codigo));
            return <article className="control-line" key={linea.clave}>
              <div className="control-line-main">
                <div>
                  <strong>{linea.descripcion || producto?.descripcion || "Producto del remito"}</strong>
                  <span>{linea.codigo || "Producto sin asociar"}</span>
                </div>
                <b>{formatoNumero(numero(linea.cantidad))} {producto?.unidad ?? ""}</b>
              </div>
              <div className="control-line-bottom">
                <small className={!producto ? "control-oc-warning" : ""}>{producto
                  ? `OC: ${formatoNumero(producto.pactado)} ${producto.unidad ?? ""} pactados · ${formatoNumero(producto.pendiente)} pendientes`
                  : "Este producto no se pudo asociar con la OC"}</small>
                <button className="control-edit-button" type="button" onClick={() => abrirEdicion(linea)} aria-label={`Editar ${linea.descripcion || linea.codigo || "renglón"}`} title="Editar renglón">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m4 16.5-.5 4 4-.5L19 8.5 15.5 5 4 16.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m13.5 7 3.5 3.5" stroke="currentColor" strokeWidth="1.8"/></svg>
                </button>
              </div>
            </article>;
          })}
        </div> : <div className="control-empty"><p>No hay productos registrados para este remito.</p>{!modoDemo && turno.rutaRemito && <button className="text-button" type="button" disabled={leyendo} onClick={() => void leerArchivo()}>{leyendo ? "Leyendo…" : "Leer archivo"}</button>}</div>}
        {leyendo && <p className="control-hint" role="status">{progresoLectura}</p>}
        {lineas.some((linea) => linea.pendienteGuardar) && <div className="control-save"><span>Revisá lo recibido antes de guardar. La OC no se modifica.</span><button className="secondary-button" type="button" disabled={guardando} onClick={() => void guardarControl()}>{guardando ? "Guardando…" : "Guardar control"}</button></div>}
      </>}

      {edicion && <div className="control-modal-backdrop" role="presentation" onMouseDown={() => setEdicion(null)}>
        <section className="control-modal" role="dialog" aria-modal="true" aria-labelledby="control-modal-titulo" onMouseDown={(evento) => evento.stopPropagation()}>
          <div className="control-modal-heading"><h3 id="control-modal-titulo">{edicion.clave ? "Editar renglón" : "Agregar renglón"}</h3><button className="control-close-button" type="button" onClick={() => setEdicion(null)} aria-label="Cerrar">×</button></div>
          <form onSubmit={aplicarEdicion}>
            <div className="control-modal-fields">
              <label className="field"><span>Producto de la OC</span><input list="productos-oc-control" required value={edicion.codigo} onChange={(e) => completarCodigo(e.target.value)} placeholder="Código del producto" /><datalist id="productos-oc-control">{[...productosOc.entries()].map(([codigo, producto]) => <option key={codigo} value={codigo}>{producto.descripcion ?? codigo}</option>)}</datalist></label>
              <label className="field"><span>Cantidad del remito</span><input required inputMode="decimal" value={edicion.cantidad} onChange={(e) => setEdicion((actual) => actual && { ...actual, cantidad: e.target.value })} placeholder="0" /></label>
              <label className="field control-modal-wide"><span>Descripción del remito</span><input required value={edicion.descripcion} onChange={(e) => setEdicion((actual) => actual && { ...actual, descripcion: e.target.value })} placeholder="Lo que figura en el remito" /></label>
            </div>
            {errorEdicion && <p className="form-alert error" role="alert">{errorEdicion}</p>}
            <div className="control-modal-actions"><button className="text-button" type="button" onClick={() => setEdicion(null)}>Cancelar</button><button className="secondary-button" type="submit">{edicion.clave ? "Aplicar cambios" : "Agregar renglón"}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
}
