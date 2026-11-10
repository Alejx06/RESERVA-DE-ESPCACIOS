# Sistema de Reservas de Espacios

Aplicación web para reservar **salones, laboratorios y salas** de una institución educativa, con
**disponibilidad en tiempo real**, **control de responsables**, **notificaciones por correo** y
**reportes de ocupación** descargables en Excel.

- **Frontend:** HTML + CSS + JavaScript (sin frameworks) en `frontend/`
- **Backend:** Node.js + Express (API REST) en `backend/`
- **Base de datos:** MySQL
- El backend también sirve el frontend: todo corre con **un solo comando**.

## Cómo ejecutarlo

Necesitas **Node.js 20 o superior** (`node -v`) y **MySQL encendido** (MySQL Server, XAMPP o MariaDB).

```bash
cd backend
copy .env.example .env        # Windows   (Mac/Linux: cp .env.example .env)
```

Abre `backend/.env` y ajusta como mínimo `DB_USER`, `DB_PASSWORD` y `BOOTSTRAP_ADMIN_PASSWORD`
(la contraseña de la primera cuenta administrativa, mínimo 8 caracteres). Luego:

```bash
npm install
npm start
```

Abre **http://localhost:3000** e inicia sesión con `BOOTSTRAP_ADMIN_EMAIL` (por defecto `admin@amigo.edu.co`).
En el primer arranque el servidor **crea la base `reservas`, las tablas, la cuenta administrativa y datos de
ejemplo** (9 espacios y unas 190 reservas de las últimas semanas, para que los reportes se vean con contenido).

> Desde la raíz también funciona: `npm run install:all` y `npm start`.

## Perfiles y permisos

| Perfil | Cómo obtiene su cuenta | Qué puede hacer |
|---|---|---|
| **Estudiante** | Se registra al instante con su correo `@amigo.edu.co` y una contraseña | Ver disponibilidad, reservar, modificar y cancelar **sus** reservas |
| **Profesor** | Lo crea el administrador | Igual que el estudiante |
| **Administrativo** | Lo crea el administrador (o la cuenta inicial) | Todo lo anterior sobre cualquier reserva, más: gestionar espacios y cuentas, ver reportes y la bitácora de correos |

Seguridad: contraseñas con scrypt, sesión en cookie `HttpOnly`/`SameSite=Strict`, límite de intentos de login,
respuestas sin revelar si un correo existe, cabeceras CSP, consultas parametrizadas, y el responsable de cada
reserva sale de la sesión (no se puede falsear).

## Correos (confirmación, cambios, cancelación y recordatorio)

Al reservar, modificar o cancelar, el usuario recibe un correo. Además, **una hora antes** del inicio
(`REMINDER_MINUTES_BEFORE`) se envía un recordatorio, una sola vez. Todo queda en la tabla `notifications`
y el administrador lo ve en la pantalla (sección *Notificaciones por correo*).

**Configurar Gmail** (o cualquier SMTP) en `backend/.env`:

1. En la cuenta de Google activa la *verificación en 2 pasos* y crea una **contraseña de aplicación**
   (Cuenta de Google → Seguridad → Contraseñas de aplicaciones).
2. Completa:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=tucuenta@gmail.com
   SMTP_PASSWORD=la-contraseña-de-aplicación
   SMTP_FROM=Reservas Institucionales <tucuenta@gmail.com>
   ```
3. Reinicia `npm start`: al arrancar verás `Correo : SMTP smtp.gmail.com`.

El registro de estudiantes no depende del correo: la cuenta se activa inmediatamente y la persona inicia
sesión al terminar el formulario. Sin SMTP, la aplicación sigue permitiendo registrarse y reservar, pero no
se envían notificaciones de reserva. Con `MAIL_SIMULATE=true`, esos mensajes se imprimen en la consola.

## Reportes (solo administrativo)

En la pantalla principal, sección *Reportes de ocupación*: elige un rango de fechas y verás indicadores
(reservas, horas, ocupación, cancelaciones, hora de mayor demanda), ocupación por espacio y por tipo, reservas
por día de la semana y por hora, horas por perfil y las personas que más reservan. **Descargar Excel** genera
un libro con 7 hojas (resumen, por espacio, tipo, perfil, día, hora y el detalle de cada reserva).

Ocupación = horas reservadas ÷ horas disponibles (07:00 a 21:00, todos los días del rango).

## Estructura

```
sistema-reservas-espacios/
├── backend/
│   ├── server.js                 # Conecta a MySQL, crea el admin inicial y arranca recordatorios
│   ├── .env.example              # Plantilla de configuración (copiar como .env)
│   ├── tests/api.test.js         # 29 pruebas automáticas
│   └── src/
│       ├── app.js · config.js
│       ├── db/                   # schema.sql (tablas), conexión (pool y transacciones), datos de ejemplo
│       ├── routes/               # auth, espacios, reservas, reportes
│       ├── services/             # lógica: auth, reservas, disponibilidad, notificaciones, reportes, correo
│       ├── middleware/ · utils/
├── frontend/                     # index.html · css/ · js/ (api.js, app.js)
├── render.yaml                   # servicio web en Render; los secretos se configuran en el panel
├── .node-version                 # versión de Node.js usada en Render
└── docs/                         # manual de usuario, guía de despliegue, cronograma
```

Tablas MySQL: `spaces`, `users`, `sessions`, `reservations`, `notifications`. Las cuentas usan únicamente
correos con dominio institucional; ya no requieren código de verificación.

## API REST (resumen)

Todas requieren sesión salvo `/api/auth/*` y `/api/health`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` · `/verify-email` · `/login` · `/logout` | Cuentas y sesión |
| GET | `/api/availability?date=` · `/api/stats` | Disponibilidad por fecha y resumen del momento |
| GET/POST/PUT/DELETE | `/api/reservations` | Reservas (409 si el horario está ocupado) |
| GET/POST/PUT/DELETE | `/api/spaces` | Espacios (escritura solo administrativo) |
| GET/POST/DELETE | `/api/admin/users` · GET `/api/admin/notifications` | Cuentas de personal y bitácora de correos |
| GET | `/api/reports/summary?from=&to=` · `/api/reports/export` | Reportes y Excel (solo administrativo) |

**Reglas de negocio:** horario 07:00–21:00, hasta 4 horas por reserva, hasta 90 días de anticipación, sin
reservas en horas pasadas, sin solapes (validado en el servidor con bloqueo de fila: si varias personas reservan
el mismo bloque a la vez, solo una lo logra), cancelar no borra (queda en el historial).

## Pruebas

```bash
npm test      # 29 pruebas; usan su propia base "reservas_test" y nunca tocan la real
```

El usuario de MySQL debe poder crear bases (root puede). Cubren login y permisos, reservas y conflictos,
concurrencia, correos y recordatorios, reportes y Excel.

## Comandos útiles

```bash
npm run seed   # borra espacios y reservas y recarga los datos de ejemplo con fechas de HOY (no borra cuentas)
npm run dev    # reinicia el servidor al guardar cambios
```

## Antes de presentar

1. `npm run seed` para que las reservas de ejemplo caigan en las fechas actuales.
2. Si presentas fuera de 07:00–21:00, pon en `.env` `OPEN_HOUR=0` y `CLOSE_HOUR=24`.
3. Guion sugerido: registrar un estudiante → reservar → mostrar el conflicto
   al reservar un bloque ocupado → entrar como administrador → reportes y Excel → bitácora de correos.

## Publicarlo en internet

Guías para desplegar:

- [Railway](docs/guia-despliegue-railway.md): aplicación Node.js y base MySQL en el mismo proyecto.
- [Render](docs/guia-de-despliegue.md): aplicación en Render con MySQL externo.

## Solución de problemas

- **"MySQL no está encendido"** → inicia el servicio de MySQL (o XAMPP). **"Usuario o contraseña incorrectos"** → revisa `.env`.
- **No llegan correos de reservas** → configura un proveedor SMTP o usa `MAIL_SIMULATE=true` para la demostración.
- **Puerto ocupado** → cambia `PORT` en `.env`.
- No incluyas `node_modules` ni `.env` al comprimir o subir el proyecto.
