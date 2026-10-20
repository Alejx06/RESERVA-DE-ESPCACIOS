# Sistema de Reservas de Espacios

Aplicación web para gestionar la reserva de **salones, laboratorios y salas** de una institución
educativa, con **disponibilidad en tiempo real** y **registro claro de los responsables** de cada uso.

- **Frontend:** HTML + CSS + JavaScript (sin frameworks) en `frontend/`
- **Backend:** Node.js + Express + SQLite (API REST) en `backend/`
- El backend también sirve el frontend, así que todo corre con **un solo comando**.

## Cómo ejecutarlo

Requisito: **Node.js 20 o superior** (recomendado la versión LTS). Verifica con `node -v`.
El registro de estudiantes requiere un servidor SMTP institucional para enviar el código de verificación.
El primer administrador se configura con variables de entorno; no hay claves administrativas por defecto.

```bash
cd backend
npm install
npm start
```

Abre **http://localhost:3000** en el navegador. En desarrollo, la primera vez se crea la base de datos
(`backend/data/reservas.db`) con 9 espacios y reservas de ejemplo. En producción no se cargan datos ficticios;
el administrador registra los espacios reales desde el panel.

> Desde la raíz del proyecto también funciona: `npm run install:all` y luego `npm start`.

Antes de iniciar, configura los secretos en el entorno del servidor (en producción, usa la sección
de variables/secretos del proveedor de alojamiento; no los guardes en el repositorio):

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL = "admin@amigo.edu.co"
$env:BOOTSTRAP_ADMIN_PASSWORD = "usa-una-clave-unica-de-12-caracteres-o-mas"
$env:SMTP_HOST = "smtp.amigo.edu.co"
$env:SMTP_PORT = "587"
$env:SMTP_USER = "cuenta-smtp"
$env:SMTP_PASSWORD = "secreto-smtp"
$env:SMTP_FROM = "Reservas <reservas@amigo.edu.co>"
$env:NODE_ENV = "production"
npm start
```

`EMAIL_DOMAIN` acepta `amigo.edu.co` por defecto. El código de verificación vence en 15 minutos.
La primera cuenta administrativa se crea una sola vez; cambiar las variables no restablece la contraseña
de una cuenta que ya existe. En producción, publica siempre detrás de HTTPS.
Configura `DB_PATH` sobre almacenamiento persistente y programa copias de seguridad; no uses un disco efímero
del proveedor. La configuración actual de SQLite está pensada para una única instancia de la aplicación.

## Estructura

```
sistema-reservas-espacios/
├── backend/
│   ├── server.js                 # Punto de entrada: abre la BD y levanta el servidor
│   ├── package.json
│   ├── data/                     # Aquí se crea reservas.db (SQLite)
│   ├── tests/api.test.js         # Pruebas automáticas del API y migración de BD
│   └── src/
│       ├── app.js                # Configura Express y monta las rutas
│       ├── config.js             # Horario, reglas de negocio y variables de entorno
│       ├── db/                   # schema.sql, conexión y datos de ejemplo (seed)
│       ├── routes/               # Endpoints (spaces, reservations)
│       ├── services/             # Lógica de negocio (reservas, disponibilidad, estadísticas)
│       ├── middleware/           # Manejo de errores y clave de administrador
│       └── utils/                # Fechas/horas y errores HTTP
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js                # Llamadas a la API (detecta la URL del backend sola)
│       └── app.js                # Interfaz: tablero, formulario de reserva, historial
└── docs/                         # Documento del proyecto y diagrama de Gantt
```

## API REST

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servidor |
| POST | `/api/auth/register` | Solicita una cuenta de estudiante y envía código al correo institucional |
| POST | `/api/auth/verify-email` | Verifica el código de 8 dígitos enviado por correo |
| POST | `/api/auth/login` · `/api/auth/logout` | Iniciar/cerrar sesión con cookie HttpOnly |
| GET | `/api/auth/me` | Cuenta de la sesión actual |
| GET | `/api/spaces?type=` | Lista de espacios (`salon`, `laboratorio`, `sala`) |
| POST / PUT / DELETE | `/api/spaces` · `/api/spaces/:id` | Crear/editar/dar de baja espacios (solo administrativo) |
| GET | `/api/availability?date=YYYY-MM-DD` | Espacios con sus bloques horarios del día (libre / ocupado / pasado) |
| GET | `/api/reservations?date=&spaceId=&responsible=&includeCancelled=true` | Historial de reservas |
| POST / PUT | `/api/reservations` · `/api/reservations/:id` | Crear o editar reserva propia (administrativo puede gestionar todas) |
| DELETE | `/api/reservations/:id` | Cancelar reserva propia; administrativo puede cancelar cualquier reserva |
| GET / POST / DELETE | `/api/admin/users` · `/api/admin/users/:id` | Consultar, crear perfiles de personal y desactivar cuentas (solo administrativo) |
| GET | `/api/stats` | Resumen del momento: disponibles ahora, totales, espacios más usados |

Las operaciones requieren iniciar sesión. El servidor obtiene nombre y rol de la cuenta autenticada;
ignora cualquier identidad o perfil enviado desde el navegador. Los estudiantes se registran y verifican
por correo; profesores y administrativos solo pueden ser creados por un administrativo.

Errores comunes: `400` datos inválidos · `409` el espacio ya está reservado en ese horario
(el mensaje indica quién lo tiene) · `422` fecha/hora que ya pasó.

## Reglas de negocio implementadas

- Horario de servicio: 07:00 a 21:00, reservas por horas completas, máximo 4 horas por reserva.
- **Una reserva no puede solaparse con otra del mismo espacio** (validado en el servidor dentro de una transacción).
- Cada reserva registra responsable, rol (Profesor / Estudiante / Administrativo), motivo y fecha de creación.
- No se puede reservar en horas pasadas ni con más de 90 días de anticipación.
- Liberar una reserva no la borra: queda como *cancelada* para conservar la trazabilidad.
- Una reserva que ya finalizó no se puede liberar.
- Solo se pueden consultar, editar y cancelar las reservas propias; el perfil administrativo puede gestionar todas.
- La pantalla se actualiza sola cada 10 segundos, por lo que varios usuarios ven los mismos cambios.

## Estado frente a las épicas del proyecto

| Épica | Estado |
|---|---|
| E1 Gestión de Espacios | CRUD en API y panel web administrativo para crear, editar y dar de baja espacios. |
| E2 Usuarios y Roles | Cuentas con correo institucional verificado, contraseña con hash, sesiones HttpOnly y perfiles asignados con autorización. |
| E3 Motor de Reservas | Crear, modificar y cancelar; validación de conflictos y permisos por propietario/perfil. |
| E4 Disponibilidad en Tiempo Real | Hecho (disponibilidad por fecha y refresco automático). |
| E5 Control y Trazabilidad | Hecho (responsable, rol, motivo, historial con canceladas). |
| E6 Notificaciones | Pendiente. |
| E7 Reportes y Analítica | Parcial: `/api/stats` entrega totales y espacios más usados; falta un panel de reportes. |

## Configuración opcional (variables de entorno)

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `DB_PATH` | `backend/data/reservas.db` | Ubicación de la base de datos |
| `EMAIL_DOMAIN` | `amigo.edu.co` | Dominio permitido para cuentas institucionales |
| `BOOTSTRAP_ADMIN_EMAIL` | — | Correo institucional de la cuenta administrativa inicial |
| `BOOTSTRAP_ADMIN_PASSWORD` | — | Contraseña inicial (mínimo 12 caracteres); obligatoria junto con el correo |
| `SMTP_HOST` / `SMTP_PORT` | — / `587` | Servidor y puerto para enviar códigos de verificación |
| `SMTP_USER` / `SMTP_PASSWORD` | — | Credenciales del servidor SMTP |
| `SMTP_FROM` | — | Dirección remitente institucional |
| `SMTP_SECURE` | `false` | `true` si el servidor SMTP requiere TLS implícito |
| `NODE_ENV` | `development` | En `production` marca las cookies de sesión como `Secure` |
| `ALLOW_PAST` | `false` | `true` permite reservar en horas pasadas (útil para demos) |
| `OPEN_HOUR` / `CLOSE_HOUR` | `7` / `21` | Horario de servicio |

Ejemplos: en PowerShell `$env:PORT=4000; npm start` · en Mac/Linux `PORT=4000 npm start`.

## Comandos útiles

```bash
npm test        # corre las pruebas automáticas del API
npm run seed    # borra los datos y recarga los de ejemplo con fechas relativas a HOY
npm run dev     # modo desarrollo (reinicia el servidor al guardar cambios)
```

## Consejos para la presentación

- Antes de presentar ejecuta `npm run seed` para que las reservas de ejemplo caigan en el día de hoy.
- **No ejecutes `npm run seed` en producción**: reemplaza los espacios y reservas con datos de demostración.
- Si presentas fuera de 07:00–21:00, el panel dirá "fuera del horario de servicio". Arranca con
  `OPEN_HOUR=0 CLOSE_HOUR=24` (en PowerShell: `$env:OPEN_HOUR=0; $env:CLOSE_HOUR=24; npm start`)
  o cambia los valores en `backend/src/config.js`.
- Para mostrar el **tiempo real**, abre la página en dos pestañas: reserva en una y verás aparecer
  el cambio en la otra en unos segundos.
- Para mostrar el **control de conflictos**, intenta reservar un bloque ya ocupado.
- Para mostrar la **trazabilidad**, libera una reserva y señala que sigue en el historial como *cancelada*.

## Solución de problemas

- **"Sin conexión con el servidor"** en la página: el backend no está corriendo; ejecuta `npm start` en `backend/`.
- **No se puede registrar**: configura `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM`, y revisa la conexión desde el servidor.
- **No aparece administración**: configura `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` antes del primer inicio, o inicia sesión con una cuenta administrativa existente.
- **Falla `npm install` con better-sqlite3**: usa Node 20 o 22 LTS (`node -v`).
- **Puerto ocupado**: arranca en otro puerto con la variable `PORT`.
