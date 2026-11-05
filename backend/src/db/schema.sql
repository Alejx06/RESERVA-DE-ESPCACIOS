-- Esquema MySQL del Sistema de Reservas de Espacios.
-- El servidor lo ejecuta solo al arrancar (CREATE TABLE IF NOT EXISTS), pero también puedes
-- correrlo a mano en MySQL Workbench: primero CREATE DATABASE reservas, luego USE reservas.
-- Las marcas de tiempo (created_at, expires_at...) se guardan como texto ISO 8601 en UTC.

CREATE TABLE IF NOT EXISTS spaces (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(80)  NOT NULL,
  type      ENUM('salon', 'laboratorio', 'sala') NOT NULL,
  capacity  INT UNSIGNED NOT NULL,
  location  VARCHAR(100) NOT NULL DEFAULT '',
  active    TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_spaces_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NOT NULL,
  full_name     VARCHAR(80)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('Profesor', 'Estudiante', 'Administrativo') NOT NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    VARCHAR(30)  NOT NULL,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)     NOT NULL PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  expires_at VARCHAR(30)  NOT NULL,
  created_at VARCHAR(30)  NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  KEY idx_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_verifications (
  user_id    INT UNSIGNED NOT NULL PRIMARY KEY,
  code_hash  VARCHAR(255) NOT NULL,
  expires_at VARCHAR(30)  NOT NULL,
  attempts   INT          NOT NULL DEFAULT 0,
  created_at VARCHAR(30)  NOT NULL,
  CONSTRAINT fk_verifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reservations (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  space_id         INT UNSIGNED NOT NULL,
  user_id          INT UNSIGNED NULL,
  date             DATE         NOT NULL,
  start_hour       TINYINT UNSIGNED NOT NULL COMMENT 'inclusive, ej. 8 = 08:00',
  end_hour         TINYINT UNSIGNED NOT NULL COMMENT 'exclusivo, ej. 10 = hasta las 10:00',
  responsible_name VARCHAR(80)  NOT NULL,
  role             ENUM('Profesor', 'Estudiante', 'Administrativo') NOT NULL,
  purpose          VARCHAR(200) NOT NULL DEFAULT 'Sin especificar',
  status           ENUM('activa', 'cancelada') NOT NULL DEFAULT 'activa',
  created_at       VARCHAR(30)  NOT NULL,
  cancelled_at     VARCHAR(30)  NULL,
  reminder_sent_at VARCHAR(30)  NULL,
  CONSTRAINT fk_reservations_space FOREIGN KEY (space_id) REFERENCES spaces (id),
  CONSTRAINT fk_reservations_user  FOREIGN KEY (user_id)  REFERENCES users (id),
  CONSTRAINT chk_reservations_hours CHECK (end_hour > start_hour),
  KEY idx_reservations_lookup (space_id, date, status),
  KEY idx_reservations_date (date, status),
  KEY idx_reservations_user (user_id, date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bitácora de correos: confirmaciones, cambios, cancelaciones y recordatorios.
CREATE TABLE IF NOT EXISTS notifications (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT UNSIGNED NULL,
  user_id        INT UNSIGNED NULL,
  type           ENUM('confirmacion', 'modificacion', 'cancelacion', 'recordatorio') NOT NULL,
  recipient      VARCHAR(190) NOT NULL,
  subject        VARCHAR(200) NOT NULL,
  status         ENUM('enviado', 'simulado', 'omitido', 'fallido') NOT NULL,
  error          VARCHAR(255) NULL,
  created_at     VARCHAR(30)  NOT NULL,
  KEY idx_notifications_created (created_at),
  KEY idx_notifications_reservation (reservation_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
