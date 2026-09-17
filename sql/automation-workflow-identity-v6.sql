-- 原生执行身份包含标准元素名和实例后缀；扩容不会更改现有身份或业务数据。
-- 回退应用可保留扩容列；只有确认所有身份均不超过 191 字符时才可另行缩列。
ALTER TABLE automation_workflow_bpmn_activity
  MODIFY COLUMN execution_id VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN element_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
