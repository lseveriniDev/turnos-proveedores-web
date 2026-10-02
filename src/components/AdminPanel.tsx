"use client";

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";

import { CsvImporter } from "@/components/CsvImporter";
import { DEMO_AGENDA, EstadoTurno, FRANJAS, TurnoAgenda, fechaArgentina, textoFecha } from "@/lib/domain";
import { obtenerSupabase, supabaseConfigurado } from "@/lib/supabase/client";

type Modo = "acceso" | "demo" | "panel";
type LineaControl = { descripcion: string; cantidad: number; codigo?: string };
type ControlAbierto = { turnoId: string; lineas: LineaControl[]; cargando: boolean; error: string };

function formatoCantidad(valor: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(valor);
}

const etiquetaEstado: Record<EstadoTurno, string> = {
  reservado: "Reservado",
  retenido: "Pendiente de revisión",
  confirmado: "Confirmado",
  en_planta: "En planta",
  anulado: "Anulado",
};

async function consultarAgenda(fecha: string) {
  const supabase = obtenerSupabase();
  if (!supabase) return { agenda: null, tieneError: false };

  const inicio = `${fecha}T00:00:00-03:00`;
  const siguiente = new Date(`${fecha}T12:00:00-03:00`);
  siguiente.setDate(siguiente.getDate() + 1);
  const hasta = `${siguiente.getFullYear()}-${String(siguiente.getMonth() + 1).padStart(2, "0")}-${String(siguiente.getDate()).padStart(2, "0")}T00:00:00-03:00`;
  const { data, error } = await supabase
    .from("turnos")
    .select("id,codigo,inicio,estado,patente,proveedores(razon_social),ordenes_compra(numero),remitos(numero,storage_path,mime_type,motivo_revision,lineas_declaradas)")
    .gte("inicio", inicio)
    .lt("inicio", hasta)
    .order("inicio");

  if (error) return { agenda: null, tieneError: true };

  const agenda = (data ?? []).map((fila) => {
    const registro = fila as unknown as {
      id: string; codigo: string; inicio: string; estado: EstadoTurno; patente: string | null;
      proveedores: { razon_social: string } | null; ordenes_compra: { numero: string } | null;
      remitos: { numero: string; storage_path: string | null; mime_type: string | null; motivo_revision: string | null; lineas_declaradas: { renglonOc: number; cantidad: number; descripcion: string }[] | null }[] | { numero: string; storage_path: string | null; mime_type: string | null; motivo_revision: string | null; lineas_declaradas: { renglonOc: number; cantidad: number; descripcion: string }[] | null } | null;
    };
    const remito = Array.isArray(registro.remitos) ? registro.remitos[0] : registro.remitos;
    return {
      id: registro.id,
      codigo: registro.codigo,
      hora: new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(registro.inicio)),
      proveedor: registro.proveedores?.razon_social ?? "Proveedor",
      ordenCompra: registro.ordenes_compra?.numero ?? "—",
      remito: remito?.numero ?? "—",
      rutaRemito: remito?.storage_path ?? null,
      tipoRemito: remito?.mime_type ?? null,
      motivoRevision: remito?.motivo_revision ?? null,
      lineasDeclaradas: remito?.lineas_declaradas ?? null,
      patente: registro.patente ?? "—",
      estado: registro.estado,
    } satisfies TurnoAgenda;
  });
  return { agenda, tieneError: false };
}

export function AdminPanel() {
  const [modo, setModo] = useState<Modo>(supabaseConfigurado ? "acceso" : "demo");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [fecha, setFecha] = useState(fechaArgentina);
  const [turnos, setTurnos] = useState<TurnoAgenda[]>(DEMO_AGENDA);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [horaBloqueo, setHoraBloqueo] = useState("08:00");
  const [motivoBloqueo, setMotivoBloqueo] = useState("");
  const [controlAbierto, setControlAbierto] = useState<ControlAbierto | null>(null);
  const solicitudControl = useRef(0);
  const [vistaRemito, setVistaRemito] = useState<{ turno: TurnoAgenda; url: string } | null>(null);
  const [abriendoRemitoId, setAbriendoRemitoId] = useState<string | null>(null);

  const ocupados = useMemo(() => turnos.filter((turno) => turno.estado !== "anulado").length, [turnos]);
  const pendientes = useMemo(() => turnos.filter((turno) => turno.estado === "retenido").length, [turnos]);

  const informar = (texto: string, esError = false) => {
    setMensaje(esError ? "" : texto);
    setError(esError ? texto : "");
  };

  const cargarAgenda = async () => {
    const resultado = await consultarAgenda(fecha);
    if (resultado.tieneError) {
      setError("No pudimos cargar la agenda. Verificá que el usuario tenga acceso al panel.");
      return;
    }
    if (resultado.agenda) setTurnos(resultado.agenda);
    setError("");
  };

  useEffect(() => {
    if (modo !== "panel" || !supabaseConfigurado) return;
    let vigente = true;
    const actualizar = () => void consultarAgenda(fecha).then((resultado) => {
      if (!vigente) return;
      if (resultado.tieneError) {
        setError("No pudimos cargar la agenda. Verificá que el usuario tenga acceso al panel.");
        return;
      }
      if (resultado.agenda) setTurnos(resultado.agenda);
      setError("");
    });
    actualizar();
    const intervalo = window.setInterval(actualizar, 60 * 1000);
    return () => { vigente = false; window.clearInterval(intervalo); };
  }, [fecha, modo]);

  const ingresar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const supabase = obtenerSupabase();
    if (!supabase) {
      setModo("demo");
      return;
    }
    setError("");
    const { error: errorIngreso } = await supabase.auth.signInWithPassword({ email, password: clave });
    if (errorIngreso) {
      setError("No pudimos iniciar sesión. Revisá el correo y la contraseña.");
      return;
    }
    setModo("panel");
  };

  const cambiarEstado = async (id: string, estado: EstadoTurno) => {
    if (modo === "demo") {
      setTurnos((actuales) => actuales.map((turno) => turno.id === id ? { ...turno, estado } : turno));
      setMensaje(estado === "anulado" ? "Turno anulado y horario liberado." : "Turno marcado como en planta.");
      return;
    }
    const supabase = obtenerSupabase();
    if (!supabase) return;
    const { error: errorActualizacion } = await supabase.from("turnos").update({ estado }).eq("id", id);
    if (errorActualizacion) {
      setError("No pudimos actualizar el turno.");
      return;
    }
    setMensaje(estado === "anulado" ? "Turno anulado y horario liberado." : "Turno marcado como en planta.");
    await cargarAgenda();
  };

  const aprobarRetenido = async (turno: TurnoAgenda) => {
    if (!window.confirm(`¿Revisaste el archivo y las cantidades del remito ${turno.remito}? Al aprobarlo se enviará la confirmación al proveedor.`)) return;
    const supabase = obtenerSupabase();
    if (!supabase) return;
    const { data, error: errorAprobacion } = await supabase.functions.invoke("crear-reserva", {
      body: { accion: "aprobar", turno_id: turno.id },
    });
    if (errorAprobacion || !(data as { aprobado?: boolean } | null)?.aprobado) {
      setError("No pudimos aprobar el turno. Revisá el remito y volvé a intentar.");
      return;
    }
    setMensaje((data as { email_enviado?: boolean }).email_enviado ? "Turno aprobado y correo de confirmación enviado." : "Turno aprobado. El correo no pudo enviarse; informá al proveedor.");
    await cargarAgenda();
  };

  const verRemito = async (turno: TurnoAgenda) => {
    if (!turno.rutaRemito || modo === "demo") {
      setMensaje("En la vista de prueba el archivo de remito todavía no está disponible.");
      return;
    }
    const supabase = obtenerSupabase();
    if (!supabase) return;
    setAbriendoRemitoId(turno.id);
    const { data, error: errorUrl } = await supabase.storage.from("remitos").createSignedUrl(turno.rutaRemito, 300);
    setAbriendoRemitoId(null);
    if (errorUrl || !data) {
      setError("No pudimos preparar la vista previa del remito.");
      return;
    }
    setVistaRemito({ turno, url: data.signedUrl });
  };

  const alternarControl = async (turno: TurnoAgenda) => {
    const solicitud = ++solicitudControl.current;
    if (controlAbierto?.turnoId === turno.id) {
      setControlAbierto(null);
      return;
    }
    const detectadas = (turno.lineasDeclaradas ?? []).map((linea) => ({
      descripcion: linea.descripcion,
      cantidad: Number(linea.cantidad),
    }));
    if (detectadas.length || modo === "demo") {
      setControlAbierto({ turnoId: turno.id, lineas: detectadas, cargando: false, error: "" });
      return;
    }
    setControlAbierto({ turnoId: turno.id, lineas: [], cargando: true, error: "" });
    const supabase = obtenerSupabase();
    if (!supabase) {
      setControlAbierto({ turnoId: turno.id, lineas: [], cargando: false, error: "No pudimos cargar los productos del remito." });
      return;
    }
    const { data: remito, error: errorRemito } = await supabase.from("remitos").select("id").eq("turno_id", turno.id).maybeSingle();
    if (solicitud !== solicitudControl.current) return;
    if (errorRemito || !remito) {
      setControlAbierto({ turnoId: turno.id, lineas: [], cargando: false, error: "No pudimos cargar los productos del remito." });
      return;
    }
    const { data, error: errorLineas } = await supabase.from("lineas_remito")
      .select("descripcion_producto,producto_codigo,cantidad").eq("remito_id", remito.id).order("renglon");
    if (solicitud !== solicitudControl.current) return;
    setControlAbierto({
      turnoId: turno.id,
      lineas: (data ?? []).map((linea) => ({
        descripcion: linea.descripcion_producto || linea.producto_codigo,
        cantidad: Number(linea.cantidad),
        codigo: linea.producto_codigo,
      })),
      cargando: false,
      error: errorLineas ? "No pudimos cargar los productos del remito." : "",
    });
  };

  const bloquear = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!motivoBloqueo.trim()) {
      setError("Escribí el motivo del bloqueo.");
      return;
    }
    if (modo === "demo") {
      setMensaje(`${horaBloqueo} quedó bloqueado: ${motivoBloqueo}.`);
      setMotivoBloqueo("");
      return;
    }
    const supabase = obtenerSupabase();
    if (!supabase) return;
    const horaFinal = `${String(Number(horaBloqueo.slice(0, 2)) + 1).padStart(2, "0")}:00`;
    const { error: errorBloqueo } = await supabase.from("bloqueos").insert({
      desde: `${fecha}T${horaBloqueo}:00-03:00`,
      hasta: `${fecha}T${horaFinal}:00-03:00`,
      motivo: motivoBloqueo.trim(),
    });
    if (errorBloqueo) {
      setError("No pudimos bloquear ese horario. Puede que ya tenga un turno.");
      return;
    }
    setMensaje(`${horaBloqueo} quedó bloqueado.`);
    setMotivoBloqueo("");
  };

  if (modo === "acceso") {
    return (
      <section className="access-card" aria-labelledby="acceso-titulo">
        <p className="eyebrow">Acceso restringido</p>
        <h1 id="acceso-titulo">Panel de recepción</h1>
        <p>Ingresá con la cuenta habilitada para administrar la agenda.</p>
        {error && <p className="form-alert error" role="alert">{error}</p>}
        <form onSubmit={ingresar} className="access-form">
          <label className="field"><span>Correo</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span>Contraseña</span><input type="password" required value={clave} onChange={(e) => setClave(e.target.value)} /></label>
          <button className="primary-button" type="submit">Ingresar al panel</button>
        </form>
      </section>
    );
  }

  return (
    <section className="agenda" aria-labelledby="agenda-titulo">
      <div className="agenda-heading">
        <div>
          <p className="eyebrow">Operación diaria</p>
          <h1 id="agenda-titulo">Agenda de recepción</h1>
          <p>{ocupados} de {FRANJAS.length} horarios ocupados.</p>
          {pendientes > 0 && <p className="agenda-pending" role="status">{pendientes} turno{pendientes === 1 ? "" : "s"} pendiente{pendientes === 1 ? "" : "s"} de revisión para este día.</p>}
        </div>
        {modo === "demo" && <span className="demo-badge">Vista de prueba</span>}
      </div>

      {mensaje && <p className="form-alert success" role="status">{mensaje}</p>}
      {error && <p className="form-alert error" role="alert">{error}</p>}

      <div className="agenda-toolbar">
        <label className="field">
          <span>Día</span>
          <input type="date" min={fechaArgentina()} value={fecha} onChange={(e) => { solicitudControl.current += 1; setControlAbierto(null); setFecha(e.target.value); }} />
        </label>
        <p className="selected-date">{textoFecha(fecha)}</p>
        <form className="block-form" onSubmit={bloquear}>
          <select aria-label="Horario a bloquear" value={horaBloqueo} onChange={(e) => setHoraBloqueo(e.target.value)}>
            {FRANJAS.map((hora) => <option key={hora}>{hora}</option>)}
          </select>
          <input aria-label="Motivo del bloqueo" placeholder="Motivo del bloqueo" value={motivoBloqueo} onChange={(e) => setMotivoBloqueo(e.target.value)} />
          <button className="secondary-button" type="submit">Bloquear</button>
        </form>
      </div>

      <div className="agenda-table-wrap">
        <table>
          <thead><tr><th>Hora</th><th>Proveedor</th><th>OC / remito</th><th>Patente</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {FRANJAS.map((hora) => {
              const turno = turnos.find((item) => item.hora === hora && item.estado !== "anulado");
              if (!turno) {
                return <tr key={hora} className="free-slot"><td>{hora}</td><td colSpan={5}>Disponible</td></tr>;
              }
              return (
                <Fragment key={turno.id}>
                <tr>
                  <td className="mono">{turno.hora}</td>
                  <td><b>{turno.proveedor}</b><small>{turno.codigo}</small></td>
                  <td><span>{turno.ordenCompra}</span><small>{turno.remito}</small></td>
                  <td>{turno.patente}</td>
                  <td><span className={`status ${turno.estado}`}>{etiquetaEstado[turno.estado]}</span>{turno.estado === "retenido" && turno.motivoRevision && <small>{turno.motivoRevision}</small>}</td>
                  <td><div className="row-actions">
                    <button className="text-button" type="button" aria-expanded={controlAbierto?.turnoId === turno.id} aria-controls={`control-${turno.id}`} onClick={() => void alternarControl(turno)}>{controlAbierto?.turnoId === turno.id ? "Ocultar" : "Control"}</button>
                    <button className="text-button" disabled={abriendoRemitoId === turno.id} type="button" onClick={() => void verRemito(turno)}>{abriendoRemitoId === turno.id ? "Abriendo…" : "Ver remito"}</button>
                    {turno.estado === "retenido" && <button className="text-button" type="button" onClick={() => void aprobarRetenido(turno)}>Aprobar</button>}
                    {turno.estado !== "en_planta" && turno.estado !== "retenido" && <button className="text-button" type="button" onClick={() => void cambiarEstado(turno.id, "en_planta")}>Llegó</button>}
                    <button className="text-button danger" type="button" onClick={() => void cambiarEstado(turno.id, "anulado")}>Anular</button>
                  </div></td>
                </tr>
                {controlAbierto?.turnoId === turno.id && <tr className="agenda-control-row" id={`control-${turno.id}`}>
                  <td colSpan={6}>
                    <div className="agenda-control-detail">
                      <p>Productos del remito {turno.remito}</p>
                      {controlAbierto.cargando ? <span className="agenda-control-empty">Cargando productos…</span>
                        : controlAbierto.error ? <span className="agenda-control-empty" role="alert">{controlAbierto.error}</span>
                          : controlAbierto.lineas.length ? <ul>{controlAbierto.lineas.map((linea, indice) => <li key={indice}><span>{linea.descripcion}</span><b>{formatoCantidad(linea.cantidad)}</b></li>)}</ul>
                            : <span className="agenda-control-empty">No hay renglones reconocidos. Abrí el archivo desde «Ver remito» para consultar el original.</span>}
                    </div>
                  </td>
                </tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {vistaRemito && (
        <div className="remito-modal-backdrop" role="presentation" onMouseDown={() => setVistaRemito(null)}>
          <section className="remito-modal" role="dialog" aria-modal="true" aria-labelledby="vista-remito-titulo" onMouseDown={(evento) => evento.stopPropagation()}>
            <header className="remito-modal-heading">
              <div>
                <p className="eyebrow">Archivo adjunto</p>
                <h2 id="vista-remito-titulo">Remito {vistaRemito.turno.remito}</h2>
                <p>{vistaRemito.turno.proveedor} · {vistaRemito.turno.codigo}</p>
              </div>
              <button className="text-button" type="button" onClick={() => setVistaRemito(null)}>Cerrar</button>
            </header>
            <div className="remito-preview">
              {vistaRemito.turno.tipoRemito?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vistaRemito.url} alt={`Remito ${vistaRemito.turno.remito}`} />
              ) : vistaRemito.turno.tipoRemito === "application/pdf" || !vistaRemito.turno.tipoRemito ? (
                <iframe src={vistaRemito.url} title={`Vista previa del remito ${vistaRemito.turno.remito}`} />
              ) : (
                <div className="remito-preview-unsupported"><b>Este formato no admite vista previa en el navegador.</b><span>Podés abrir el archivo para verlo o descargarlo.</span></div>
              )}
            </div>
            {vistaRemito.turno.estado === "retenido" && <div className="remito-review-detail">
              <b>Motivo de revisión</b>
              <p>{vistaRemito.turno.motivoRevision}</p>
              {!!vistaRemito.turno.lineasDeclaradas?.length && <ul>{vistaRemito.turno.lineasDeclaradas.map((linea, indice) => <li key={indice}>Renglón OC {linea.renglonOc} · {linea.cantidad} · {linea.descripcion}</li>)}</ul>}
              <p>Compará estos datos con el archivo antes de aprobar el turno.</p>
            </div>}
            <footer className="remito-modal-actions">
              <span>El acceso vence en 5 minutos.</span>
              <a className="secondary-button" href={vistaRemito.url} target="_blank" rel="noreferrer">Abrir archivo</a>
            </footer>
          </section>
        </div>
      )}
      <CsvImporter modoDemo={modo === "demo"} informar={informar} />
      <p className="agenda-footnote">Los enlaces de remito son privados y vencen a los cinco minutos: solo los ve el equipo habilitado.</p>
    </section>
  );
}
