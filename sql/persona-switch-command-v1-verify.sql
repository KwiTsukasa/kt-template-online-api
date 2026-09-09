-- 只读检查：identity_count 应为 1，conflict_count 应为 0；权限由宿主策略管理。
SET NAMES utf8mb4;
SELECT COUNT(*) AS `identity_count` FROM `bot_command`
WHERE `operation_key` = 'persona.manage' AND `command_key` = 'persona_switch'
  AND `code` = 'persona_switch' AND `plugin_key` = 'persona-switch'
  AND `parser_key` = 'plain' AND `target_type` = 'all';
SELECT COUNT(*) AS `conflict_count` FROM `bot_command`
WHERE (`id` = 2041700000000300519 OR `operation_key` = 'persona.manage'
  OR `command_key` = 'persona_switch' OR `code` = 'persona_switch')
  AND NOT (`operation_key` = 'persona.manage' AND `command_key` = 'persona_switch'
    AND `code` = 'persona_switch' AND `plugin_key` = 'persona-switch'
    AND `parser_key` = 'plain' AND `target_type` = 'all');
SELECT `id`, `enabled`, `is_deleted`, `aliases`, `prefixes` FROM `bot_command`
WHERE `operation_key` = 'persona.manage';
