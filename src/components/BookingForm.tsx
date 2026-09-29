"use client";

import { ClipboardEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { FRANJAS, fechaArgentina, textoFecha } from "@/lib/domain";
import { LecturaRemito, sugerirCodigo } from "@/lib/remito/parse";
import { obtenerSupabase, supabaseConfigurado } from "@/lib/supabase/client";

type DatosFormulario = {
  proveedor: string;
  cuitPrefijo: string;
  cuitNumero: string;
  cuitVerificador: string;
  email: string;
  ordenCompra: string;
  numeroRemito: string;
  fecha: string;
  hora: string;
  patente: string;
  transportista: string;
};

type Fase = "acceso" | "datos" | "horario";
type RespuestaAcceso = { razon_social: string };
type RespuestaReserva = {
  codigo: string;
  turno_id: string;
  confirmacion_token: string;
  upload: { path: string; token: string };
};
type RespuestaConfirmacion = { confirmado: boolean; retenido?: boolean; motivo?: string; email_enviado: boolean };
type LineaOc = { renglon: number; producto_codigo: string; descripcion_producto: string | null; cantidad_ordenada: number | string; cantidad_recibida: number | string };
type LineaDetectada = { renglonOc: number; cantidad: number; descripcion: string };
type EstadoAnalisis = "sin_archivo" | "analizando" | "aprobado" | "revision" | "exceso" | "error";

function numero(valor: string | number) { return Number(String(valor).replace(",", ".")); }
function normalizarRemito(valor: string) { return valor.match(/\d+/g)?.map((parte) => parte.replace(/^0+(?=\d)/, "")).join("-") ?? valor.trim().toUpperCase(); }

const fases: { clave: Fase; titulo: string; detalle: string }[] = [
  { clave: "acceso", titulo: "Validá tu acceso", detalle: "CUIT y orden de compra" },
  { clave: "datos", titulo: "Completá el remito", detalle: "Datos de la entrega" },
  { clave: "horario", titulo: "Elegí el turno", detalle: "Día y horario disponibles" },
];

const datosIniciales = (): DatosFormulario => ({
  proveedor: "",
  cuitPrefijo: "",
  cuitNumero: "",
  cuitVerificador: "",
  email: "",
  ordenCompra: "0008-",
  numeroRemito: "",
  fecha: fechaArgentina(),
  hora: "",
  patente: "",
  transportista: "",
});

function cuitCompleto(datos: DatosFormulario) {
  return `${datos.cuitPrefijo}${datos.cuitNumero}${datos.cuitVerificador}`;
}

function cuitFormateado(datos: DatosFormulario) {
  const valor = cuitCompleto(datos);
  return valor.length === 11 ? `${datos.cuitPrefijo}-${datos.cuitNumero}-${datos.cuitVerificador}` : "—";
}

function ResumenReserva({
  datos,
  fase,
  proveedorValidado,
  onEditarAcceso,
}: {
  datos: DatosFormulario;
  fase: Fase;
  proveedorValidado: string;
  onEditarAcceso: () => void;
}) {
  const indiceActivo = fases.findIndex((item) => item.clave === fase);

  return (
    <aside className="booking-intro booking-summary" aria-labelledby="titulo-reserva">
      <p className="eyebrow">Göttert · Portal de proveedores</p>
      <h1 id="titulo-reserva">Coordiná tu entrega.</h1>
      <p>Validá tu orden de compra, adjuntá el remito y elegí el horario que mejor te quede.</p>

      <ol className="info-list phase-list" aria-label="Fases de la reserva">
        {fases.map((item, indice) => {
          const completada = indice < indiceActivo;
          const activa = indice === indiceActivo;
          return (
            <li className={activa ? "active" : completada ? "complete" : ""} key={item.clave}>
              <b>{completada ? "✓" : indice + 1}</b>
              <span><strong>{item.titulo}</strong><small>{item.detalle}</small></span>
            </li>
          );
        })}
      </ol>

      <section className="booking-recap" aria-label="Resumen de la reserva">
        <p className="recap-title">Resumen</p>
        {proveedorValidado ? (
          <>
            <strong>{proveedorValidado}</strong>
            <span>CUIT {cuitFormateado(datos)}</span>
            <span>OC {datos.ordenCompra}</span>
            <button className="text-button" type="button" onClick={onEditarAcceso}>Cambiar acceso</button>
          </>
        ) : (
          <span>Validá tu CUIT y orden de compra para iniciar la reserva.</span>
        )}
        {datos.numeroRemito && <span>Remito {datos.numeroRemito}</span>}
        {datos.fecha && fase === "horario" && <span>Entrega {textoFecha(datos.fecha)}{datos.hora ? ` · ${datos.hora}` : ""}</span>}
      </section>
    </aside>
  );
}

export function BookingForm() {
  const [datos, setDatos] = useState<DatosFormulario>(datosIniciales);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [fase, setFase] = useState<Fase>("acceso");
  const [proveedorValidado, setProveedorValidado] = useState("");
  const [validandoAcceso, setValidandoAcceso] = useState(false);
  const [errorAcceso, setErrorAcceso] = useState("");
  const [errorDatos, setErrorDatos] = useState("");
  const [horarios, setHorarios] = useState<string[]>(FRANJAS);
  const [errorHorarios, setErrorHorarios] = useState("");
  const [estado, setEstado] = useState<"inicial" | "enviando" | "exito" | "error">("inicial");
  const [mensaje, setMensaje] = useState("");
  const [codigo, setCodigo] = useState("");
  const [lineasDetectadas, setLineasDetectadas] = useState<LineaDetectada[]>([]);
  const [lectura, setLectura] = useState<LecturaRemito | null>(null);
  const [estadoAnalisis, setEstadoAnalisis] = useState<EstadoAnalisis>("sin_archivo");
  const [progresoLectura, setProgresoLectura] = useState("");
  const [analisisIncompleto, setAnalisisIncompleto] = useState(false);
  const [retenido, setRetenido] = useState(false);
  const analisisVigente = useRef(0);

  const fechaLegible = useMemo(() => textoFecha(datos.fecha), [datos.fecha]);
  const numeroPendiente = !!lectura && (!lectura.numero || !datos.numeroRemito || normalizarRemito(lectura.numero) !== normalizarRemito(datos.numeroRemito));

  const actualizar = (campo: keyof DatosFormulario, valor: string) => {
    setDatos((anterior) => ({ ...anterior, [campo]: valor }));
    setErrorDatos("");
  };

  const actualizarCuit = (campo: "cuitPrefijo" | "cuitNumero" | "cuitVerificador", valor: string, maximo: number) => {
    actualizar(campo, valor.replace(/\D/g, "").slice(0, maximo));
  };

  const pegarCuit = (evento: ClipboardEvent<HTMLInputElement>) => {
    const cuit = evento.clipboardData.getData("text").replace(/\D/g, "");
    if (cuit.length !== 11) return;

    evento.preventDefault();
    setDatos((anterior) => ({
      ...anterior,
      cuitPrefijo: cuit.slice(0, 2),
      cuitNumero: cuit.slice(2, 10),
      cuitVerificador: cuit.slice(10),
    }));
    setErrorDatos("");
  };

  const actualizarOc = (valor: string) => {
    const sufijo = valor.replace(/\D/g, "").slice(0, 8);
    actualizar("ordenCompra", `0008-${sufijo}`);
  };

  const analizarRemito = async (seleccionado: File | null) => {
    const solicitud = ++analisisVigente.current;
    setArchivo(seleccionado);
    setFase("datos");
    setLectura(null);
    setLineasDetectadas([]);
    setAnalisisIncompleto(false);
    setErrorDatos("");
    if (!seleccionado) { setEstadoAnalisis("sin_archivo"); return; }
    if (seleccionado.size > 10 * 1024 * 1024) {
      setEstadoAnalisis("error");
      setErrorDatos("El archivo no puede superar 10 MB.");
      return;
    }
    setEstadoAnalisis("analizando");
    setProgresoLectura("Consultando los productos de la OC…");
    let detalleCargado = false;
    try {
      const supabase = obtenerSupabase();
      let lineas: LineaOc[] = [];
      if (supabase) {
        const { data, error } = await supabase.functions.invoke("crear-reserva", { body: {
          accion: "detalle_oc", cuit: cuitCompleto(datos), ordenCompra: datos.ordenCompra,
        } });
        if (error) throw new Error("No pudimos consultar los productos de la OC. Intentá nuevamente.");
        lineas = ((data as { lineas?: LineaOc[] } | null)?.lineas ?? []);
      }
      if (solicitud !== analisisVigente.current) return;
      detalleCargado = true;
      const { leerRemito } = await import("@/lib/remito/reader");
      const resultado = await leerRemito(seleccionado, (mensaje) => {
        if (solicitud === analisisVigente.current) setProgresoLectura(mensaje);
      });
      if (solicitud !== analisisVigente.current) return;
      setLectura(resultado);
      // A weak OCR result can suggest a wrong quantity. Send it for internal review instead.
      const lecturaConfiable = resultado.confianza >= 0.8;
      const detectadas: LineaDetectada[] = [];
      let pendientes = !lecturaConfiable || resultado.incompleto || resultado.renglones.length === 0 || lineas.length === 0;
      if (lecturaConfiable) for (const linea of resultado.renglones) {
        const sugerido = sugerirCodigo(linea.descripcion, lineas.map((oc) => ({ codigo: oc.producto_codigo, descripcion: oc.descripcion_producto })));
        const coincidencias = lineas.filter((oc) => oc.producto_codigo === sugerido);
        const cantidad = numero(linea.cantidad);
        if (coincidencias.length !== 1 || !Number.isFinite(cantidad) || cantidad <= 0) { pendientes = true; continue; }
        detectadas.push({ renglonOc: coincidencias[0].renglon, cantidad, descripcion: linea.descripcion });
      }
      setLineasDetectadas(detectadas);
      setAnalisisIncompleto(pendientes);
      const acumuladas = new Map<number, number>();
      for (const linea of detectadas) acumuladas.set(linea.renglonOc, (acumuladas.get(linea.renglonOc) ?? 0) + linea.cantidad);
      const exceso = lineas.some((oc) => acumuladas.has(oc.renglon) && numero(oc.cantidad_recibida) + (acumuladas.get(oc.renglon) ?? 0) > numero(oc.cantidad_ordenada) * 1.1 + 0.000001);
      setEstadoAnalisis(exceso ? "exceso" : pendientes ? "revision" : "aprobado");
    } catch {
      if (solicitud !== analisisVigente.current) return;
      setLectura(null);
      setLineasDetectadas([]);
      setAnalisisIncompleto(true);
      setEstadoAnalisis(detalleCargado ? "revision" : "error");
      if (!detalleCargado) setErrorDatos("No pudimos consultar la OC. Volvé a adjuntar el remito para intentar nuevamente.");
    } finally {
      if (solicitud === analisisVigente.current) setProgresoLectura("");
    }
  };

  useEffect(() => {
    if (fase !== "horario") return;

    const supabase = obtenerSupabase();
    if (!supabase) return;
    let vigente = true;
    void supabase.rpc("horarios_disponibles_publicos", { p_fecha: datos.fecha }).then(({ data, error }) => {
      if (!vigente) return;
      if (error) {
        setHorarios([]);
        setErrorHorarios("No pudimos consultar los horarios. Actualizá la página e intentá nuevamente.");
      } else {
        const disponibles = ((data ?? []) as { hora: string }[]).map((fila) => fila.hora);
        setHorarios(disponibles);
        setDatos((actuales) => disponibles.includes(actuales.hora) ? actuales : { ...actuales, hora: "" });
      }
    });
    return () => { vigente = false; };
  }, [datos.fecha, fase]);

  const validarAcceso = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setErrorAcceso("");
    setValidandoAcceso(true);

    try {
      const supabase = obtenerSupabase();
      if (!supabase) {
        setProveedorValidado("Proveedor de prueba");
        setFase("datos");
        return;
      }

      const { data, error } = await supabase.rpc("validar_acceso_reserva", {
        p_orden_compra: datos.ordenCompra,
        p_cuit: cuitCompleto(datos),
      });
      const respuesta = data as RespuestaAcceso[] | null;
      if (error || !respuesta?.[0]) {
        setErrorAcceso("No encontramos una orden de compra abierta para ese CUIT. Revisá los datos o consultá con recepción.");
        return;
      }

      setProveedorValidado(respuesta[0].razon_social);
      setFase("datos");
    } catch {
      setErrorAcceso("No pudimos validar los datos ahora. Probá nuevamente.");
    } finally {
      setValidandoAcceso(false);
    }
  };

  const continuarAHorarios = () => {
    if (!datos.email || !datos.numeroRemito || !archivo) {
      setErrorDatos("Completá el correo, el número de remito y adjuntá el archivo para continuar.");
      return;
    }
    if (estadoAnalisis === "exceso") {
      setErrorDatos("El remito supera el límite permitido de la OC. Consultá con recepción.");
      return;
    }
    if (estadoAnalisis !== "aprobado" && estadoAnalisis !== "revision") {
      setErrorDatos("Esperá a que termine el análisis del remito o volvé a adjuntarlo.");
      return;
    }
    setFase("horario");
  };

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (fase !== "horario" || !datos.hora) {
      setEstado("error");
      setMensaje("Elegí un horario disponible para continuar.");
      return;
    }
    if (estadoAnalisis !== "aprobado" && estadoAnalisis !== "revision") {
      setEstado("error");
      setMensaje("El remito todavía no está listo para reservar el turno.");
      return;
    }

    setEstado("enviando");
    setMensaje("");
    try {
      const supabase = obtenerSupabase();
      if (!supabase) {
        await new Promise((resolver) => window.setTimeout(resolver, 450));
        setCodigo("PRUEBA-0001");
        setEstado("exito");
        return;
      }
      if (!archivo) throw new Error("Adjuntá el remito para continuar.");

      const { data: respuesta, error } = await supabase.functions.invoke("crear-reserva", {
        body: {
          accion: "crear",
          proveedor: proveedorValidado,
          cuit: cuitCompleto(datos),
          email: datos.email,
          ordenCompra: datos.ordenCompra,
          numeroRemito: datos.numeroRemito,
          fecha: datos.fecha,
          hora: datos.hora,
          patente: datos.patente || null,
          transportista: datos.transportista || null,
          archivo: { nombre: archivo.name, tipo: archivo.type, bytes: archivo.size },
          lineasDeclaradas: lineasDetectadas,
          lecturaIncompleta: analisisIncompleto || !lectura || !lectura.numero || normalizarRemito(lectura.numero) !== normalizarRemito(datos.numeroRemito),
        },
      });
      const data = respuesta as RespuestaReserva | null;
      if (error || !data) {
        const contexto = (error as { context?: { clone?: () => Response } } | null)?.context;
        if (contexto?.clone) {
          const detalle = await contexto.clone().json().catch(() => null) as { error?: string } | null;
          if (detalle?.error) throw new Error(detalle.error);
        }
        throw new Error(error?.message || "No pudimos registrar el turno.");
      }

      if (!data.confirmacion_token || !data.upload?.path || !data.upload?.token) {
        throw new Error("La reserva no devolvió los datos necesarios para adjuntar el remito.");
      }
      setCodigo(data.codigo);
      const { error: errorArchivo } = await supabase.storage
        .from("remitos")
        .uploadToSignedUrl(data.upload.path, data.upload.token, archivo, { contentType: archivo.type });
      if (errorArchivo) {
        const { data: cancelacion, error: errorCancelacion } = await supabase.functions.invoke("crear-reserva", {
          body: { accion: "cancelar", turno_id: data.turno_id, token: data.confirmacion_token },
        });
        if (!errorCancelacion && (cancelacion as { cancelado?: boolean } | null)?.cancelado) {
          throw new Error("No pudimos adjuntar el remito. El horario quedó libre para que vuelvas a intentarlo.");
        }
        setMensaje("El turno quedó reservado, pero no pudimos adjuntar el remito. Comunicate con recepción e indicá el código.");
        setEstado("exito");
        return;
      }

      const { data: confirmacion, error: errorConfirmacion } = await supabase.functions.invoke("crear-reserva", {
        body: { accion: "confirmar", turno_id: data.turno_id, token: data.confirmacion_token },
      });
      const resultado = confirmacion as RespuestaConfirmacion | null;
      if (resultado?.retenido) {
        setRetenido(true);
        setMensaje(`Recepción debe revisar el remito antes de confirmar el turno.${resultado.email_enviado ? " Te enviamos un correo con la solicitud." : " Conservá el código de solicitud."}`);
      } else if (errorConfirmacion || !resultado?.confirmado) {
        setMensaje("El remito se adjuntó, pero no pudimos completar la confirmación. Comunicate con recepción e indicá el código.");
      } else if (!resultado.email_enviado) {
        setMensaje("El turno quedó confirmado, pero no pudimos enviar el correo. Conservá este código de reserva.");
      }

      setEstado("exito");
    } catch (error) {
      setEstado("error");
      setMensaje(error instanceof Error ? error.message : "No pudimos registrar el turno. Probá nuevamente.");
    }
  };

  const reiniciar = () => {
    analisisVigente.current += 1;
    setDatos(datosIniciales());
    setArchivo(null);
    setProveedorValidado("");
    setCodigo("");
    setLineasDetectadas([]);
    setLectura(null);
    setEstadoAnalisis("sin_archivo");
    setAnalisisIncompleto(false);
    setRetenido(false);
    setMensaje("");
    setEstado("inicial");
    setFase("acceso");
  };

  const editarAcceso = () => {
    analisisVigente.current += 1;
    setFase("acceso");
    setProveedorValidado("");
    setErrorAcceso("");
    setArchivo(null);
    setLineasDetectadas([]);
    setLectura(null);
    setEstadoAnalisis("sin_archivo");
    setAnalisisIncompleto(false);
  };

  return (
    <>
      <ResumenReserva datos={datos} fase={fase} proveedorValidado={proveedorValidado} onEditarAcceso={editarAcceso} />

      {estado === "exito" ? (
        <section className="booking-card confirmation" aria-live="polite">
          <p className="status-kicker">{retenido ? "Pendiente de revisión" : "Reserva registrada"}</p>
          <h2>{retenido ? "Recibimos tu solicitud" : "Tu turno quedó agendado"}</h2>
          <p className="confirmation-code">{codigo}</p>
          <div className="confirmation-details">
            <span>Proveedor</span><b>{proveedorValidado}</b>
            <span>Fecha</span><b>{fechaLegible}</b>
            <span>Horario</span><b>{datos.hora}</b>
            <span>Orden de compra</span><b>{datos.ordenCompra}</b>
            <span>Remito</span><b>{datos.numeroRemito}</b>
          </div>
          {mensaje && <p className="form-alert warning">{mensaje}</p>}
          {!supabaseConfigurado && <p className="form-alert info">Esta es una confirmación de demostración: todavía no guarda datos reales.</p>}
          <button className="secondary-button" type="button" onClick={reiniciar}>Reservar otro turno</button>
        </section>
      ) : fase === "acceso" ? (
        <section className="booking-card access-gate" aria-labelledby="acceso-reserva-titulo">
          <div className="form-heading">
            <div>
              <p className="eyebrow">Paso 1 de 3</p>
              <h2 id="acceso-reserva-titulo">Validá tu acceso</h2>
            </div>
            {!supabaseConfigurado && <span className="demo-badge">Vista de prueba</span>}
          </div>
          <p className="phase-description">Ingresá los datos tal como figuran en la orden de compra. Con eso habilitamos el resto del formulario.</p>
          {errorAcceso && <p className="form-alert error" role="alert">{errorAcceso}</p>}
          <form className="access-check-form" onSubmit={validarAcceso}>
            <label className="field">
              <span>CUIT</span>
              <span className="cuit-inputs">
                <input aria-label="Primeros dos dígitos del CUIT" required value={datos.cuitPrefijo} onChange={(e) => actualizarCuit("cuitPrefijo", e.target.value, 2)} onPaste={pegarCuit} placeholder="30" inputMode="numeric" maxLength={2} />
                <b aria-hidden="true">-</b>
                <input aria-label="Ocho dígitos centrales del CUIT" required value={datos.cuitNumero} onChange={(e) => actualizarCuit("cuitNumero", e.target.value, 8)} onPaste={pegarCuit} placeholder="12345678" inputMode="numeric" maxLength={8} />
                <b aria-hidden="true">-</b>
                <input aria-label="Dígito verificador del CUIT" required value={datos.cuitVerificador} onChange={(e) => actualizarCuit("cuitVerificador", e.target.value, 1)} onPaste={pegarCuit} placeholder="9" inputMode="numeric" maxLength={1} />
              </span>
            </label>
            <label className="field">
              <span>Orden de compra</span>
              <span className="oc-input"><b aria-hidden="true">0008-</b><input aria-label="Número de orden de compra luego del prefijo 0008" required value={datos.ordenCompra.replace(/^0008-/, "")} onChange={(e) => actualizarOc(e.target.value)} placeholder="00009258" inputMode="numeric" maxLength={8} /></span>
            </label>
            <button className="primary-button" disabled={validandoAcceso} type="submit">
              {validandoAcceso ? "Validando datos…" : "Continuar"}
            </button>
          </form>
        </section>
      ) : (
        <section className="booking-card" aria-labelledby="form-title">
          <div className="form-heading">
            <div>
              <p className="eyebrow">{fase === "datos" ? "Paso 2 de 3" : "Paso 3 de 3"}</p>
              <h2 id="form-title">{fase === "datos" ? "Datos de la entrega" : "Elegí el horario"}</h2>
            </div>
            <span className="provider-badge">{proveedorValidado}</span>
          </div>
          {estado === "error" && <p className="form-alert error" role="alert">{mensaje}</p>}

          <form onSubmit={enviar}>
            <section className="form-phase" aria-labelledby="datos-entrega-titulo">
              <div className="phase-heading">
                <div><b>2</b><span><strong id="datos-entrega-titulo">Datos del remito</strong><small>Completá la información de la entrega.</small></span></div>
                {fase === "horario" && <button className="text-button" type="button" onClick={() => setFase("datos")}>Editar</button>}
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Correo de contacto</span>
                  <input required type="email" value={datos.email} onChange={(e) => actualizar("email", e.target.value)} placeholder="nombre@empresa.com" />
                </label>
                <label className="field">
                  <span>Número de remito</span>
                  <input required value={datos.numeroRemito} onChange={(e) => actualizar("numeroRemito", e.target.value)} placeholder="0001-00001234" />
                </label>
                <label className="field form-wide">
                  <span>Remito en PDF o foto</span>
                  <input required type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => void analizarRemito(e.target.files?.[0] ?? null)} />
                  <small>{archivo ? archivo.name : "Hasta 10 MB."}</small>
                </label>
                <label className="field">
                  <span>Patente <em>opcional</em></span>
                  <input value={datos.patente} onChange={(e) => actualizar("patente", e.target.value)} placeholder="AB 123 CD" />
                </label>
                <label className="field">
                  <span>Transportista <em>opcional</em></span>
                  <input value={datos.transportista} onChange={(e) => actualizar("transportista", e.target.value)} placeholder="Nombre de la empresa transportista" />
                </label>
              </div>
              {fase === "datos" && archivo && <div className="booking-remito-status" aria-live="polite">
                {estadoAnalisis === "analizando" && <p className="form-alert info" role="status">{progresoLectura || "Analizando el remito…"}</p>}
                {estadoAnalisis === "aprobado" && !numeroPendiente && <p className="form-alert info" role="status">Remito analizado. Podés continuar.</p>}
                {(estadoAnalisis === "revision" || (estadoAnalisis === "aprobado" && numeroPendiente)) && <p className="form-alert warning" role="status">Remito cargado. Recepción revisará el archivo antes de confirmar el turno.</p>}
                {estadoAnalisis === "exceso" && <p className="form-alert error" role="alert">El remito supera el límite permitido de la OC. Consultá con recepción.</p>}
              </div>}
              {errorDatos && <p className="form-alert error phase-alert" role="alert">{errorDatos}</p>}
              {fase === "datos" && <button className="primary-button" type="button" disabled={estadoAnalisis === "analizando" || estadoAnalisis === "exceso" || estadoAnalisis === "error"} onClick={continuarAHorarios}>Continuar a elegir horario</button>}
            </section>

            <section className={`form-phase schedule-phase ${fase !== "horario" ? "locked" : ""}`} aria-labelledby="horario-entrega-titulo">
              <div className="phase-heading">
                <div><b>3</b><span><strong id="horario-entrega-titulo">Día y horario</strong><small>Elegí una franja disponible.</small></span></div>
              </div>
              {fase !== "horario" ? (
                <p className="locked-message">Completá primero los datos del remito para habilitar los horarios.</p>
              ) : (
                <div className="form-grid">
                  <label className="field">
                    <span>Día de entrega</span>
                    <input required type="date" min={fechaArgentina()} value={datos.fecha} onChange={(e) => actualizar("fecha", e.target.value)} />
                  </label>
                  <fieldset className="slots form-wide">
                    <legend>Horarios disponibles para el {fechaLegible}</legend>
                    <div className="slots-grid">
                      {horarios.map((hora) => (
                        <label className="slot" key={hora}>
                          <input type="radio" name="hora" value={hora} checked={datos.hora === hora} onChange={(e) => actualizar("hora", e.target.value)} />
                          <span>{hora}</span>
                        </label>
                      ))}
                    </div>
                    {errorHorarios && <p className="slots-message error-text">{errorHorarios}</p>}
                    {!errorHorarios && horarios.length === 0 && <p className="slots-message">No quedan horarios libres para ese día.</p>}
                  </fieldset>
                </div>
              )}
              {fase === "horario" && <button className="primary-button" disabled={estado === "enviando"} type="submit">{estado === "enviando" ? "Registrando turno…" : "Reservar turno"}</button>}
            </section>
          </form>
        </section>
      )}
    </>
  );
}
