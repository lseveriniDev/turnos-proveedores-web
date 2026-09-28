-- Summa informa algunas cantidades con cuatro decimales.
-- Conservamos su precision en la OC y en la recepcion del remito.
alter table public.lineas_orden_compra
  alter column cantidad_ordenada type numeric(15, 4),
  alter column cantidad_recibida type numeric(15, 4),
  alter column cantidad_pendiente type numeric(15, 4);

alter table public.lineas_remito
  alter column cantidad type numeric(15, 4);
