# Operación diaria hasta conectar Summa

Este procedimiento permite recibir reservas mientras la integración automática con Summa no está disponible. **Summa sigue siendo la fuente de verdad** de proveedores, órdenes de compra y cantidades recibidas. El portal no carga recepciones en Summa.

## Al abrir recepción

1. Exportar desde Summa el **reporte completo de OCs pendientes** y el **catálogo de proveedores**, ambos `.xlsx`. No reutilizar un reporte de OCs de ayer.
2. Entrar al [panel de recepción](https://turnos-proveedores-gottert.pages.dev/panel/), elegir ambos archivos y pulsar **Revisar actualización**.
3. Revisar las advertencias, la cantidad de proveedores, OCs, renglones y OCs que se cerrarían. Si la caída de OCs parece inesperada, comprobar que el reporte sea completo antes de confirmar.
4. Pulsar **Confirmar y actualizar**. Verificar el mensaje final. Si aparece un error, revisar en Summa y en el panel qué quedó aplicado antes de reintentar: la importación actual consta de varias operaciones.
5. Revisar los turnos **Pendientes de revisión**. Abrir el remito original antes de aprobar o anular.

## Durante el día

- Repetir la exportación y la carga alrededor del mediodía y antes de terminar la jornada. Si en Summa cambian muchas OCs entre esas horas, hacer una carga adicional.
- El panel muestra la última modificación registrada de OCs y avisa cuando supera cuatro horas. También rechaza un archivo de OCs cuya fecha de modificación tenga más de cuatro horas.
- En la agenda, comprobar los turnos nuevos y los pendientes de revisión. Marcar **Llegó** cuando corresponda; anular los turnos que efectivamente se cancelaron.
- Ante un correo fallido o un turno pendiente de revisión, contactar al proveedor por el canal habitual. La reserva queda registrada aunque falle el correo.

## Antes de compartir el enlace con proveedores

- Confirmar con la dirección que se acepta esta operación temporal en la nube y las reglas vigentes: horarios de 08:00 a 17:00, dos horas de anticipación y máximo de diez turnos futuros abiertos por proveedor.
- Renovar la contraseña del panel que se compartió durante las pruebas y guardar el acceso en el gestor de contraseñas de la empresa.
- Verificar una reserva completa con una OC vigente: adjuntar remito, comprobar el correo, verla en la agenda y abrir el archivo desde el panel. Anular el turno de prueba al terminar.
- Confirmar cómo se respaldan y restauran tanto la base como los archivos privados de remitos. El respaldo de la base por sí solo no recupera los PDF.
- Comunicar a recepción que el análisis del remito es una ayuda automática: las lecturas incompletas o dudosas pasan a revisión interna. La recepción y el ingreso al ERP siguen como hoy.

## Si falta una exportación nueva

No cargar una planilla vieja ni asumir que las OCs del portal siguen vigentes. Exportar nuevamente desde Summa. Si Summa no está disponible, comprobar la OC por el procedimiento habitual antes de aceptar entregas y avisar a los proveedores afectados.
