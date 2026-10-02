"use client";

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";

import { CsvImporter } from "@/components/CsvImporter";
import { DEMO_AGENDA, EstadoTurno, FRANJAS, TurnoAgenda, fechaArgentina, textoFecha } from "@/lib/domain";
import { apiConfigurada, apiJson, apiRemito, usuarioActual } from "@/lib/api";

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
  try {
    const { agenda: rows } = await apiJson<{ agenda: {
      id: string; codigo: string; inicio: string; hora: string; estado: EstadoTurno;
      proveedor_nombre: string; orden_compra: string; patente: string | null;
      remito?: { numero: string; sharepoint_item_id?: string | null; legacy_storage_path?: string | null; mime_type?: string | null;
        motivo_revision?: string | null; lineas_declaradas?: { renglonOc: number; cantidad: number; descripcion: string }[] | null };
    }[] }>(`admin/agenda?fecha=${encodeURIComponent(fecha)}`);
    const agenda = rows.map((registro) => {
    const remito = registro.remito;
    return {
      id: registro.id,
      codigo: registro.codigo,
      hora: registro.hora,
      proveedor: registro.proveedor_nombre ?? "Proveedor",
      ordenCompra: registro.orden_compra ?? "—",
      remito: remito?.numero ?? "—",
      rutaRemito: remito?.sharepoint_item_id ?? null,
      archivoLegado: Boolean(remito?.legacy_storage_path),
      tipoRemito: remito?.mime_type ?? null,
      motivoRevision: remito?.motivo_revision ?? null,
      lineasDeclaradas: remito?.lineas_declaradas ?? null,
      patente: registro.patente ?? "—",
      estado: registro.estado,
    } satisfies TurnoAgenda;
  });
    return { agenda, error: null };
  } catch (error) {
    const base = error instanceof Error ? error.message : "No pudimos cargar la agenda.";
    try {
      const diagnostico = await apiJson<{ autorizado: boolean; cuenta?: string; motivo?: string; version?: string }>("admin/health");
      return { agenda: null, error: diagnostico.autorizado
        ? `${base} (acceso al servidor confirmado)`
        : `${base} (${diagnostico.motivo || "sesión no validada por el servidor"}${diagnostico.cuenta ? `: ${diagnostico.cuenta}` : ""})` };
    } catch {
      return { agenda: null, error: `${base} (la comprobación del servidor también falló)` };
    }
  }
}

export function AdminPanel() {
  const [modo, setModo] = useState<Modo>(apiConfigurada ? "acceso" : "demo");
  const [cuenta, setCuenta] = useState<string | null>(null);
  const [fecha, setFecha] = useState(fechaArgentina);
  const [turnos, setTurnos] = useState<TurnoAgenda[]>(apiConfigurada ? [] : DEMO_AGENDA);
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

  useEffect(() => {
    void usuarioActual().then((user) => { if (user) { setCuenta(user.userDetails); setModo("panel"); } }).catch(() => {});
  }, []);

  const informar = (texto: string, esError = false) => {
    setMensaje(esError ? "" : texto);
    setError(esError ? texto : "");
  };

  const cargarAgenda = async () => {
    const resultado = await consultarAgenda(fecha);
    if (resultado.error) {
      setError(resultado.error);
      return;
    }
    if (resultado.agenda) setTurnos(resultado.agenda);
    setError("");
  };

  useEffect(() => {
    if (modo !== "panel" || !apiConfigurada) return;
    let vigente = true;
    let reintento: number | null = null;
    const actualizar = (reintentar = true): void => { void consultarAgenda(fecha).then((resultado) => {
      if (!vigente) return;
      if (resultado.error) {
        if (reintentar) {
          reintento = window.setTimeout(() => actualizar(false), 1500);
          return;
        }
        setError(resultado.error);
        return;
      }
      if (resultado.agenda) setTurnos(resultado.agenda);
      setError("");
    }); };
    actualizar();
    const intervalo = window.setInterval(() => actualizar(), 60 * 1000);
    return () => { vigente = false; window.clearInterval(intervalo); if (reintento !== null) window.clearTimeout(reintento); };
  }, [fecha, modo]);

  const cambiarEstado = async (id: string, estado: EstadoTurno) => {
    if (modo === "demo") {
      setTurnos((actuales) => actuales.map((turno) => turno.id === id ? { ...turno, estado } : turno));
      setMensaje(estado === "anulado" ? "Turno anulado y horario liberado." : "Turno marcado como en planta.");
      return;
    }
    try { await apiJson("admin/turno", { method: "POST", body: JSON.stringify({ id, estado }) }); }
    catch {
      setError("No pudimos actualizar el turno.");
      return;
    }
    setMensaje(estado === "anulado" ? "Turno anulado y horario liberado." : "Turno marcado como en planta.");
    await cargarAgenda();
  };

  const aprobarRetenido = async (turno: TurnoAgenda) => {
    if (!window.confirm(`¿Revisaste el archivo y las cantidades del remito ${turno.remito}? Al aprobarlo se enviará la confirmación al proveedor.`)) return;
    let data: { aprobado: boolean; email_enviado: boolean };
    try { data = await apiJson("admin/approve", { method: "POST", body: JSON.stringify({ id: turno.id }) }); }
    catch {
      setError("No pudimos aprobar el turno. Revisá el remito y volvé a intentar.");
      return;
    }
    setMensaje(data.email_enviado ? "Turno aprobado y correo de confirmación enviado." : "Turno aprobado. El correo no pudo enviarse; informá al proveedor.");
    await cargarAgenda();
  };

  const verRemito = async (turno: TurnoAgenda) => {
    if (!turno.rutaRemito && turno.archivoLegado && modo === "panel") {
      window.open("https://turnos-proveedores-gottert.pages.dev/panel/", "_blank", "noopener,noreferrer");
      setMensaje(`El archivo histórico de ${turno.codigo} sigue en el panel anterior. Seleccioná allí el día ${fecha}.`);
      return;
    }
    if (!turno.rutaRemito || modo === "demo") {
      setMensaje("En la vista de prueba el archivo de remito todavía no está disponible.");
      return;
    }
    setAbriendoRemitoId(turno.id);
    try {
      const blob = await apiRemito(turno.id);
      if (vistaRemito) URL.revokeObjectURL(vistaRemito.url);
      setVistaRemito({ turno, url: URL.createObjectURL(blob) });
    } catch (error) {
      setError(error instanceof Error ? error.message : "No pudimos preparar la vista previa del remito.");
    } finally { setAbriendoRemitoId(null); }
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
    const data = await apiJson<{ lineas: { descripcion_producto: string; producto_codigo: string; cantidad: number }[] }>(`admin/control?id=${encodeURIComponent(turno.id)}`).catch(() => null);
    if (solicitud !== solicitudControl.current) return;
    setControlAbierto({
      turnoId: turno.id,
      lineas: (data?.lineas ?? []).map((linea) => ({
        descripcion: linea.descripcion_producto || linea.producto_codigo,
        cantidad: Number(linea.cantidad),
        codigo: linea.producto_codigo,
      })),
      cargando: false,
      error: data ? "" : "No pudimos cargar los productos del remito.",
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
    try { await apiJson("admin/block", { method: "POST", body: JSON.stringify({ fecha, hora: horaBloqueo, motivo: motivoBloqueo.trim() }) }); }
    catch {
      setError("No pudimos bloquear ese horario. Puede que ya tenga un turno.");
      return;
    }
    setMensaje(`${horaBloqueo} quedó bloqueado.`);
    setMotivoBloqueo("");
  };

  const descargarRespaldo = async () => {
    try {
      const respuesta = await fetch("/api/admin/backup", { cache: "no-store" });
      if (!respuesta.ok) throw new Error("No pudimos descargar el respaldo.");
      const url = URL.createObjectURL(await respuesta.blob());
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `turnos-proveedores-${fechaArgentina()}.json`;
      enlace.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setError("No pudimos descargar el respaldo."); }
  };

  if (modo === "acceso") {
    return (
      <section className="access-card" aria-labelledby="acceso-titulo">
        <p className="eyebrow">Acceso restringido</p>
        <h1 id="acceso-titulo">Panel de recepción</h1>
        <p>Ingresá con tu cuenta Microsoft 365 habilitada para administrar la agenda.</p>
        {error && <p className="form-alert error" role="alert">{error}</p>}
        <a className="primary-button" href="/.auth/login/aad?post_login_redirect_uri=/panel/">Ingresar con Microsoft 365</a>
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
          {cuenta && <p className="session-account">Sesión: {cuenta} · <a href="/.auth/logout?post_logout_redirect_uri=/panel/">Cambiar cuenta</a></p>}
          {pendientes > 0 && <p className="agenda-pending" role="status">{pendientes} turno{pendientes === 1 ? "" : "s"} pendiente{pendientes === 1 ? "" : "s"} de revisión para este día.</p>}
        </div>
        {modo === "demo" ? <span className="demo-badge">Vista de prueba</span> :
          <button className="text-button" type="button" onClick={() => void descargarRespaldo()}>Descargar respaldo</button>}
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
                    <button className="text-button" disabled={abriendoRemitoId === turno.id} type="button" onClick={() => void verRemito(turno)}>{abriendoRemitoId === turno.id ? "Abriendo…" : turno.archivoLegado && !turno.rutaRemito ? "Ver en portal anterior" : "Ver remito"}</button>
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
        <div className="remito-modal-backdrop" role="presentation" onMouseDown={() => { URL.revokeObjectURL(vistaRemito.url); setVistaRemito(null); }}>
          <section className="remito-modal" role="dialog" aria-modal="true" aria-labelledby="vista-remito-titulo" onMouseDown={(evento) => evento.stopPropagation()}>
            <header className="remito-modal-heading">
              <div>
                <p className="eyebrow">Archivo adjunto</p>
                <h2 id="vista-remito-titulo">Remito {vistaRemito.turno.remito}</h2>
                <p>{vistaRemito.turno.proveedor} · {vistaRemito.turno.codigo}</p>
              </div>
              <button className="text-button" type="button" onClick={() => { URL.revokeObjectURL(vistaRemito.url); setVistaRemito(null); }}>Cerrar</button>
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
              <span>Archivo privado para recepción.</span>
              <a className="secondary-button" href={vistaRemito.url} target="_blank" rel="noreferrer">Abrir archivo</a>
            </footer>
          </section>
        </div>
      )}
      <CsvImporter modoDemo={modo === "demo"} informar={informar} />
      <p className="agenda-footnote">Los archivos de remito son privados: solo los ve el equipo habilitado.</p>
    </section>
  );
}
