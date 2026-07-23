-- 增量初始化通用网络管理菜单；仅授予启用中的超级管理员。

SET NAMES utf8mb4;

INSERT INTO `admin_menu` (
  `id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`
)
VALUES
  (2041700000000100207, 2041700000000100002, 'SystemNetwork', '/system/network', '/system/network/list', NULL, NULL, 'menu', '{"icon":"lucide:router","title":"system.network.title"}', 1, 8),
  (2041700000000120214, 2041700000000100207, 'SystemNetworkPortForwardList', NULL, NULL, NULL, 'System:Network:PortForward:List', 'button', '{"title":"common.list"}', 1, 1),
  (2041700000000120215, 2041700000000100207, 'SystemNetworkPortForwardCreate', NULL, NULL, NULL, 'System:Network:PortForward:Create', 'button', '{"title":"common.create"}', 1, 2),
  (2041700000000120216, 2041700000000100207, 'SystemNetworkPortForwardUpdate', NULL, NULL, NULL, 'System:Network:PortForward:Update', 'button', '{"title":"common.edit"}', 1, 3),
  (2041700000000120217, 2041700000000100207, 'SystemNetworkPortForwardDelete', NULL, NULL, NULL, 'System:Network:PortForward:Delete', 'button', '{"title":"common.delete"}', 1, 4),
  (2041700000000120218, 2041700000000100207, 'SystemNetworkPortForwardRetry', NULL, NULL, NULL, 'System:Network:PortForward:Retry', 'button', '{"title":"common.retry"}', 1, 5),
  (2041700000000120219, 2041700000000100207, 'SystemNetworkPortForwardKeeper', NULL, NULL, NULL, 'System:Network:PortForward:Keeper', 'button', '{"title":"system.network.keeper"}', 1, 6),
  (2041700000000120220, 2041700000000100207, 'SystemNetworkPortForwardProbe', NULL, NULL, NULL, 'System:Network:PortForward:Probe', 'button', '{"title":"system.network.probe"}', 1, 7),
  (2041700000000120221, 2041700000000100207, 'SystemNetworkPortForwardHistory', NULL, NULL, NULL, 'System:Network:PortForward:History', 'button', '{"title":"system.network.history"}', 1, 8),
  (2041700000000120222, 2041700000000100207, 'SystemNetworkDdnsList', NULL, NULL, NULL, 'System:Network:Ddns:List', 'button', '{"title":"common.list"}', 1, 9),
  (2041700000000120223, 2041700000000100207, 'SystemNetworkDdnsCreate', NULL, NULL, NULL, 'System:Network:Ddns:Create', 'button', '{"title":"common.create"}', 1, 10),
  (2041700000000120224, 2041700000000100207, 'SystemNetworkDdnsUpdate', NULL, NULL, NULL, 'System:Network:Ddns:Update', 'button', '{"title":"common.edit"}', 1, 11),
  (2041700000000120225, 2041700000000100207, 'SystemNetworkDdnsDelete', NULL, NULL, NULL, 'System:Network:Ddns:Delete', 'button', '{"title":"common.delete"}', 1, 12),
  (2041700000000120226, 2041700000000100207, 'SystemNetworkDdnsRetry', NULL, NULL, NULL, 'System:Network:Ddns:Retry', 'button', '{"title":"common.retry"}', 1, 13)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `pid` = VALUES(`pid`),
  `path` = VALUES(`path`),
  `component` = VALUES(`component`),
  `redirect` = VALUES(`redirect`),
  `auth_code` = VALUES(`auth_code`),
  `type` = VALUES(`type`),
  `meta` = VALUES(`meta`),
  `status` = VALUES(`status`),
  `sort` = VALUES(`sort`),
  `is_deleted` = 0;

DELETE role_menu
FROM `admin_role_menu` role_menu
JOIN `admin_role` role ON role.`id` = role_menu.`role_id`
JOIN `admin_menu` menu ON menu.`id` = role_menu.`menu_id`
WHERE role.`role_code` <> 'super'
  AND menu.`name` IN (
    'SystemNetwork',
    'SystemNetworkPortForwardList',
    'SystemNetworkPortForwardCreate',
    'SystemNetworkPortForwardUpdate',
    'SystemNetworkPortForwardDelete',
    'SystemNetworkPortForwardRetry',
    'SystemNetworkPortForwardKeeper',
    'SystemNetworkPortForwardProbe',
    'SystemNetworkPortForwardHistory',
    'SystemNetworkDdnsList',
    'SystemNetworkDdnsCreate',
    'SystemNetworkDdnsUpdate',
    'SystemNetworkDdnsDelete',
    'SystemNetworkDdnsRetry'
  );

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` IN (
  'SystemNetwork',
  'SystemNetworkPortForwardList',
  'SystemNetworkPortForwardCreate',
  'SystemNetworkPortForwardUpdate',
  'SystemNetworkPortForwardDelete',
  'SystemNetworkPortForwardRetry',
  'SystemNetworkPortForwardKeeper',
  'SystemNetworkPortForwardProbe',
  'SystemNetworkPortForwardHistory',
  'SystemNetworkDdnsList',
  'SystemNetworkDdnsCreate',
  'SystemNetworkDdnsUpdate',
  'SystemNetworkDdnsDelete',
  'SystemNetworkDdnsRetry'
)
WHERE role.`role_code` = 'super'
  AND role.`status` = 1
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;
