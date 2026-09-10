-- El piloto se publica como sitio estático: la reserva y la carga del
-- remito se limitan desde Postgres y Storage, sin una función intermedia.

create or replace function public.puede_subir_remito(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select p_ruta like 'turnos/%'
    and exists (
      select 1
      from public.remitos r
      join public.turnos t on t.id = r.turno_id
      where r.storage_path = p_ruta
        and r.created_at > now() - interval '30 minutes'
        and t.estado in ('reservado', 'confirmado')
    )
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'remitos' and o.name = p_ruta
    );
$$;

revoke all on function public.puede_subir_remito(text) from public;
grant execute on function public.puede_subir_remito(text) to anon, authenticated;

revoke all on function public.crear_turno_publico(text, text, text, text, date, time, text, text, text, text, bigint) from public;
grant execute on function public.crear_turno_publico(text, text, text, text, date, time, text, text, text, text, bigint) to anon, authenticated;

grant insert on storage.objects to anon, authenticated;
create policy "Proveedores suben su remito reservado" on storage.objects
for insert to anon, authenticated
with check (
  bucket_id = 'remitos'
  and public.puede_subir_remito(name)
);
