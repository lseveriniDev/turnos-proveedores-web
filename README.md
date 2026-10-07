# Turnos de proveedores · Göttert

Portal público de reservas para proveedores. Esta aplicación contiene el formulario y sus funciones de reserva en Azure Static Web Apps. La [agenda interna](https://github.com/lseveriniDev/turnos-recepcion-interna) vive en otro repositorio y en otra Static Web App. Ambas aplicaciones comparten Cloud Firestore y la biblioteca de remitos de SharePoint.

## Estado del portal (07/10/2026)

- Portal Azure publicado: <https://green-forest-0f3977b0f.2.azurestaticapps.net/>.
- Agenda interna: <https://happy-meadow-0b423e10f.5.azurestaticapps.net/> (inicio de sesión Microsoft 365).
- Estos enlaces usan las direcciones de Azure y no requieren cambios en el DNS de la empresa. El dominio personalizado `turnos-gottert.gottert.com.ar` sigue configurado en Azure, pero no se usa en los enlaces mientras no resuelva en la red interna.
- Portal anterior disponible como respaldo: <https://turnos-proveedores-gottert.pages.dev/>.
- Firebase: proyecto `turnos-proveedores-gottert`, Firestore `southamerica-east1`, plan Spark.
- SharePoint: `GOTTERT / Shared Documents / 05-Suministros / 1. Compras / 3. Registros / Turnos Proveedores`.
- Se probó una reserva completa con OC abierta: archivo en SharePoint y correo entregado. El turno de prueba se anuló y el horario quedó libre. Los remitos anteriores fueron pruebas, según confirmó el equipo.
- Las exportaciones de Summa del 02/10 quedaron cargadas: 60 proveedores y 78 OCs en la base, 64 abiertas. Cuatro OCs de dos proveedores ausentes del catálogo quedaron fuera de la oferta de turnos por decisión del equipo.

## Cómo funciona

El proveedor valida CUIT y OC abierta, adjunta un PDF o imagen de hasta 10 MB y el navegador intenta reconocer los renglones. Si el acumulado supera el 110% de algún renglón de la OC, no puede continuar. Las entregas parciales se permiten. Lecturas dudosas ocupan el horario y quedan pendientes de revisión interna. En el panel se muestra una lista informativa de los productos detectados y el remito original. No se edita la OC desde recepción.

La API de Azure valida nuevamente la OC, la cantidad, el horario y la unicidad del remito por proveedor. Guarda el archivo en SharePoint dentro de `Turnos Proveedores/{Razón social - últimos 4 dígitos de la OC}/{Remito}_{Fecha}_{ID}.{ext}`; por ejemplo, `GRANT - 9032`. Una transacción de Firestore crea el turno y bloquea el horario. Si no se puede crear, intenta retirar el archivo recién subido.

La agenda interna se publica por separado y usa Microsoft 365. Las reglas de Firestore no permiten acceso directo desde el navegador.

## Variables privadas de Azure

Configurar en **Static Web App → Environment variables**:

| Variable | Uso |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `turnos-proveedores-gottert` |
| `FIREBASE_SERVICE_ACCOUNT_B64` | JSON de una cuenta de servicio de Firestore, codificado en Base64 |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | Aplicación de Microsoft Graph para guardar remitos |
| `SHAREPOINT_DRIVE_ID`, `SHAREPOINT_FOLDER_ID` | Biblioteca y carpeta raíz de remitos |
| `RESEND_API_KEY`, `MAIL_FROM` | Correo de confirmación desde el dominio verificado |

Nunca subir esas claves al repositorio. El token de publicación de Azure se guarda como secreto de GitHub `AZURE_STATIC_WEB_APPS_API_TOKEN`.

## Desarrollo y pruebas

Para preparar el entorno local:

```powershell
npm ci
npm ci --prefix api
if (-not (Test-Path api/local.settings.json)) { Copy-Item api/local.settings.example.json api/local.settings.json }
```

Completá `FIREBASE_SERVICE_ACCOUNT_B64` en `api/local.settings.json` y después ejecutá `npm run dev`. Para usar el portal en tu computadora, abrí **http://localhost:4280**. El puerto 3000 sirve solo a la interfaz y no responde a `/api/access`; por eso validar un CUIT desde allí devuelve HTTP 404. `npm run dev` inicia la interfaz, las funciones de Azure y el emulador de Static Web Apps. El proyecto usa Node 20 para este comando sin cambiar la versión de Node instalada en el sistema. Si Azure Functions Core Tools no está instalado, la CLI lo descargará en el primer inicio.

`FIREBASE_SERVICE_ACCOUNT_B64` contiene la credencial privada del proyecto Firebase codificada en Base64. `api/local.settings.json` está ignorado por Git y no debe compartirse. Las variables de Graph, SharePoint y correo son necesarias para probar una reserva completa.

Para iniciar solo la interfaz, usá `npm run dev:frontend`; en ese modo las llamadas a `/api/*` devolverán 404.

Para verificar la compilación y los controles del proyecto:

```powershell
npm run build
npm run lint
cd api
npm test
```

El sitio se exporta a `out/`. La API está en `api/` y se publica junto al sitio. Para probarla localmente se necesita Azure Static Web Apps CLI y un `api/local.settings.json` privado con las mismas variables.

El archivo histórico de Supabase se exportó a `.local/supabase-snapshot.json` (ignorado por Git). `scripts/migrate-supabase-snapshot.js` permite restaurarlo de forma controlada si hiciera falta. Los remitos de la versión anterior eran de prueba; no requieren copia operativa a SharePoint.

## Seguridad y publicación

- `firestore.rules` deniega todas las lecturas y escrituras directas; solo la API con credencial de servicio accede a los datos.
- Esta API solo registra las rutas públicas de consulta y reserva. Las rutas `/api/staff-*` se publican únicamente en la aplicación interna.
- El flujo de GitHub publica la rama `firebase-azure-migration` en el sitio Azure. La dirección anterior permanece separada.
- El panel y el respaldo se verificaron con la cuenta autorizada. Antes de abrirlo a todos los proveedores, conviene que recepción haga una reserva propia y confirme su procedimiento de aprobación, llegada y anulación.
