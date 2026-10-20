# Proyecto: Sistema de Reservas de Espacios

## 1. Contexto del Cliente
Institución educativa que dispone de diversos espacios físicos (salones, laboratorios y salas) para actividades académicas y administrativas. Actualmente el proceso de reserva es **informal**, lo que genera falta de visibilidad sobre la disponibilidad de los espacios y sobre quién los está utilizando.

## 2. Recursos a Gestionar
| Recurso | Descripción |
|---|---|
| Salones | Espacios para clases teóricas |
| Laboratorios | Áreas de práctica especializada |
| Salas | Espacios de reunión disponibles |

## 3. Problemática
No existe un mecanismo formal de reservas, lo que impide conocer en tiempo real qué espacios están libres u ocupados, y no hay un registro claro de los responsables de su uso.

## 4. Objetivo General
Desarrollar un sistema de reservas de espacios que centralice la gestión de salones, laboratorios y salas, brindando visibilidad de disponibilidad en tiempo real y control sobre los responsables de cada reserva.

## 5. Objetivos Específicos
- **Visibilidad**: Mostrar en tiempo real el estado de disponibilidad de cada espacio.
- **Control**: Registrar de forma clara quién reserva y utiliza cada espacio, con fecha, hora y motivo.
- Reducir conflictos de doble reserva sobre un mismo espacio y horario.
- Facilitar la trazabilidad histórica del uso de los espacios (reportes).

## 6. Alcance
Incluye la gestión de tres tipos de espacio (salones, laboratorios, salas), la creación/modificación/cancelación de reservas, el control de usuarios y roles (profesores, estudiantes, administradores), un calendario de disponibilidad, notificaciones y reportes de uso.

No incluye: integración con sistemas de facturación, control de acceso físico (torniquetes/cerraduras electrónicas) ni gestión de mantenimiento de infraestructura, salvo que se defina como fase posterior.

## 7. Épicas del Proyecto

> **Dónde crearlas:** las épicas deben registrarse en la herramienta de gestión ágil del equipo (Jira, Trello, Azure DevOps o Notion). En Jira/Azure DevOps se crean como tipo de work item **"Epic"** dentro del backlog del proyecto; en Trello, como una lista o etiqueta "Épicas" con una tarjeta por épica, enlazada a las tarjetas de historias de usuario correspondientes. Cada épica debe llevar: nombre, objetivo, criterios de éxito e historias de usuario asociadas.

| # | Épica | Objetivo |
|---|---|---|
| E1 | **Gestión de Espacios** | Registrar, editar, clasificar y dar de baja salones, laboratorios y salas, incluyendo capacidad, recursos disponibles y ubicación. |
| E2 | **Gestión de Usuarios y Roles** | Administrar cuentas de profesores, estudiantes y administradores, con permisos diferenciados. |
| E3 | **Motor de Reservas** | Permitir crear, modificar y cancelar reservas, validando que no existan conflictos de horario sobre un mismo espacio. |
| E4 | **Disponibilidad en Tiempo Real** | Mostrar un calendario/vista de disponibilidad actualizada al instante para cada espacio. |
| E5 | **Control y Trazabilidad de Uso** | Registrar el responsable de cada reserva y mantener un historial consultable de uso por espacio y por usuario. |
| E6 | **Notificaciones y Alertas** | Enviar confirmaciones, recordatorios y avisos de cambios/cancelaciones de reserva. |
| E7 | **Reportes y Analítica** | Generar reportes de ocupación, uso por tipo de espacio y por periodo. |

### 7.1 Ejemplos de historias de usuario por épica
- **E1**: "Como administrador, quiero registrar un nuevo laboratorio con su capacidad y equipamiento para que esté disponible para reservas."
- **E3**: "Como profesor, quiero reservar un salón para una franja horaria específica para asegurar el espacio de mi clase."
- **E4**: "Como estudiante, quiero consultar qué salas están libres ahora mismo para poder reunirme con mi grupo."
- **E5**: "Como administrador, quiero ver el historial de uso de un laboratorio para auditar su ocupación."

## 8. Cronograma (Diagrama de Gantt)
El cronograma se construyó a partir de las épicas anteriores, secuenciando primero la base (espacios y usuarios), luego el motor de reservas (que depende de ambas) y finalmente las funcionalidades que dependen del motor (disponibilidad, trazabilidad, notificaciones y reportes).

Archivo generado: **gantt-sistema-reservas.mermaid** (adjunto), con las siguientes fases aproximadas:

1. Planificación (10 días hábiles)
2. E1 Gestión de Espacios / E2 Usuarios y Roles (en paralelo, 8 días c/u)
3. E3 Motor de Reservas (14 días)
4. E4 Disponibilidad en tiempo real / E5 Control y Trazabilidad (en paralelo)
5. E6 Notificaciones
6. E7 Reportes y Analítica
7. QA y Despliegue (10 días)

**Duración total estimada: ~10 semanas.**

## 9. Roles y Responsabilidades
| Rol | Responsabilidad |
|---|---|
| Product Owner | Prioriza épicas e historias, valida entregables |
| Scrum Master / Líder de proyecto | Facilita el cronograma y remueve bloqueos |
| Equipo de desarrollo | Implementa las épicas E1-E7 |
| Administrador institucional | Usuario clave para pruebas de aceptación de E1, E2 y E5 |

## 10. Riesgos
- Resistencia al cambio por parte de profesores acostumbrados al proceso informal → mitigar con capacitación (incluida en el cronograma).
- Conflictos de reservas duplicadas si la validación de horarios (E3) no cubre todos los casos borde.
- Dependencia de datos correctos de espacios (E1) para que la disponibilidad (E4) sea confiable.

## 11. Entregables
- Épicas e historias de usuario documentadas en la herramienta ágil elegida.
- Diagrama de Gantt del proyecto.
- Sistema funcional con los módulos de E1 a E7.
- Manual de usuario y capacitación a administradores.
