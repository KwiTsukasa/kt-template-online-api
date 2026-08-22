-- 将既有 Bot 发送日志菜单对齐到 Admin 的 kebab-case TSX 页面路径。
-- 本迁移仅修改具名菜单行；身份或当前组件异常时保持原状并由校验脚本失败关闭。

SET NAMES utf8mb4;

START TRANSACTION;

UPDATE `admin_menu`
SET `name` = 'BotSendLog',
    `path` = '/bot/send-log',
    `component` = '/bot/send-log/list',
    `auth_code` = 'Bot:SendLog:List'
WHERE `id` = 2041700000000100406
  AND `name` IN ('QqBotSendLog', 'BotSendLog')
  AND `auth_code` IN ('QqBot:SendLog:List', 'Bot:SendLog:List')
  AND `path` IN ('/qqbot/sendLog', '/qqbot/send-log', '/bot/send-log')
  AND `component` IN ('/qqbot/sendLog/list', '/qqbot/send-log/list', '/bot/send-log/list')
  AND `is_deleted` = 0;

COMMIT;
