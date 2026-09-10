# Turnos de proveedores

Aplicación web para que los proveedores reserven un turno de entrega y el equipo de recepción administre la agenda.

## Abrirla en VS Code

1. Abrí esta carpeta con VS Code.
2. Abrí la terminal integrada (`Terminal` → `New Terminal`).
3. Ejecutá `npm run dev`.
4. Entrá a [http://localhost:3000](http://localhost:3000).

El portal de proveedores está en `/` y el panel interno en `/panel`.

Mientras no exista un archivo `.env.local`, la aplicación funciona en **vista de prueba**: deja recorrer todas las pantallas pero no guarda información real.

## Conectar Supabase

Cuando esté creada la cuenta y el proyecto de Supabase:

1. Copiá `.env.example` como `.env.local`.
2. En Supabase, abrí `Connect` y copiá la URL del proyecto y la **Publishable key** en ese archivo.
3. En `SQL Editor`, ejecutá el contenido de `supabase/migrations/20260910_000001_turnos_base.sql`, `supabase/migrations/20260910_000002_reserva_estatica.sql` y `supabase/migrations/20260910184249_validar_acceso_reserva.sql`.
4. Creá el primer usuario del panel desde `Authentication` → `Users` → `Add user`.
5. Con el identificador de ese usuario, ejecutá en el SQL Editor:

```sql
insert into public.profiles (id, nombre, rol)
values ('ID_DEL_USUARIO', 'Lucila', 'administrador');
```

No copies ni publiques una **Secret key**. La aplicación solo utiliza la Publishable key, que es la diseñada para el navegador junto con las reglas de seguridad de la base.

## Importar proveedores y órdenes

Desde el panel se importa un CSV con estas columnas:

```text
cuit;razon_social;email;codigo_externo;orden_compra
30-12345678-9;Proveedor de ejemplo S.A.;contacto@proveedor.com;PR001;OC-000123
```

La plantilla se puede descargar desde el panel. El importador habilita a los proveedores cargados y deja sus órdenes abiertas para reservar.

## Publicar sin servidor propio

El proyecto genera una carpeta `out` lista para Cloudflare Pages. Cuando tengamos la cuenta:

1. Subimos este proyecto a un repositorio privado de GitHub.
2. En Cloudflare Pages, conectamos ese repositorio.
3. Elegimos el preset **Next.js (Static HTML Export)**, con `npx next build` como comando y `out` como directorio de salida.
4. Cloudflare entrega una URL pública con HTTPS. Más adelante se puede vincular un subdominio de la empresa.

## Qué hace esta primera versión

- Formulario público en tres fases: validación de CUIT + OC, datos del remito y elección de horario.
- Validación de proveedor/OC habilitados, franja horaria, anticipación y doble reserva.
- Remitos privados: el proveedor puede subirlos sólo después de una reserva válida; el panel los abre con enlaces de un minuto.
- Panel con agenda diaria, llegada, anulación, bloqueo de horarios e importación CSV.
- Inicio de sesión para el panel con Supabase Auth.

No incluye OCR, integración automática con Summa, n8n, Docker, Linux ni envío de correos. Son agregados posibles si el piloto demuestra que el circuito sirve.
