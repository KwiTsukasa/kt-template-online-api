-- Additive tables for independent atomic tasks and execution history.
CREATE TABLE IF NOT EXISTS automation_task_run_review (
  run_id BIGINT NOT NULL PRIMARY KEY,
  reviewed_by BIGINT NOT NULL,
  resolution VARCHAR(32) NOT NULL,
  reason VARCHAR(2048) NOT NULL,
  reviewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_task (
  id BIGINT NOT NULL,
  source_key VARCHAR(191) COLLATE utf8mb4_bin NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(2048) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1,
  published_version INT NULL,
  definition JSON NOT NULL,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  update_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_task_revision (
  definition_id BIGINT NOT NULL,
  version INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(2048) NOT NULL DEFAULT '',
  definition JSON NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (definition_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_task_run (
  id BIGINT NOT NULL,
  task_id BIGINT NOT NULL,
  task_version INT NOT NULL,
  execution_key VARCHAR(64) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  parent_run_id BIGINT NULL,
  node_id VARCHAR(64) NULL,
  status VARCHAR(16) NOT NULL,
  input_values JSON NOT NULL,
  output_values JSON NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  cancel_requested TINYINT NOT NULL DEFAULT 0,
  requires_review TINYINT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  deadline_at DATETIME(3) NOT NULL,
  next_attempt_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_automation_task_run_execution (execution_key),
  KEY idx_automation_task_run_pending (status, next_attempt_at),
  KEY idx_automation_task_run_parent (parent_run_id, node_id),
  KEY idx_automation_task_run_review (task_id, requires_review)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_task_attempt (
  id BIGINT NOT NULL,
  run_id BIGINT NOT NULL,
  attempt_no INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  runtime_identity VARCHAR(191) NOT NULL,
  handler_key VARCHAR(191) NOT NULL,
  handler_version INT NOT NULL,
  error_message TEXT NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_automation_task_attempt (run_id, attempt_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_workflow_run (
  id BIGINT NOT NULL,
  workflow_id BIGINT NOT NULL,
  workflow_version INT NOT NULL,
  execution_key VARCHAR(64) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  input_values JSON NOT NULL,
  form_values JSON NULL,
  output_values JSON NULL,
  cancel_requested TINYINT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  deadline_at DATETIME(3) NOT NULL,
  next_wake_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_automation_workflow_run_execution (execution_key),
  KEY idx_automation_workflow_run_pending (status, next_wake_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_workflow_node_run (
  run_id BIGINT NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  task_run_id BIGINT NULL,
  selected_ports JSON NOT NULL,
  output_values JSON NOT NULL,
  error_message TEXT NULL,
  wake_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (run_id, node_id),
  KEY idx_automation_workflow_node_task (task_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
