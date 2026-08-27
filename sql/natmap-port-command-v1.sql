-- 为既有生产库幂等补齐 NATMap 只读查询命令。
-- 迁移只在命令身份完全缺失时插入，绝不重新启用或覆盖管理员已调整的命令状态。

SET NAMES utf8mb4;

DELIMITER $$

DROP PROCEDURE IF EXISTS `kt_migrate_natmap_port_command_v1`$$

CREATE PROCEDURE `kt_migrate_natmap_port_command_v1`()
BEGIN
  DECLARE exact_identity_count BIGINT DEFAULT 0;
  DECLARE identity_conflict_count BIGINT DEFAULT 0;

  SELECT COUNT(*) INTO identity_conflict_count
  FROM `bot_command`
  WHERE (
      `id` = 2041700000000300518
      OR `operation_key` = 'natmap.port.current'
      OR `command_key` = 'natmap_port'
      OR `code` = 'natmap_port'
    )
    AND NOT (
      `operation_key` = 'natmap.port.current'
      AND `command_key` = 'natmap_port'
      AND `code` = 'natmap_port'
      AND `plugin_key` = 'natmap-port'
      AND `parser_key` = 'plain'
      AND `target_type` = 'all'
    );

  IF identity_conflict_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'NATMap command identity conflicts with an existing command';
  END IF;

  SELECT COUNT(*) INTO exact_identity_count
  FROM `bot_command`
  WHERE `operation_key` = 'natmap.port.current'
    AND `command_key` = 'natmap_port'
    AND `code` = 'natmap_port'
    AND `plugin_key` = 'natmap-port'
    AND `parser_key` = 'plain'
    AND `target_type` = 'all';

  IF exact_identity_count > 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'NATMap command identity is duplicated';
  END IF;

  IF exact_identity_count = 0 THEN
    INSERT INTO `bot_command` (
      `id`,
      `operation_key`,
      `command_key`,
      `code`,
      `name`,
      `aliases`,
      `prefixes`,
      `plugin_key`,
      `parser_key`,
      `target_type`,
      `default_params`,
      `reply_template`,
      `error_template`,
      `enabled`,
      `priority`,
      `cooldown_ms`,
      `cooldown_seconds`,
      `remark`,
      `is_deleted`
    ) VALUES (
      2041700000000300518,
      'natmap.port.current',
      'natmap_port',
      'natmap_port',
      'NATMap 动态端口',
      '["natmap","动态端口","公网端口"]',
      '["/","!","！"]',
      'natmap-port',
      'plain',
      'all',
      '{}',
      '',
      'NATMap 实时状态暂不可用，请稍后再试。',
      1,
      0,
      5000,
      5,
      '只读查询已授权 TCP NATMap 通道；格式：/natmap [通道名称]',
      0
    );
  END IF;
END$$

CALL `kt_migrate_natmap_port_command_v1`()$$
DROP PROCEDURE `kt_migrate_natmap_port_command_v1`$$

DELIMITER ;
