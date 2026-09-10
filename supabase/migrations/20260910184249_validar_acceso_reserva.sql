-- Valida la combinación de CUIT y orden de compra antes de revelar el
-- formulario de reserva. Sólo devuelve la razón social asociada.

create or replace function public.validar_acceso_reserva(
  p_orden_compra text,
  p_cuit text
)
returns table (razon_social text)
language sql
stable
security definer
set search_path = ''
as $$
  select proveedor.razon_social
  from public.ordenes_compra as orden
  join public.proveedores as proveedor on proveedor.id = orden.proveedor_id
  where upper(trim(orden.numero)) = upper(trim(p_orden_compra))
    and proveedor.cuit = public.normalizar_cuit(p_cuit)
    and proveedor.habilitado
    and orden.estado = 'abierta'
  limit 1;
$$;

revoke all on function public.validar_acceso_reserva(text, text) from public, anon, authenticated;
grant execute on function public.validar_acceso_reserva(text, text) to anon, authenticated;
