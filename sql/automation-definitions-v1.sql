-- Independent automation definition resources. Additive migration; existing task identities remain unchanged.

CREATE TABLE IF NOT EXISTS automation_ruleset (
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

CREATE TABLE IF NOT EXISTS automation_ruleset_revision (
  definition_id BIGINT NOT NULL,
  version INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(2048) NOT NULL DEFAULT '',
  definition JSON NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (definition_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_form (
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

CREATE TABLE IF NOT EXISTS automation_form_revision (
  definition_id BIGINT NOT NULL,
  version INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(2048) NOT NULL DEFAULT '',
  definition JSON NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (definition_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_trigger (
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

CREATE TABLE IF NOT EXISTS automation_trigger_revision (
  definition_id BIGINT NOT NULL,
  version INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(2048) NOT NULL DEFAULT '',
  definition JSON NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (definition_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_workflow (
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

CREATE TABLE IF NOT EXISTS automation_workflow_revision (
  definition_id BIGINT NOT NULL,
  version INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(2048) NOT NULL DEFAULT '',
  definition JSON NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (definition_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
