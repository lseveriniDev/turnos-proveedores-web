"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { FRANJAS, fechaArgentina, textoFecha } from "@/lib/domain";
import { obtenerSupabase, supabaseConfigurado } from "@/lib/supabase/client";

type DatosFormulario = {
  proveedor: string;
  cuit: string;
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
type RespuestaReserva = { codigo: string; turno_id: string };

const fases: { clave: Fase; titulo: string; detalle: string }[] = [
  { clave: "acceso", titulo: "Validá tu acceso", detalle: "CUIT y orden de compra" },
  { clave: "datos", titulo: "Completá el remito", detalle: "Datos de la entrega" },
  { clave: "horario", titulo: "Elegí el turno", detalle: "Día y horario disponibles" },
];

const datosIniciales = (): DatosFormulario => ({
  proveedor: "",
  cuit: "",
  email: "",
  ordenCompra: "",
  numeroRemito: "",
  fecha: fechaArgentina(),
  hora: "",
  patente: "",
  transportista: "",
});

function rutaSeguraDelRemito(archivo: File) {
  const nombre = archivo.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100) || "remito";

  return `turnos/${crypto.randomUUID()}/${nombre}`;
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
      <p className="eyebrow">Recepción de mercadería</p>
      <h1 id="titulo-reserva">Tu turno de entrega</h1>
      <p>Completá el circuito en orden. Tus datos quedan resumidos acá mientras avanzás.</p>

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
            <span>CUIT {datos.cuit}</span>
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
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  const [errorHorarios, setErrorHorarios] = useState("");
  const [estado, setEstado] = useState<"inicial" | "enviando" | "exito" | "error">("inicial");
  const [mensaje, setMensaje] = useState("");
  const [codigo, setCodigo] = useState("");

  const fechaLegible = useMemo(() => textoFecha(datos.fecha), [datos.fecha]);

  const actualizar = (campo: keyof DatosFormulario, valor: string) => {
    setDatos((anterior) => ({ ...anterior, [campo]: valor }));
    setErrorDatos("");
  };

  useEffect(() => {
    if (fase !== "horario") return;

    const supabase = obtenerSupabase();
    if (!supabase) {
      setHorarios(FRANJAS);
      setErrorHorarios("");
      return;
    }
    let vigente = true;
    setCargandoHorarios(true);
    setErrorHorarios("");
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
      setCargandoHorarios(false);
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
        p_cuit: datos.cuit,
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
    setFase("horario");
  };

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (fase !== "horario" || !datos.hora) {
      setEstado("error");
      setMensaje("Elegí un horario disponible para continuar.");
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

      const rutaArchivo = rutaSeguraDelRemito(archivo);
      const { data: respuesta, error } = await supabase.rpc("crear_turno_publico", {
        p_orden_compra: datos.ordenCompra,
        p_cuit: datos.cuit,
        p_email: datos.email,
        p_numero_remito: datos.numeroRemito,
        p_fecha: datos.fecha,
        p_hora: datos.hora,
        p_patente: datos.patente || null,
        p_transportista: datos.transportista || null,
        p_archivo_path: rutaArchivo,
        p_archivo_mime: archivo.type,
        p_archivo_bytes: archivo.size,
      });
      const data = respuesta as RespuestaReserva | null;
      if (error || !data) throw new Error(error?.message || "No pudimos registrar el turno.");

      const { error: errorArchivo } = await supabase.storage
        .from("remitos")
        .upload(rutaArchivo, archivo, { contentType: archivo.type, upsert: false });
      if (errorArchivo) {
        setMensaje("El turno quedó reservado, pero no pudimos adjuntar el archivo. Avisanos antes de la entrega.");
      }

      setCodigo(data.codigo);
      setEstado("exito");
    } catch (error) {
      setEstado("error");
      setMensaje(error instanceof Error ? error.message : "No pudimos registrar el turno. Probá nuevamente.");
    }
  };

  const reiniciar = () => {
    setDatos(datosIniciales());
    setArchivo(null);
    setProveedorValidado("");
    setCodigo("");
    setMensaje("");
    setEstado("inicial");
    setFase("acceso");
  };

  const editarAcceso = () => {
    setFase("acceso");
    setProveedorValidado("");
    setErrorAcceso("");
  };

  return (
    <>
      <ResumenReserva datos={datos} fase={fase} proveedorValidado={proveedorValidado} onEditarAcceso={editarAcceso} />

      {estado === "exito" ? (
        <section className="booking-card confirmation" aria-live="polite">
          <p className="status-kicker">Reserva registrada</p>
          <h2>Tu turno quedó agendado</h2>
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
              <input required value={datos.cuit} onChange={(e) => actualizar("cuit", e.target.value)} placeholder="30-12345678-9" inputMode="numeric" />
            </label>
            <label className="field">
              <span>Orden de compra</span>
              <input required value={datos.ordenCompra} onChange={(e) => actualizar("ordenCompra", e.target.value)} placeholder="OC-000123" />
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
                  <input required type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setErrorDatos(""); }} />
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
              {errorDatos && <p className="form-alert error phase-alert" role="alert">{errorDatos}</p>}
              {fase === "datos" && <button className="primary-button" type="button" onClick={continuarAHorarios}>Continuar a elegir horario</button>}
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
                    {cargandoHorarios && <p className="slots-message">Buscando horarios disponibles…</p>}
                    {!cargandoHorarios && errorHorarios && <p className="slots-message error-text">{errorHorarios}</p>}
                    {!cargandoHorarios && !errorHorarios && horarios.length === 0 && <p className="slots-message">No quedan horarios libres para ese día.</p>}
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
