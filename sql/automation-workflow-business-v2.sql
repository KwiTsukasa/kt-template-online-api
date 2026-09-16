-- 工作流统一拥有业务绑定、实例身份与步骤回执；发布前先执行本增量。
-- 仅新增可空列与空绑定表，不把历史技术流程推断为业务流程。
CREATE TABLE IF NOT EXISTS automation_workflow_business_binding (
  process_key VARCHAR(64) NOT NULL,
  scope_id VARCHAR(96) NOT NULL,
  process_version INT NOT NULL,
  workflow_id BIGINT NOT NULL,
  workflow_version INT NOT NULL,
  revision INT NOT NULL,
  PRIMARY KEY (process_key, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE automation_workflow_run
  ADD COLUMN business_context JSON NULL,
  ADD COLUMN business_subject_key VARCHAR(64) NULL,
  ADD INDEX idx_automation_workflow_run_subject (business_subject_key, status);

ALTER TABLE automation_workflow_node_run
  ADD COLUMN business_receipt VARCHAR(191) NULL,
  ADD COLUMN prepared_input JSON NULL,
  ADD COLUMN script_attempts JSON NULL;

-- 回退前必须确认没有任何 business_context 非空的实例，并备份上述表。
-- 已有业务实例时禁止丢弃身份/回执列，先保留新版本运行时完成或确认取消。

CREATE TABLE IF NOT EXISTS automation_workflow_script (
  script_key VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  target VARCHAR(16) NOT NULL,
  declaration JSON NOT NULL,
  source_text MEDIUMTEXT NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (script_key, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
