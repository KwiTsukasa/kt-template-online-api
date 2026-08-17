-- 将既有 QQBot 发送日志菜单对齐到 Admin 的 kebab-case TSX 页面路径。
-- 本迁移仅修改具名菜单行；身份或当前组件异常时保持原状并由校验脚本失败关闭。

SET NAMES utf8mb4;

START TRANSACTION;

UPDATE `admin_menu`
SET `path` = '/qqbot/send-log',
    `component` = '/qqbot/send-log/list'
WHERE `id` = 2041700000000100406
  AND `name` = 'QqBotSendLog'
  AND `auth_code` = 'QqBot:SendLog:List'
  AND `path` IN ('/qqbot/sendLog', '/qqbot/send-log')
  AND `component` IN ('/qqbot/sendLog/list', '/qqbot/send-log/list')
  AND `is_deleted` = 0;

COMMIT;
