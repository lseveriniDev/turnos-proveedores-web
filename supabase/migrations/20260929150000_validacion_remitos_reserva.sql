-- Conserva la lectura revisada por el proveedor y separa turnos retenidos.
alter type public.estado_turno add value if not exists 'retenido';

alter table public.remitos
  add column if not exists lineas_declaradas jsonb,
  add column if not exists motivo_revision text;

