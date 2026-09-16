-- 在已备份的目标库按正常数据库迁移流程执行；本文件不会自行发布或执行。
-- 回退：停用新 BPMN 发起后保留本表与 bpmn_state 作为恢复证据，禁止删除仍运行实例。
ALTER TABLE automation_workflow_run ADD COLUMN bpmn_state JSON NULL;
CREATE TABLE IF NOT EXISTS automation_workflow_bpmn_activity (
  run_id BIGINT NOT NULL,
  execution_id VARCHAR(191) NOT NULL,
  element_id VARCHAR(191) NOT NULL,
  job JSON NOT NULL,
  step_state JSON NOT NULL,
  delivered TINYINT(1) NOT NULL DEFAULT 0,
  cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, execution_id),
  KEY idx_workflow_bpmn_activity_element (run_id, element_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
