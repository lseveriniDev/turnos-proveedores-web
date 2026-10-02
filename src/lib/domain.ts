export type EstadoTurno = "reservado" | "retenido" | "confirmado" | "en_planta" | "anulado";

export type TurnoAgenda = {
  id: string;
  codigo: string;
  hora: string;
  proveedor: string;
  ordenCompra: string;
  remito: string;
  rutaRemito?: string | null;
  archivoLegado?: boolean;
  tipoRemito?: string | null;
  motivoRevision?: string | null;
  lineasDeclaradas?: { renglonOc: number; cantidad: number; descripcion: string }[] | null;
  patente: string;
  estado: EstadoTurno;
};

export const FRANJAS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];

export const DEMO_AGENDA: TurnoAgenda[] = [
  {
    id: "demo-1",
    codigo: "TP-00024",
    hora: "09:00",
    proveedor: "Papelera del Sur S.A.",
    ordenCompra: "OC-004821",
    remito: "0003-00018472",
    patente: "AF 321 LM",
    estado: "confirmado",
  },
  {
    id: "demo-2",
    codigo: "TP-00025",
    hora: "11:00",
    proveedor: "Logística Andina SRL",
    ordenCompra: "OC-004829",
    remito: "0001-00009344",
    patente: "AE 572 PQ",
    estado: "reservado",
  },
  {
    id: "demo-3",
    codigo: "TP-00026",
    hora: "14:00",
    proveedor: "Química Central S.A.",
    ordenCompra: "OC-004836",
    remito: "0002-00006210",
    patente: "AG 849 TR",
    estado: "reservado",
  },
];

export function fechaArgentina(): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

export function textoFecha(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (!anio || !mes || !dia) return fecha;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(anio, mes - 1, dia, 12));
}
