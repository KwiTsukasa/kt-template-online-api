-- Trigger registrations and occurrences are owned exclusively by trigger-engine.
-- Schedule tables are owned exclusively by task-scheduling; references are resolved through public ports.
CREATE TABLE IF NOT EXISTS automation_schedule (
  source_key VARCHAR(191) COLLATE utf8mb4_bin NULL UNIQUE,
  id BIGINT NOT NULL, name VARCHAR(128) NOT NULL, description VARCHAR(2048) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1, published_version INT NULL, definition JSON NOT NULL,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  update_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS automation_schedule_revision (
  definition_id BIGINT NOT NULL, version INT NOT NULL, name VARCHAR(128) NOT NULL,
  description VARCHAR(2048) NOT NULL DEFAULT '', definition JSON NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (definition_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS automation_schedule_state (
  schedule_id BIGINT NOT NULL, revision INT NOT NULL DEFAULT 0, enabled TINYINT NOT NULL DEFAULT 0,
  active_binding_id BIGINT NULL, error_message TEXT NULL, PRIMARY KEY (schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS automation_schedule_binding (
  id BIGINT NOT NULL, schedule_id BIGINT NOT NULL, schedule_version INT NOT NULL,
  activation_revision INT NOT NULL, registration_id BIGINT NOT NULL, retired TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (id),
  UNIQUE KEY uk_automation_schedule_activation (schedule_id, activation_revision),
  UNIQUE KEY uk_automation_schedule_registration (registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS automation_schedule_dispatch (
  id BIGINT NOT NULL, schedule_id BIGINT NOT NULL, schedule_version INT NOT NULL,
  binding_id BIGINT NOT NULL, occurrence_id BIGINT NOT NULL, registration_id BIGINT NOT NULL,
  occurrence_payload JSON NOT NULL, occurred_at DATETIME(3) NOT NULL, definition JSON NOT NULL,
  status VARCHAR(16) NOT NULL, target_run_id BIGINT NULL, error_message TEXT NULL,
  deadline_at DATETIME(3) NOT NULL, next_attempt_at DATETIME(3) NOT NULL, finished_at DATETIME(3) NULL,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (id),
  UNIQUE KEY uk_automation_schedule_occurrence (occurrence_id),
  KEY idx_automation_schedule_dispatch (schedule_id, status, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS automation_trigger_registration (
  id BIGINT NOT NULL,
  consumer_key VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  trigger_id BIGINT NOT NULL,
  trigger_version INT NOT NULL,
  definition JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  event_key VARCHAR(128) NULL,
  event_version INT NULL,
  next_at DATETIME(3) NULL,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_automation_trigger_consumer (consumer_key),
  KEY idx_automation_trigger_due (status, next_at),
  KEY idx_automation_trigger_source (status, event_key, event_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_trigger_occurrence (
  id BIGINT NOT NULL,
  identity_key VARCHAR(64) NOT NULL,
  registration_id BIGINT NOT NULL,
  trigger_id BIGINT NOT NULL,
  trigger_version INT NOT NULL,
  event_receipt_id VARCHAR(64) NULL,
  occurred_at DATETIME(3) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  acknowledged_at DATETIME(3) NULL,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_automation_trigger_occurrence (identity_key),
  KEY idx_automation_trigger_pending (registration_id, status, id),
  KEY idx_automation_trigger_event (event_receipt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_trigger_event_receipt (
  id VARCHAR(64) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  event_key VARCHAR(128) NOT NULL,
  event_version INT NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
