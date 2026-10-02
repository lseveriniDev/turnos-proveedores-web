# Estado para la puesta en marcha · 02/10/2026

## Hecho hoy

- Se publicaron en el portal el aviso de antigüedad de OCs, el rechazo de reportes de más de cuatro horas y la actualización automática de la agenda cada minuto.
- Se importaron las exportaciones `OC 0210.xlsx` y `Proveedores 0210.xlsx` de Summa. La carga se aplicó en una sola operación y se verificó en la base.
- Quedaron **64 OCs abiertas**, **176 renglones de OCs abiertas** y **60 proveedores habilitados**. La última actualización de OCs quedó registrada el 02/10/2026 a las 13:15 (hora de Argentina).
- De las OCs anteriores, se incorporaron 17 nuevas y se cerraron 13 que ya no estaban pendientes. Ningún turno futuro se vio afectado.
- Se comprobó que el panel abre con la cuenta habilitada y muestra la agenda real vacía del día, sin turnos de demostración.

## Excepciones de la exportación

- Las OCs `0008-00009092`, `0008-00009169`, `0008-00009443` y `0008-00009671` no pudieron habilitarse: los códigos de sus proveedores (`GA0024` y `GA0554`) no figuran en el catálogo exportado. Verificar en Summa antes de ofrecerles reserva web.
- La OC `0008-00009437` quedó abierta pero no tiene renglones utilizables para el cotejo automático. Si se reserva, el remito pasará a revisión interna.
- Cuatro renglones del reporte tenían saldo pendiente negativo y se excluyeron del control por renglón. Un renglón no tenía código de producto. Sus OCs siguen disponibles si tienen otros renglones válidos.

## Tareas de hoy antes de difundir el portal

1. Cambiar la contraseña del panel que se compartió durante las pruebas. La persona titular de la cuenta debe hacerlo en Supabase Auth.
2. Confirmar con la dirección la modalidad temporal: nube en vez de servidor propio, franjas de 08:00 a 16:00 y máximo de diez turnos futuros por proveedor.
3. Hacer una reserva completa con una OC vigente y anularla al finalizar: carga de remito, correo, agenda y visualización del archivo.
4. Verificar la protección y recuperación de la base y de los PDF de remitos. Los respaldos de la base no incluyen los archivos de Storage.
5. Designar una persona para exportar y cargar ambas planillas al abrir, al mediodía y antes del cierre. Seguir [el procedimiento diario](OPERACION-PILOTO.md).

## Diferencias con el paquete original

El paquete inicial incluía Metabase, recordatorios diarios por correo, ejecución en un servidor propio y prueba de restauración. Esta versión no incorpora Metabase ni los recordatorios programados; el portal y el panel se alojan en Cloudflare Pages y los datos en Supabase. La carga en Summa de las recepciones sigue siendo manual, como preveía el alcance inicial hasta contar con integración.
