# Turnos de proveedores

Portal público de reservas y panel de recepción de Göttert. El sitio es una exportación estática de Next.js publicada en Cloudflare Pages. Supabase guarda los datos, los remitos privados y las cuentas del panel; la Edge Function `crear-reserva` gestiona las reservas.

## Estado y direcciones

- Portal: <https://turnos-proveedores-gottert.pages.dev/>
- Panel: <https://turnos-proveedores-gottert.pages.dev/panel/>
- Proyecto Supabase: `turnos-proveedores` (`ppcyiiiqzwzkayjklopv`).
- La publicación en Pages es manual (Direct Upload). El repositorio no está conectado a Pages para publicar automáticamente.

## Desarrollo local

1. Instalá las dependencias con `npm ci`.
2. Copiá `.env.example` a `.env.local` y verificá la URL y la Publishable key de Supabase.
3. Ejecutá `npm run dev` y abrí <http://localhost:3000/>.

Sin `.env.local`, las pantallas funcionan en modo de demostración y no guardan datos. Nunca pongas una Secret key o una service role key en un archivo `NEXT_PUBLIC_`.

## Base de datos y permisos

Las definiciones están en `supabase/migrations/`. Las primeras migraciones se aplicaron manualmente al proyecto existente; verificá el esquema antes de aplicarlas en una base nueva. La migración `restringir_creacion_publica_turnos` revoca la ejecución pública de `crear_turno_publico`: la reserva debe pasar por la Edge Function, que la ejecuta con la clave de servicio. Aplicá esta migración **después** de publicar el portal que invoca la Edge Function; el sitio anterior llama a la función SQL directamente.

El panel requiere un usuario de Supabase Auth con una fila `profiles` cuyo `rol` sea `administrador`. Las reglas de acceso de la base protegen las tablas del panel.

## Reserva de un proveedor

1. El proveedor valida CUIT y OC abierta.
2. Adjunta el remito. El navegador lee el PDF o la foto y propone renglones; el proveedor revisa productos y cantidades contra la OC antes de elegir horario.
3. La Edge Function vuelve a validar los renglones declarados: permite entregas parciales y marca para revisión el acumulado que supera el 110% de la cantidad original de cualquier renglón. También marca descripciones que no coinciden claramente con la OC y archivos con lectura incompleta o sin renglones comprobables.
4. La Edge Function crea el turno en estado `reservado` y entrega una URL de carga firmada. El navegador sube el remito al bucket privado.
5. Tras comprobar la carga, el turno pasa a `confirmado` o `retenido`. El proveedor recibe un correo que distingue confirmación de solicitud pendiente. Recepción puede ver el archivo y los renglones declarados en la agenda, aprobar un turno retenido y enviar la confirmación.

La lectura del archivo y la selección de productos ocurren en el navegador del proveedor: las cantidades enviadas se comprueban de nuevo contra la OC en el servidor, pero la correspondencia con el PDF requiere revisión humana. Un turno `retenido` ocupa el horario hasta que recepción lo apruebe o anule. La regla del paquete original era ±10% sobre el acumulado de cada renglón; aquí se conserva el límite superior del 110% y se permiten entregas parciales, según la decisión operativa actual.

Si falla la carga, el portal intenta anular el turno para liberar el horario. Si la confirmación o el correo falla después de subir el remito, muestra el código y pide comunicarse con recepción. El correo requiere los secretos `RESEND_API_KEY` y `RESEND_FROM` en la Edge Function; `RESEND_FROM` debe usar un dominio verificado. La URL y la clave de servicio de Supabase se proporcionan al entorno de la función, nunca al navegador.

## Importación desde Summa

En el panel, elegí el reporte de OCs y el catálogo de proveedores en formato `.xlsx`, revisá la vista previa y confirmá la actualización. Si hay OCs para cerrar, el panel exige confirmar ese cierre. La importación carga también los renglones de las OCs, necesarios para el control detallado de recepción. Un CSV preparado sirve para una carga parcial y no cierra OCs.

La importación hace varias operaciones consecutivas en la base. Si alguna falla, revisá el mensaje y la cantidad de proveedores, OCs y renglones antes de repetirla.

## Verificación y publicación

1. Ejecutá `npm run lint`, `npx deno check supabase/functions/crear-reserva/index.ts` y `npm run build`.
2. Desplegá la Edge Function `crear-reserva` en Supabase con `verify_jwt = false` (portal público).
3. Ejecutá `npm run deploy` para publicar la carpeta `out` en el proyecto existente de Cloudflare Pages.
4. Aplicá la migración de restricción de permisos y verificá que `anon` y `authenticated` ya no puedan ejecutar `crear_turno_publico`, pero `service_role` sí.
5. Probá una reserva completa con un proveedor y una OC de prueba: archivo, correo, agenda, vista del remito, llegada y anulación.

El panel permite registrar renglones recibidos y compararlos con el saldo pendiente de la OC. Ese control no modifica ni cierra la OC automáticamente.
