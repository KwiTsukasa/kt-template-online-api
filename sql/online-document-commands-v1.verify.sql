-- 只读核对四条命令的稳定身份及当前管理员设置，不修改启停或账号授权。
SELECT `id`, `operation_key`, `command_key`, `code`, `plugin_key`, `parser_key`,
  `target_type`, `enabled`, `is_deleted`
FROM `bot_command`
WHERE `operation_key` IN ('feishu.docs.read', 'feishu.docs.edit', 'tencent.docs.read', 'tencent.docs.edit')
ORDER BY `operation_key`;

SELECT `operation_key`, COUNT(*) AS `identity_count`
FROM `bot_command`
WHERE `operation_key` IN ('feishu.docs.read', 'feishu.docs.edit', 'tencent.docs.read', 'tencent.docs.edit')
GROUP BY `operation_key`
HAVING COUNT(*) <> 1;
