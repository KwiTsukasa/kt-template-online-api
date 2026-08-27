-- 只读确认 Series 删除权限身份唯一，且只授予启用中的超级管理员。

SET NAMES utf8mb4;

SELECT COUNT(*) AS `series_delete_permission_identity_count`
FROM `admin_menu`
WHERE `id` = 2041700000000120610
  AND `pid` = 2041700000000100604
  AND `name` = 'MediaGovernanceSeriesDelete'
  AND `auth_code` = 'Media:Governance:Delete'
  AND `type` = 'button';

SELECT COUNT(*) AS `series_delete_permission_conflict_count`
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

SELECT GREATEST(COUNT(*) - 1, 0) AS `series_delete_permission_duplicate_count`
FROM `admin_menu`
WHERE `id` = 2041700000000120610
  AND `pid` = 2041700000000100604
  AND `name` = 'MediaGovernanceSeriesDelete'
  AND `auth_code` = 'Media:Governance:Delete'
  AND `type` = 'button';

SELECT COUNT(*) AS `series_delete_missing_super_binding_count`
FROM `admin_role` AS role
INNER JOIN `admin_menu` AS menu
  ON menu.`id` = 2041700000000120610
  AND menu.`status` = 1
  AND menu.`is_deleted` = 0
LEFT JOIN `admin_role_menu` AS role_menu
  ON role_menu.`role_id` = role.`id`
  AND role_menu.`menu_id` = menu.`id`
WHERE role.`role_code` = 'super'
  AND role.`status` = 1
  AND role.`is_deleted` = 0
  AND role_menu.`role_id` IS NULL;

SELECT COUNT(*) AS `series_delete_non_super_binding_count`
FROM `admin_role_menu` AS role_menu
INNER JOIN `admin_role` AS role ON role.`id` = role_menu.`role_id`
WHERE role_menu.`menu_id` = 2041700000000120610
  AND role.`role_code` <> 'super';
