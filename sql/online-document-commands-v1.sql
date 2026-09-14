-- 只注册四条独立文档命令；既有命令启停、删除及权限设置保持原值。
SET NAMES utf8mb4;
DELIMITER $$
DROP PROCEDURE IF EXISTS `kt_migrate_online_document_commands_v1`$$
CREATE PROCEDURE `kt_migrate_online_document_commands_v1`()
BEGIN
  DECLARE conflicts BIGINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS `kt_document_commands_v1`;
    RESIGNAL;
  END;
  CREATE TEMPORARY TABLE `kt_document_commands_v1` (
    `id` BIGINT PRIMARY KEY, `operation_key` VARCHAR(128),
    `command_key` VARCHAR(128), `name` VARCHAR(128), `alias` VARCHAR(128),
    `plugin_key` VARCHAR(128)
  );
  INSERT INTO `kt_document_commands_v1` VALUES
    (2099820000000300520, 'feishu.docs.read', 'feishu_docs_read', '飞书文档读取', '飞书读取', 'feishu-docs'),
    (2099820000000300521, 'feishu.docs.edit', 'feishu_docs_edit', '飞书文档编辑', '飞书编辑', 'feishu-docs'),
    (2099820000000300522, 'tencent.docs.read', 'tencent_docs_read', '腾讯文档读取', '腾讯文档读取', 'tencent-docs'),
    (2099820000000300523, 'tencent.docs.edit', 'tencent_docs_edit', '腾讯文档编辑', '腾讯文档编辑', 'tencent-docs');
  SELECT COUNT(*) INTO conflicts FROM `bot_command` b
    JOIN `kt_document_commands_v1` d ON b.id=d.id OR b.operation_key=d.operation_key
      OR b.command_key=d.command_key OR b.code=d.command_key
    WHERE NOT (b.operation_key=d.operation_key AND b.command_key=d.command_key
      AND b.code=d.command_key AND b.plugin_key=d.plugin_key
      AND b.parser_key='plain' AND b.target_type='all');
  IF conflicts > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Online document command identity conflict';
  END IF;
  SELECT COUNT(*) INTO conflicts FROM (
    SELECT b.operation_key FROM `bot_command` b
    JOIN `kt_document_commands_v1` d ON b.operation_key=d.operation_key
    GROUP BY b.operation_key HAVING COUNT(*) > 1
  ) duplicated;
  IF conflicts > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Online document command identity duplicated';
  END IF;
  START TRANSACTION;
  INSERT INTO `bot_command`
    (`id`, `operation_key`, `command_key`, `code`, `name`, `aliases`, `prefixes`,
     `plugin_key`, `parser_key`, `target_type`, `default_params`, `reply_template`,
     `error_template`, `enabled`, `priority`, `cooldown_ms`, `cooldown_seconds`, `remark`, `is_deleted`)
  SELECT d.id, d.operation_key, d.command_key, d.command_key, d.name,
    JSON_ARRAY(d.alias), '["/"]', d.plugin_key, 'plain', 'all', '{}', '',
    '文档操作未确认成功，请检查权限或先回读目标；写入没有自动重试。',
    1, 0, 3000, 3, '官方文档API；独立插件认证；精确修改须先读快照并回读验证。', 0
  FROM `kt_document_commands_v1` d
  WHERE NOT EXISTS (SELECT 1 FROM `bot_command` b WHERE b.operation_key=d.operation_key);
  COMMIT;
  DROP TEMPORARY TABLE `kt_document_commands_v1`;
END$$
CALL `kt_migrate_online_document_commands_v1`()$$
DROP PROCEDURE `kt_migrate_online_document_commands_v1`$$
DELIMITER ;
