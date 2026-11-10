# Desplegar en Railway

Railway puede alojar el servidor Node.js y MySQL en el mismo proyecto. El servidor sirve también el frontend,
así que solo se publica un servicio de aplicación. Revisa los precios y límites de Railway antes de crear
recursos.

## 1. Crear el proyecto y MySQL

1. Inicia sesión en [Railway](https://railway.com/) y crea un proyecto.
2. En el proyecto, selecciona **+ New → Database → MySQL** y espera a que el servicio MySQL esté activo.
3. Mantén la base en el mismo proyecto y ambiente que la aplicación. La conexión privada interna no requiere
   habilitar acceso público a la base.

## 2. Crear el servicio de aplicación

1. En el mismo proyecto, selecciona **+ New → GitHub Repo** y conecta `Alejx06/RESERVA-DE-ESPCACIOS`.
2. En los ajustes del servicio, deja **Root Directory** en `/`, la raíz del repositorio. No uses `/backend`:
   los comandos raíz instalan las dependencias del backend.
3. En **Settings → Build** configura **Custom Build Command**:

   ```text
   npm run install:all
   ```

4. En **Settings → Deploy** configura **Custom Start Command**:

   ```text
   npm start
   ```

5. Configura el **Healthcheck Path** como `/api/health`. Railway proporciona `PORT`; el servidor ya lo usa.

## 3. Conectar la aplicación con MySQL

En **Variables** del servicio de aplicación, crea:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Referencia a `MYSQL_URL` del servicio MySQL, por ejemplo `${{ MySQL.MYSQL_URL }}` |
| `DB_SSL` | `false` para la conexión privada entre servicios Railway |
| `NODE_ENV` | `production` |
| `EMAIL_DOMAIN` | `amigo.edu.co` |
| `BOOTSTRAP_ADMIN_EMAIL` | Correo administrativo terminado en `@amigo.edu.co` |
| `BOOTSTRAP_ADMIN_PASSWORD` | Contraseña nueva y fuerte, mínimo 8 caracteres |

En la referencia `${{ MySQL.MYSQL_URL }}`, reemplaza `MySQL` por el nombre exacto de tu servicio de base de
datos si lo renombraste. Railway documenta `MYSQL_URL` junto con las variables `MYSQLHOST`, `MYSQLPORT`,
`MYSQLUSER`, `MYSQLPASSWORD` y `MYSQLDATABASE`. La aplicación acepta la URL `MYSQL_URL` directamente y
también esas variables individuales; `DATABASE_URL` tiene prioridad si configuras ambas.

No habilites TCP Proxy ni copies una URL pública para esta conexión: los dos servicios están en el mismo
proyecto y deben comunicarse por la red privada de Railway. No publiques los valores de conexión ni los guardes
en Git.

## 4. Configurar acceso público y correo

1. En los ajustes del servicio web, genera un dominio público. Configura `APP_URL` con la URL HTTPS asignada,
   por ejemplo `https://tu-servicio.up.railway.app`.
2. SMTP es opcional para el registro: las cuentas de estudiante se activan al instante sin enviar códigos.
   Para recibir notificaciones por correo al reservar, configura SMTP en las variables del servicio:

   ```text
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=tu-cuenta-remitente@gmail.com
   SMTP_PASSWORD=contraseña-de-aplicación-de-Google
   SMTP_FROM=Reservas Institucionales <tu-cuenta-remitente@gmail.com>
   ```

   Usa una contraseña de aplicación de Google, no la contraseña normal. Railway bloquea SMTP en los planes
   Free, Trial y Hobby; para esos planes los correos no saldrán. El registro y las reservas seguirán funcionando.
3. Guarda los cambios y despliega. Railway puede pedir confirmar/aplicar los cambios pendientes.

## 5. Comprobar el despliegue

1. Abre `https://TU-DOMINIO/api/health`; debe responder con `"status":"ok"` y `"database":"mysql"`.
2. Inicia sesión con `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD`.
3. Crea los espacios reales desde la administración: en producción no se insertan datos de demostración.
4. Verifica que el registro cree la cuenta y entre automáticamente, crea y cancela una reserva y prueba un reporte.

En el primer arranque, la aplicación crea las tablas y la cuenta administrativa inicial. Los datos permanecen
en la base MySQL de Railway; configura copias de seguridad y no ejecutes `npm run seed` en producción, porque
ese comando borra los espacios y reservas existentes.

## Referencias oficiales

- [Railway MySQL](https://docs.railway.com/databases/mysql)
- [Railway variables entre servicios](https://docs.railway.com/variables#referencing-another-services-variable)
- [Railway build configuration](https://docs.railway.com/builds/build-configuration)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
