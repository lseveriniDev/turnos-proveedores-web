-- Base inicial del piloto de turnos.
-- Se aplica desde Supabase > SQL Editor cuando esté creado el proyecto.

create extension if not exists pgcrypto;

create type public.estado_turno as enum ('reservado', 'confirmado', 'en_planta', 'anulado');
create type public.estado_orden_compra as enum ('abierta', 'cerrada');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('administrador')),
  created_at timestamptz not null default now()
);

create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  codigo_externo text unique,
  razon_social text not null,
  cuit text not null unique check (cuit ~ '^[0-9]{2}-[0-9]{8}-[0-9]$'),
  email text,
  habilitado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  estado public.estado_orden_compra not null default 'abierta',
  fecha date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.configuracion (
  id boolean primary key default true check (id),
  hora_apertura time not null default '08:00',
  hora_cierre time not null default '17:00',
  anticipacion_minutos integer not null default 120 check (anticipacion_minutos >= 0),
  max_turnos_abiertos integer not null default 3 check (max_turnos_abiertos > 0),
  zona_horaria text not null default 'America/Argentina/Buenos_Aires',
  updated_at timestamptz not null default now()
);

insert into public.configuracion (id) values (true) on conflict (id) do nothing;

create sequence public.turno_codigo_seq;

create table public.turnos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('TP-' || lpad(nextval('public.turno_codigo_seq')::text, 5, '0')),
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete restrict,
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  inicio timestamptz not null,
  estado public.estado_turno not null default 'reservado',
  email_contacto text not null,
  patente text,
  transportista text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index turnos_inicio_activo_unico on public.turnos (inicio) where estado <> 'anulado';
create index turnos_proveedor_activos on public.turnos (proveedor_id, inicio) where estado in ('reservado', 'confirmado');

create table public.remitos (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null unique references public.turnos(id) on delete cascade,
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  numero text not null,
  storage_path text,
  mime_type text,
  bytes bigint,
  created_at timestamptz not null default now(),
  unique (proveedor_id, numero)
);

create table public.bloqueos (
  id uuid primary key default gen_random_uuid(),
  desde timestamptz not null,
  hasta timestamptz not null,
  motivo text not null,
  created_at timestamptz not null default now(),
  check (hasta > desde)
);

create or replace function public.actualizar_fecha_modificacion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger proveedores_actualizados before update on public.proveedores
for each row execute function public.actualizar_fecha_modificacion();
create trigger ordenes_actualizadas before update on public.ordenes_compra
for each row execute function public.actualizar_fecha_modificacion();
create trigger turnos_actualizados before update on public.turnos
for each row execute function public.actualizar_fecha_modificacion();
create trigger configuracion_actualizada before update on public.configuracion
for each row execute function public.actualizar_fecha_modificacion();

create or replace function public.normalizar_cuit(valor text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when length(regexp_replace(coalesce(valor, ''), '\D', '', 'g')) = 11 then
      substring(regexp_replace(valor, '\D', '', 'g') from 1 for 2) || '-' ||
      substring(regexp_replace(valor, '\D', '', 'g') from 3 for 8) || '-' ||
      substring(regexp_replace(valor, '\D', '', 'g') from 11 for 1)
    else null
  end;
$$;

create or replace function public.es_administrador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and rol = 'administrador'
  );
$$;

create or replace function public.crear_turno_publico(
  p_orden_compra text,
  p_cuit text,
  p_email text,
  p_numero_remito text,
  p_fecha date,
  p_hora time,
  p_patente text default null,
  p_transportista text default null,
  p_archivo_path text default null,
  p_archivo_mime text default null,
  p_archivo_bytes bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inicio timestamptz;
  v_hora_apertura time;
  v_hora_cierre time;
  v_anticipacion integer;
  v_max_abiertos integer;
  v_cuit text;
  v_oc_id uuid;
  v_proveedor_id uuid;
  v_turno_id uuid;
  v_codigo text;
begin
  if trim(coalesce(p_email, '')) = '' or position('@' in p_email) = 0 then
    raise exception 'Ingresá un correo de contacto válido.';
  end if;
  if trim(coalesce(p_numero_remito, '')) = '' then
    raise exception 'Ingresá el número de remito.';
  end if;
  if p_fecha < (now() at time zone 'America/Argentina/Buenos_Aires')::date
     or extract(isodow from p_fecha) > 5 then
    raise exception 'Solo se pueden reservar días hábiles futuros.';
  end if;

  select hora_apertura, hora_cierre, anticipacion_minutos, max_turnos_abiertos
    into v_hora_apertura, v_hora_cierre, v_anticipacion, v_max_abiertos
  from public.configuracion where id = true;

  if p_hora < v_hora_apertura or p_hora >= v_hora_cierre
     or extract(minute from p_hora) <> 0 or extract(second from p_hora) <> 0 then
    raise exception 'El horario elegido no está disponible.';
  end if;

  v_inicio := (p_fecha + p_hora) at time zone 'America/Argentina/Buenos_Aires';
  if v_inicio <= now() + make_interval(mins => v_anticipacion) then
    raise exception 'Reservá con la anticipación mínima requerida.';
  end if;
  if exists (select 1 from public.bloqueos where v_inicio >= desde and v_inicio < hasta) then
    raise exception 'Ese horario está bloqueado. Elegí otro.';
  end if;

  v_cuit := public.normalizar_cuit(p_cuit);
  if v_cuit is null then
    raise exception 'El CUIT no tiene un formato válido.';
  end if;

  select oc.id, p.id into v_oc_id, v_proveedor_id
  from public.ordenes_compra oc
  join public.proveedores p on p.id = oc.proveedor_id
  where upper(trim(oc.numero)) = upper(trim(p_orden_compra))
    and p.cuit = v_cuit
    and p.habilitado
    and oc.estado = 'abierta';

  if v_oc_id is null then
    raise exception 'No encontramos una orden abierta para esa combinación de OC y CUIT.';
  end if;
  if (select count(*) from public.turnos
      where proveedor_id = v_proveedor_id
        and estado in ('reservado', 'confirmado')
        and inicio > now()) >= v_max_abiertos then
    raise exception 'Este proveedor ya alcanzó el máximo de turnos abiertos.';
  end if;
  if exists (
    select 1 from public.remitos r
    where r.proveedor_id = v_proveedor_id and r.numero = trim(p_numero_remito)
  ) then
    raise exception 'Ese número de remito ya fue usado.';
  end if;

  insert into public.turnos (orden_compra_id, proveedor_id, inicio, email_contacto, patente, transportista)
  values (v_oc_id, v_proveedor_id, v_inicio, lower(trim(p_email)), nullif(trim(p_patente), ''), nullif(trim(p_transportista), ''))
  returning id, codigo into v_turno_id, v_codigo;

  insert into public.remitos (turno_id, proveedor_id, numero, storage_path, mime_type, bytes)
  values (v_turno_id, v_proveedor_id, trim(p_numero_remito), p_archivo_path, p_archivo_mime, p_archivo_bytes);

  return jsonb_build_object('turno_id', v_turno_id, 'codigo', v_codigo);
exception
  when unique_violation then
    raise exception 'Ese horario acaba de ser reservado. Elegí otro.';
end;
$$;

create or replace function public.horarios_disponibles_publicos(p_fecha date)
returns table (hora text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with parametros as (
    select hora_apertura, hora_cierre, anticipacion_minutos, zona_horaria
    from public.configuracion where id = true
  ), franjas as (
    select make_time(hora_numero, 0, 0) as hora_real, parametros.*
    from parametros
    cross join lateral generate_series(
      extract(hour from hora_apertura)::integer,
      extract(hour from hora_cierre)::integer - 1
    ) as hora_numero
  )
  select to_char(hora_real, 'HH24:MI')
  from franjas
  where p_fecha >= (now() at time zone zona_horaria)::date
    and extract(isodow from p_fecha) <= 5
    and ((p_fecha + hora_real) at time zone zona_horaria) > now() + make_interval(mins => anticipacion_minutos)
    and not exists (
      select 1 from public.turnos t
      where t.inicio = ((p_fecha + hora_real) at time zone zona_horaria)
        and t.estado <> 'anulado'
    )
    and not exists (
      select 1 from public.bloqueos b
      where ((p_fecha + hora_real) at time zone zona_horaria) >= b.desde
        and ((p_fecha + hora_real) at time zone zona_horaria) < b.hasta
    )
  order by hora_real;
$$;

alter table public.profiles enable row level security;
alter table public.proveedores enable row level security;
alter table public.ordenes_compra enable row level security;
alter table public.configuracion enable row level security;
alter table public.turnos enable row level security;
alter table public.remitos enable row level security;
alter table public.bloqueos enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create policy "Usuarios leen su propio perfil" on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy "Administradores gestionan perfiles" on public.profiles
for all to authenticated using ((select public.es_administrador())) with check ((select public.es_administrador()));

create policy "Administradores gestionan proveedores" on public.proveedores
for all to authenticated using ((select public.es_administrador())) with check ((select public.es_administrador()));
create policy "Administradores gestionan ordenes" on public.ordenes_compra
for all to authenticated using ((select public.es_administrador())) with check ((select public.es_administrador()));
create policy "Administradores gestionan configuracion" on public.configuracion
for all to authenticated using ((select public.es_administrador())) with check ((select public.es_administrador()));
create policy "Administradores gestionan turnos" on public.turnos
for all to authenticated using ((select public.es_administrador())) with check ((select public.es_administrador()));
create policy "Administradores gestionan remitos" on public.remitos
for all to authenticated using ((select public.es_administrador())) with check ((select public.es_administrador()));
create policy "Administradores gestionan bloqueos" on public.bloqueos
for all to authenticated using ((select public.es_administrador())) with check ((select public.es_administrador()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'remitos', 'remitos', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant select on storage.objects to authenticated;
create policy "Administradores leen remitos" on storage.objects
for select to authenticated
using (bucket_id = 'remitos' and (select public.es_administrador()));

revoke all on function public.crear_turno_publico(text, text, text, text, date, time, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.crear_turno_publico(text, text, text, text, date, time, text, text, text, text, bigint) to service_role;
revoke all on function public.es_administrador() from public, anon;
grant execute on function public.es_administrador() to authenticated;
revoke all on function public.horarios_disponibles_publicos(date) from public;
grant execute on function public.horarios_disponibles_publicos(date) to anon, authenticated;
