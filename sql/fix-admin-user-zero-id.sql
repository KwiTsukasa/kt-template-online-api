-- 修复旧 Snowflake 主键逻辑异常时写入的 admin_user.id = 0 数据。
-- 执行后再重启后端；新代码会在插入前自动补齐合法数字 ID。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @new_admin_user_id := 2041700000000099999;

UPDATE `admin_user_role`
SET `user_id` = @new_admin_user_id
WHERE `user_id` = 0;

UPDATE `admin_user`
SET `id` = @new_admin_user_id
WHERE `id` = 0;

SET FOREIGN_KEY_CHECKS = 1;
