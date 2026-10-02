# Turnos de proveedores · Göttert

Portal de reservas y agenda de recepción. La versión nueva usa Azure Static Web Apps para el sitio y la API, Cloud Firestore para los datos y SharePoint para los PDF e imágenes de remitos. El acceso al panel usa la cuenta Microsoft 365 y una lista explícita de administradores. GitHub Actions publica los cambios de la rama `firebase-azure-migration`.

## Estado del traslado

- Portal anterior en servicio: <https://turnos-proveedores-gottert.pages.dev/>.
- Nuevo sitio Azure: <https://green-forest-0f3977b0f.2.azurestaticapps.net/> (pendiente de publicación y prueba).
- Firebase: proyecto `turnos-proveedores-gottert`, Firestore `southamerica-east1`, plan Spark.
- SharePoint: `GOTTERT / Shared Documents / 05-Suministros / 1. Compras / 3. Registros / Turnos Proveedores`.
- Se conserva la versión anterior hasta completar migración, publicación y prueba de punta a punta.

## Cómo funciona

El proveedor valida CUIT y OC abierta, adjunta un PDF o imagen de hasta 10 MB y el navegador intenta reconocer los renglones. Si el acumulado supera el 110% de algún renglón de la OC, no puede continuar. Las entregas parciales se permiten. Lecturas dudosas ocupan el horario y quedan pendientes de revisión interna. En el panel se muestra una lista informativa de los productos detectados y el remito original. No se edita la OC desde recepción.

La API de Azure valida nuevamente la OC, la cantidad, el horario y la unicidad del remito por proveedor. Guarda el archivo en SharePoint dentro de `Turnos Proveedores/{CUIT - Proveedor}/{OC}/{Remito}_{Fecha}_{ID}.{ext}`. Una transacción de Firestore crea el turno y bloquea el horario. Si no se puede crear, intenta retirar el archivo recién subido.

El panel usa el inicio de sesión de Microsoft 365 de Azure Static Web Apps. Además, `ADMIN_EMAILS` limita el acceso a las cuentas autorizadas. Las reglas de Firestore no permiten acceso directo desde el navegador.

## Operación diaria de Summa

Exportá el reporte completo de OCs y el catálogo de proveedores dos o tres veces al día. En el panel, seleccioná ambas planillas, revisá la vista previa y confirmá. La importación crea o actualiza proveedores, OCs y sus renglones; solicita confirmación para cerrar OCs que desaparecieron del reporte. El CSV sirve para una carga parcial y no cierra OCs.

El botón **Descargar respaldo** guarda un JSON con proveedores, OCs, turnos y bloqueos. Los archivos de remito permanecen en SharePoint. Descargá un respaldo al menos una vez por día hasta automatizar la copia.

## Variables privadas de Azure

Configurar en **Static Web App → Environment variables**:

| Variable | Uso |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `turnos-proveedores-gottert` |
| `FIREBASE_SERVICE_ACCOUNT_B64` | JSON de una cuenta de servicio de Firestore, codificado en Base64 |
| `ADMIN_EMAILS` | Correos del equipo autorizados, separados por coma |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | Aplicación de Microsoft Graph para guardar remitos |
| `SHAREPOINT_DRIVE_ID`, `SHAREPOINT_FOLDER_ID` | Biblioteca y carpeta raíz de remitos |
| `RESEND_API_KEY`, `MAIL_FROM` | Correo de confirmación desde el dominio verificado |

Nunca subir esas claves al repositorio. El token de publicación de Azure se guarda como secreto de GitHub `AZURE_STATIC_WEB_APPS_API_TOKEN`.

## Desarrollo y pruebas

```powershell
npm ci
npm run build
npm run lint
cd api
npm ci
npm test
```

El sitio se exporta a `out/`. La API está en `api/` y se publica junto al sitio. Para probarla localmente se necesita Azure Static Web Apps CLI y un `api/local.settings.json` privado con las mismas variables.

El archivo histórico de Supabase se exportó a `.local/supabase-snapshot.json` (ignorado por Git). `scripts/migrate-supabase-snapshot.js` importa esos datos a Firestore de forma controlada. Los archivos históricos de remito se deben copiar a SharePoint y vincular a cada turno antes de abandonar el portal anterior.

## Seguridad y publicación

- `firestore.rules` deniega todas las lecturas y escrituras directas; solo la API con credencial de servicio accede a los datos.
- `public/staticwebapp.config.json` exige inicio de sesión para `/api/admin/*`; la API también comprueba el correo autorizado.
- El flujo de GitHub publica la rama `firebase-azure-migration` en el sitio Azure. La dirección anterior permanece separada.
- Antes de compartir el nuevo enlace, probar una reserva real: carga de remito, control del 110%, correo, agenda, visualización del archivo, aprobación, llegada y anulación.
