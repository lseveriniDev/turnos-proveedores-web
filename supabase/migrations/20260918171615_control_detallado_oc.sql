-- Control detallado de recepciones: líneas importadas desde Summa y líneas
-- declaradas por recepción para comparar cantidades. No modifica turnos ni OCs existentes.

create table public.lineas_orden_compra (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete cascade,
  renglon integer not null check (renglon > 0),
  producto_codigo text not null,
  descripcion_producto text,
  unidad_medida text,
  moneda text,
  cantidad_ordenada numeric(14, 3) not null default 0 check (cantidad_ordenada >= 0),
  cantidad_recibida numeric(14, 3) not null default 0 check (cantidad_recibida >= 0),
  cantidad_pendiente numeric(14, 3) not null default 0 check (cantidad_pendiente >= 0),
  precio_unitario numeric(16, 4) check (precio_unitario is null or precio_unitario >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (orden_compra_id, renglon)
);

create index lineas_oc_producto_idx on public.lineas_orden_compra (orden_compra_id, producto_codigo);

create table public.lineas_remito (
  id uuid primary key default gen_random_uuid(),
  remito_id uuid not null references public.remitos(id) on delete cascade,
  renglon integer not null check (renglon > 0),
  producto_codigo text not null,
  descripcion_producto text,
  unidad_medida text,
  moneda text,
  cantidad numeric(14, 3) not null check (cantidad > 0),
  precio_unitario numeric(16, 4) check (precio_unitario is null or precio_unitario >= 0),
  created_at timestamptz not null default now(),
  unique (remito_id, renglon)
);

alter table public.lineas_orden_compra enable row level security;
alter table public.lineas_remito enable row level security;

revoke all on public.lineas_orden_compra, public.lineas_remito from anon, authenticated;
grant select, insert, update, delete on public.lineas_orden_compra, public.lineas_remito to authenticated;

create policy "Administradores gestionan lineas de OC" on public.lineas_orden_compra
for all to authenticated
using ((select public.es_administrador()))
with check ((select public.es_administrador()));

create policy "Administradores gestionan lineas de remito" on public.lineas_remito
for all to authenticated
using ((select public.es_administrador()))
with check ((select public.es_administrador()));

create trigger lineas_oc_actualizadas before update on public.lineas_orden_compra
for each row execute function public.actualizar_fecha_modificacion();
