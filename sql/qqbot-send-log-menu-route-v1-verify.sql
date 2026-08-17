-- 只读确认 QQBot 发送日志菜单唯一且路由、组件路径与 Admin TSX 页面一致。

SET NAMES utf8mb4;

SELECT 'qqbot_send_log_menu_route' AS `check_name`, COUNT(*) AS `matched_rows`
FROM `admin_menu`
WHERE `id` = 2041700000000100406
  AND `name` = 'QqBotSendLog'
  AND `auth_code` = 'QqBot:SendLog:List'
  AND `path` = '/qqbot/send-log'
  AND `component` = '/qqbot/send-log/list'
  AND `status` = 1
  AND `is_deleted` = 0;

SELECT 'qqbot_send_log_menu_route_mismatch' AS `check_name`, COUNT(*) AS `invalid_rows`
FROM `admin_menu`
WHERE `id` = 2041700000000100406
  AND (
    `name` <> 'QqBotSendLog'
    OR `auth_code` <> 'QqBot:SendLog:List'
    OR `path` <> '/qqbot/send-log'
    OR `component` <> '/qqbot/send-log/list'
    OR `status` <> 1
    OR `is_deleted` <> 0
  );
