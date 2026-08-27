-- 只读确认 NATMap 命令身份唯一，且没有复用稳定 ID 或任一命令键的冲突行。

SET NAMES utf8mb4;

SELECT COUNT(*) AS `natmap_command_identity_count`
FROM `bot_command`
WHERE `operation_key` = 'natmap.port.current'
  AND `command_key` = 'natmap_port'
  AND `code` = 'natmap_port'
  AND `plugin_key` = 'natmap-port'
  AND `parser_key` = 'plain'
  AND `target_type` = 'all';

SELECT COUNT(*) AS `natmap_command_conflict_count`
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

SELECT GREATEST(COUNT(*) - 1, 0) AS `natmap_command_duplicate_count`
FROM `bot_command`
WHERE `operation_key` = 'natmap.port.current'
  AND `command_key` = 'natmap_port'
  AND `code` = 'natmap_port'
  AND `plugin_key` = 'natmap-port'
  AND `parser_key` = 'plain'
  AND `target_type` = 'all';
