-- La creación de turnos pasa exclusivamente por la Edge Function, que exige
-- un remito y confirma su carga antes de enviar el correo.
revoke execute on function public.crear_turno_publico(text, text, text, text, date, time, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.crear_turno_publico(text, text, text, text, date, time, text, text, text, text, bigint)
  to service_role;
