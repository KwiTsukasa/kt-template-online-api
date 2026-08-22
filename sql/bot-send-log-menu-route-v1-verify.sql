-- 只读确认 Bot 发送日志菜单唯一且路由、组件路径与 Admin TSX 页面一致。

SET NAMES utf8mb4;

SELECT 'bot_send_log_menu_route' AS `check_name`, COUNT(*) AS `matched_rows`
FROM `admin_menu`
WHERE `id` = 2041700000000100406
  AND `name` = 'BotSendLog'
  AND `auth_code` = 'Bot:SendLog:List'
  AND `path` = '/bot/send-log'
  AND `component` = '/bot/send-log/list'
  AND `status` = 1
  AND `is_deleted` = 0;

SELECT 'bot_send_log_menu_route_mismatch' AS `check_name`, COUNT(*) AS `invalid_rows`
FROM `admin_menu`
WHERE `id` = 2041700000000100406
  AND (
    `name` <> 'BotSendLog'
    OR `auth_code` <> 'Bot:SendLog:List'
    OR `path` <> '/bot/send-log'
    OR `component` <> '/bot/send-log/list'
    OR `status` <> 1
    OR `is_deleted` <> 0
  );
