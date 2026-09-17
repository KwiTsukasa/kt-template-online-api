-- 活动业务对象唯一性由数据库保证，与调用方事务及连接锁的生命周期无关。
-- 终态派生为 NULL，保留完整历史；存在重复活动实例时迁移失败，不自动删除业务数据。
-- 回退仅移除 uk_automation_workflow_active_subject 索引和 active_business_subject_key 派生列。
-- 回退会撤销活动实例唯一性保护，必须先停止流程发起；原业务身份及运行记录不受影响。
ALTER TABLE automation_workflow_run
  ADD COLUMN active_business_subject_key VARCHAR(64)
    GENERATED ALWAYS AS (CASE WHEN status IN ('pending','running','waiting') THEN business_subject_key ELSE NULL END) STORED,
  ADD UNIQUE INDEX uk_automation_workflow_active_subject (active_business_subject_key);
