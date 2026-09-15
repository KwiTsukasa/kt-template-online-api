-- Bot 领域只保存提醒意图与发送状态；到期触发由 automation 模块负责。
CREATE TABLE IF NOT EXISTS `bot_reminder` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `owner` varchar(64) NOT NULL,
  `data` json NOT NULL,
  `status` varchar(16) NOT NULL,
  `schedule_id` bigint DEFAULT NULL,
  `sync_pending` tinyint NOT NULL DEFAULT 1,
  `last_error` text,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_bot_reminder_owner` (`owner`,`status`),
  KEY `idx_bot_reminder_sync` (`sync_pending`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
