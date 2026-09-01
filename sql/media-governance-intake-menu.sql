-- 增量注册媒体治理 API/Admin Demo；只授予启用中的超级管理员。

SET NAMES utf8mb4;

INSERT INTO `admin_menu` (
  `id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`
)
VALUES
  (2041700000000100600, 0, 'MediaGovernance', '/media/governance', NULL, '/media/governance/series', NULL, 'catalog', '{"icon":"lucide:folder-cog","order":120,"title":"媒体治理"}', 1, 120),
  (2041700000000100604, 2041700000000100600, 'MediaGovernanceSeries', '/media/governance/series', '/media/governance/series/list', NULL, 'Media:Governance:List', 'menu', '{"icon":"lucide:library-big","title":"系列资料库"}', 1, 0),
  (2041700000000100605, 2041700000000100600, 'MediaGovernanceSeriesDetail', '/media/governance/series/:seriesId', '/media/governance/series/detail', NULL, 'Media:Governance:List', 'menu', '{"activePath":"/media/governance/series","hideInMenu":true,"title":"媒体系列详情"}', 1, 0),
  (2041700000000100601, 2041700000000100600, 'MediaGovernanceTasks', '/media/governance/tasks', '/media/governance/tasks/list', NULL, 'Media:Governance:List', 'menu', '{"icon":"lucide:clapperboard","title":"执行任务"}', 1, 1),
  (2041700000000100602, 2041700000000100600, 'MediaScrapeValidation', '/media/scrape-validation', '/media/scrape-validation/list', NULL, 'Media:Governance:List', 'menu', '{"icon":"lucide:scan-search","title":"NAS 刮削校验"}', 1, 2),
  (2041700000000120601, 2041700000000100601, 'MediaGovernanceTaskList', NULL, NULL, NULL, 'Media:Governance:List', 'button', '{"title":"common.list"}', 1, 0),
  (2041700000000120602, 2041700000000100604, 'MediaGovernanceSeriesCreate', NULL, NULL, NULL, 'Media:Governance:Create', 'button', '{"title":"common.create"}', 1, 1),
  (2041700000000120603, 2041700000000100604, 'MediaGovernanceSourceUpload', NULL, NULL, NULL, 'Media:Governance:SourceUpload', 'button', '{"title":"来源上传"}', 1, 2),
  (2041700000000120604, 2041700000000100604, 'MediaGovernanceDownload', NULL, NULL, NULL, 'Media:Governance:Download', 'button', '{"title":"来源下载"}', 1, 3),
  (2041700000000120605, 2041700000000100604, 'MediaGovernanceRun', NULL, NULL, NULL, 'Media:Governance:Run', 'button', '{"title":"开始治理"}', 1, 4),
  (2041700000000120609, 2041700000000100604, 'MediaGovernanceEvidence', NULL, NULL, NULL, 'Media:Governance:Evidence', 'button', '{"title":"查看证据"}', 1, 8),
  (2041700000000120610, 2041700000000100604, 'MediaGovernanceSeriesDelete', NULL, NULL, NULL, 'Media:Governance:Delete', 'button', '{"title":"删除空系列"}', 1, 9)
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
    'MediaGovernance',
    'MediaGovernanceSeries',
    'MediaGovernanceSeriesDetail',
    'MediaGovernanceTasks',
    'MediaScrapeValidation',
    'MediaGovernanceTaskList',
    'MediaGovernanceSeriesCreate',
    'MediaGovernanceSourceUpload',
    'MediaGovernanceDownload',
    'MediaGovernanceRun',
    'MediaGovernanceEvidence',
    'MediaGovernanceSeriesDelete'
  );

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` IN (
  'MediaGovernance',
  'MediaGovernanceSeries',
  'MediaGovernanceSeriesDetail',
  'MediaGovernanceTasks',
  'MediaScrapeValidation',
  'MediaGovernanceTaskList',
  'MediaGovernanceSeriesCreate',
  'MediaGovernanceSourceUpload',
  'MediaGovernanceDownload',
  'MediaGovernanceRun',
  'MediaGovernanceEvidence',
  'MediaGovernanceSeriesDelete'
)
WHERE role.`role_code` = 'super'
  AND role.`status` = 1
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;

UPDATE `admin_menu`
SET `status` = 0,
    `is_deleted` = 1
WHERE `name` IN (
  'MediaGovernanceAgentQueue',
  'MediaGovernanceAgentSession',
  'MediaGovernanceAgentStart',
  'MediaGovernanceAgentOperate',
  'MediaGovernanceOperatorDecision'
);
