-- 为 Series 空壳删除注册独立按钮权限，只授予启用中的超级管理员。
-- 重复执行不覆盖管理员对既有权限行的启停或删除状态，身份冲突时失败关闭。

SET NAMES utf8mb4;

DELIMITER $$

DROP PROCEDURE IF EXISTS `kt_migrate_media_series_delete_v1`$$

CREATE PROCEDURE `kt_migrate_media_series_delete_v1`()
BEGIN
  DECLARE exact_identity_count BIGINT DEFAULT 0;
  DECLARE identity_conflict_count BIGINT DEFAULT 0;

  SELECT COUNT(*) INTO identity_conflict_count
  FROM `admin_menu`
  WHERE (
      `id` = 2041700000000120610
      OR `name` = 'MediaGovernanceSeriesDelete'
      OR `auth_code` = 'Media:Governance:Delete'
    )
    AND NOT (
      `id` = 2041700000000120610
      AND `pid` = 2041700000000100604
      AND `name` = 'MediaGovernanceSeriesDelete'
      AND `auth_code` = 'Media:Governance:Delete'
      AND `type` = 'button'
    );

  IF identity_conflict_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Media Series delete permission identity conflicts with an existing menu';
  END IF;

  SELECT COUNT(*) INTO exact_identity_count
  FROM `admin_menu`
  WHERE `id` = 2041700000000120610
    AND `pid` = 2041700000000100604
    AND `name` = 'MediaGovernanceSeriesDelete'
    AND `auth_code` = 'Media:Governance:Delete'
    AND `type` = 'button';

  IF exact_identity_count > 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Media Series delete permission identity is duplicated';
  END IF;

  IF exact_identity_count = 0 THEN
    INSERT INTO `admin_menu` (
      `id`,
      `pid`,
      `name`,
      `path`,
      `component`,
      `redirect`,
      `auth_code`,
      `type`,
      `meta`,
      `status`,
      `sort`
    ) VALUES (
      2041700000000120610,
      2041700000000100604,
      'MediaGovernanceSeriesDelete',
      NULL,
      NULL,
      NULL,
      'Media:Governance:Delete',
      'button',
      '{"title":"删除空系列"}',
      1,
      9
    );
  END IF;
END$$

CALL `kt_migrate_media_series_delete_v1`()$$
DROP PROCEDURE `kt_migrate_media_series_delete_v1`$$

DELIMITER ;

DELETE role_menu
FROM `admin_role_menu` AS role_menu
INNER JOIN `admin_role` AS role ON role.`id` = role_menu.`role_id`
WHERE role_menu.`menu_id` = 2041700000000120610
  AND role.`role_code` <> 'super';

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` AS role
INNER JOIN `admin_menu` AS menu
  ON menu.`id` = 2041700000000120610
  AND menu.`name` = 'MediaGovernanceSeriesDelete'
  AND menu.`auth_code` = 'Media:Governance:Delete'
  AND menu.`status` = 1
  AND menu.`is_deleted` = 0
WHERE role.`role_code` = 'super'
  AND role.`status` = 1
  AND role.`is_deleted` = 0;
