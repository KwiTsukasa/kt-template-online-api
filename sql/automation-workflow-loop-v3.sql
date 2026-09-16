-- 对既有实例仅补默认轮次，原节点结果保持不变；逐轮历史由工作流引擎写入。
ALTER TABLE automation_workflow_node_run
  ADD COLUMN visit INT NOT NULL DEFAULT 1,
  ADD COLUMN loop_iteration INT NOT NULL DEFAULT 0,
  ADD COLUMN loop_path JSON NULL;

CREATE TABLE IF NOT EXISTS automation_workflow_node_visit (
  run_id BIGINT NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  visit INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  loop_path JSON NOT NULL,
  output_values JSON NOT NULL,
  script_attempts JSON NULL,
  task_run_id BIGINT NULL,
  business_receipt VARCHAR(191) NULL,
  error_message TEXT NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (run_id, node_id, visit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
