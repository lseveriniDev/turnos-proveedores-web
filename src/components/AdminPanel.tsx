"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { CsvImporter } from "@/components/CsvImporter";
import { DEMO_AGENDA, EstadoTurno, FRANJAS, TurnoAgenda, fechaArgentina, textoFecha } from "@/lib/domain";
import { obtenerSupabase, supabaseConfigurado } from "@/lib/supabase/client";

type Modo = "acceso" | "demo" | "panel";

const etiquetaEstado: Record<EstadoTurno, string> = {
  reservado: "Reservado",
  confirmado: "Confirmado",
  en_planta: "En planta",
  anulado: "Anulado",
};

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

  const ocupados = useMemo(() => turnos.filter((turno) => turno.estado !== "anulado").length, [turnos]);

  const informar = (texto: string, esError = false) => {
    setMensaje(esError ? "" : texto);
    setError(esError ? texto : "");
  };

  useEffect(() => {
    if (modo !== "panel" || !supabaseConfigurado) return;
    void cargarAgenda();
    // Solo vuelve a consultar cuando cambia el día o se accede al panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, modo]);

  const cargarAgenda = async () => {
    const supabase = obtenerSupabase();
    if (!supabase) return;
    const inicio = `${fecha}T00:00:00-03:00`;
    const siguiente = new Date(`${fecha}T12:00:00-03:00`);
    siguiente.setDate(siguiente.getDate() + 1);
    const hasta = `${siguiente.getFullYear()}-${String(siguiente.getMonth() + 1).padStart(2, "0")}-${String(siguiente.getDate()).padStart(2, "0")}T00:00:00-03:00`;
    const { data, error: errorConsulta } = await supabase
      .from("turnos")
      .select("id,codigo,inicio,estado,patente,proveedores(razon_social),ordenes_compra(numero),remitos(numero)")
      .gte("inicio", inicio)
      .lt("inicio", hasta)
      .order("inicio");

    if (errorConsulta) {
      setError("No pudimos cargar la agenda. Verificá que el usuario tenga acceso al panel.");
      return;
    }

    const agenda = (data ?? []).map((fila) => {
      const registro = fila as unknown as {
        id: string; codigo: string; inicio: string; estado: EstadoTurno; patente: string | null;
        proveedores: { razon_social: string } | null; ordenes_compra: { numero: string } | null;
        remitos: { numero: string; storage_path: string | null }[] | { numero: string; storage_path: string | null } | null;
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
        patente: registro.patente ?? "—",
        estado: registro.estado,
      } satisfies TurnoAgenda;
    });
    setTurnos(agenda);
    setError("");
  };

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

  const abrirRemito = async (turno: TurnoAgenda) => {
    if (!turno.rutaRemito || modo === "demo") {
      setMensaje("En la vista de prueba el archivo de remito todavía no está disponible.");
      return;
    }
    const supabase = obtenerSupabase();
    if (!supabase) return;
    const { data, error: errorUrl } = await supabase.storage.from("remitos").createSignedUrl(turno.rutaRemito, 60);
    if (errorUrl || !data) {
      setError("No pudimos abrir el remito.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
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
        </div>
        {modo === "demo" && <span className="demo-badge">Vista de prueba</span>}
      </div>

      {mensaje && <p className="form-alert success" role="status">{mensaje}</p>}
      {error && <p className="form-alert error" role="alert">{error}</p>}

      <div className="agenda-toolbar">
        <label className="field">
          <span>Día</span>
          <input type="date" min={fechaArgentina()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
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
              const turno = turnos.find((item) => item.hora === hora);
              if (!turno || turno.estado === "anulado") {
                return <tr key={hora} className="free-slot"><td>{hora}</td><td colSpan={5}>Disponible</td></tr>;
              }
              return (
                <tr key={turno.id}>
                  <td className="mono">{turno.hora}</td>
                  <td><b>{turno.proveedor}</b><small>{turno.codigo}</small></td>
                  <td><span>{turno.ordenCompra}</span><small>{turno.remito}</small></td>
                  <td>{turno.patente}</td>
                  <td><span className={`status ${turno.estado}`}>{etiquetaEstado[turno.estado]}</span></td>
                  <td><div className="row-actions">
                    <button className="text-button" type="button" onClick={() => void abrirRemito(turno)}>Remito</button>
                    {turno.estado !== "en_planta" && <button className="text-button" type="button" onClick={() => void cambiarEstado(turno.id, "en_planta")}>Llegó</button>}
                    <button className="text-button danger" type="button" onClick={() => void cambiarEstado(turno.id, "anulado")}>Anular</button>
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CsvImporter modoDemo={modo === "demo"} informar={informar} />
      <p className="agenda-footnote">Los enlaces de remito son privados y vencen al minuto: solo los ve el equipo habilitado.</p>
    </section>
  );
}
