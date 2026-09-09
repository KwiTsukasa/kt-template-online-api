-- 幂等注册共享人格管理命令；保留管理员已有启停与权限设置，身份冲突时失败关闭。
SET NAMES utf8mb4;
DELIMITER $$
DROP PROCEDURE IF EXISTS `kt_migrate_persona_switch_command_v1`$$
CREATE PROCEDURE `kt_migrate_persona_switch_command_v1`()
BEGIN
  DECLARE exact_count BIGINT DEFAULT 0;
  DECLARE conflict_count BIGINT DEFAULT 0;
  SELECT COUNT(*) INTO conflict_count FROM `bot_command`
  WHERE (`id` = 2041700000000300519 OR `operation_key` = 'persona.manage'
    OR `command_key` = 'persona_switch' OR `code` = 'persona_switch')
    AND NOT (`operation_key` = 'persona.manage' AND `command_key` = 'persona_switch'
      AND `code` = 'persona_switch' AND `plugin_key` = 'persona-switch'
      AND `parser_key` = 'plain' AND `target_type` = 'all');
  IF conflict_count > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Persona command identity conflict';
  END IF;
  SELECT COUNT(*) INTO exact_count FROM `bot_command`
  WHERE `operation_key` = 'persona.manage' AND `command_key` = 'persona_switch'
    AND `code` = 'persona_switch' AND `plugin_key` = 'persona-switch'
    AND `parser_key` = 'plain' AND `target_type` = 'all';
  IF exact_count > 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Persona command identity duplicated';
  END IF;
  IF exact_count = 0 THEN
    INSERT INTO `bot_command`
      (`id`, `operation_key`, `command_key`, `code`, `name`, `aliases`, `prefixes`,
       `plugin_key`, `parser_key`, `target_type`, `default_params`, `reply_template`,
       `error_template`, `enabled`, `priority`, `cooldown_ms`, `cooldown_seconds`, `remark`, `is_deleted`)
    VALUES (2041700000000300519, 'persona.manage', 'persona_switch', 'persona_switch',
      '共享人格切换', '["人格","persona"]', '["/"]', 'persona-switch', 'plain', 'all',
      '{}', '', '人格操作未确认成功，请用 /persona h 查看状态。', 1, 0, 3000, 3,
      's/保存 图文人格、c/切换 名称、d/删除 名称、h/使用说明；共享记忆并保留对话，沿用宿主命令权限。', 0);
  END IF;
END$$
CALL `kt_migrate_persona_switch_command_v1`()$$
DROP PROCEDURE `kt_migrate_persona_switch_command_v1`$$
DELIMITER ;
