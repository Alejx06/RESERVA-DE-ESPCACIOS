# Desplegar en Render

El proyecto ya incluye `render.yaml` y `.node-version`. Render puede alojar el servidor Node.js, pero este
proyecto usa **MySQL**: hay que contratar o crear MySQL con un proveedor externo. La base MySQL de tu computador
no es accesible desde internet y Render no la copia ni la publica automáticamente.

## Antes de desplegar

Necesitas:

- Una cuenta Render conectada con GitHub.
- El código publicado en la rama de GitHub que se va a desplegar.
- Una base MySQL externa activa, accesible desde Render, con una base de datos creada y una URL de conexión
  MySQL. Confirma con el proveedor que permite conexiones TLS desde fuera de su red.
- Una cuenta remitente Gmail con contraseña de aplicación. No uses la contraseña normal de Gmail.

Render ofrece un plan gratis para probar el servicio web, pero se duerme tras 15 minutos sin tráfico y puede
tardar alrededor de un minuto en despertar. No se recomienda para producción. MySQL externo puede tener cobro
independiente. Revisa precios y límites en ambos proveedores antes de crear recursos.

## Crear el servicio web en Render

1. Confirma que los cambios del proyecto estén subidos a GitHub.
2. En Render, elige **New → Blueprint** y conecta el repositorio `Alejx06/RESERVA-DE-ESPCACIOS`.
3. Render leerá `render.yaml`. El servicio `sistema-reservas-espacios` se configura con Node.js 22.20.0,
   `npm run install:all`, `npm start` y la comprobación de salud `/api/health`.
4. Cuando Render solicite valores privados, introdúcelos directamente en el panel de Render. **No los escribas
   en `render.yaml`, no los envíes por chat y no subas `backend/.env` a GitHub.**

Completa los valores solicitados:

| Variable | Qué configurar |
|---|---|
| `DATABASE_URL` | URL completa de la base MySQL externa (nunca la URL local `127.0.0.1`) |
| `DB_SSL` | `true` si el proveedor exige TLS; de lo contrario, `false` |
| `APP_URL` | URL pública `https://...onrender.com` que Render asigne al servicio |
| `BOOTSTRAP_ADMIN_EMAIL` | Correo del administrador inicial, terminado en `@amigo.edu.co` |
| `BOOTSTRAP_ADMIN_PASSWORD` | Contraseña nueva, única y fuerte para producción; no uses `admin123` |
| `SMTP_USER` | Gmail que enviará los mensajes |
| `SMTP_PASSWORD` | Contraseña de aplicación de Google, no la contraseña normal de Gmail |
| `SMTP_FROM` | `Reservas Institucionales <tu-remitente@gmail.com>` con el Gmail remitente |

El Blueprint ya deja `NODE_ENV=production`, `EMAIL_DOMAIN=amigo.edu.co` y los parámetros públicos de Gmail SMTP.
Los estudiantes pueden crear una cuenta inmediatamente con su correo `@amigo.edu.co`; no se requiere código
de correo. SMTP es opcional y solo se usa para notificaciones de reservas.

## Verificar antes de presentar

1. Espera a que el despliegue termine y abre la URL `onrender.com`.
2. Abre `https://TU-URL/api/health`; debe responder con estado `ok`.
3. Inicia sesión con la cuenta administrativa creada por las variables de entorno.
4. Crea los espacios reales desde la administración: en producción **no se cargan los espacios de demostración**.
5. Registra un estudiante de prueba y confirma que pueda entrar automáticamente.
6. Prueba iniciar sesión, crear y cancelar una reserva, dar de baja un espacio y generar un reporte.

Si se configura SMTP, confirma que el proveedor acepte conexiones desde Render y que lleguen las notificaciones.

## Datos y recuperación

- Los datos de la aplicación viven en la base MySQL externa; mantén sus copias de seguridad activas.
- En producción se crean las tablas al arrancar, pero los espacios reales deben añadirse desde la aplicación.
- No ejecutes `npm run seed` en producción: ese comando borra reservas y espacios de la base configurada.
- Guarda las credenciales de administrador y del proveedor por un medio seguro. No las incluyas en Git.

## Referencias oficiales

- [Render Blueprints](https://render.com/docs/blueprint-spec)
- [Node.js en Render](https://render.com/docs/node-version)
- [Limitaciones del plan gratis](https://render.com/docs/free)
- [Variables de entorno y secretos](https://render.com/docs/configure-environment-variables)
