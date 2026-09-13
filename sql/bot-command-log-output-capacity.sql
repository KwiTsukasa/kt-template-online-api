-- 与 bot-init.sql 的日志合同一致，支持超过 64 KiB 的分页命令输入和完整输出。
-- 仅扩容，不修改已有记录；回退应用版本时保留宽列，禁止缩列截断新日志。
ALTER TABLE `bot_command_log`
  MODIFY COLUMN `input` LONGTEXT NULL,
  MODIFY COLUMN `output` LONGTEXT NULL;
