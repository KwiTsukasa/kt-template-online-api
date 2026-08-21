-- 增量注册媒体治理 API/Admin Demo；只授予启用中的超级管理员。

SET NAMES utf8mb4;

INSERT INTO `admin_menu` (
  `id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`
)
VALUES
  (2041700000000100600, 0, 'MediaGovernance', '/media/governance', NULL, '/media/governance/tasks', NULL, 'catalog', '{"icon":"lucide:folder-cog","order":120,"title":"媒体治理"}', 1, 120),
  (2041700000000100601, 2041700000000100600, 'MediaGovernanceTasks', '/media/governance/tasks', '/media/governance/tasks/list', NULL, 'Media:Governance:List', 'menu', '{"icon":"lucide:clapperboard","title":"治理任务"}', 1, 0),
  (2041700000000100602, 2041700000000100600, 'MediaGovernanceAgentQueue', '/media/governance/agent-queue', '/media/governance/agent-queue/list', NULL, 'Media:Governance:List', 'menu', '{"icon":"lucide:bot","title":"Agent 治理队列"}', 1, 1),
  (2041700000000100603, 2041700000000100600, 'MediaGovernanceAgentSession', '/media/governance/tasks/:taskId/agent', '/media/governance/agent-session/index', NULL, 'Media:Governance:AgentOperate', 'menu', '{"activePath":"/media/governance/tasks","hideInMenu":true,"hideInTab":true,"title":"CodexAgent 治理会话"}', 1, 2),
  (2041700000000120601, 2041700000000100601, 'MediaGovernanceTaskList', NULL, NULL, NULL, 'Media:Governance:List', 'button', '{"title":"common.list"}', 1, 0),
  (2041700000000120602, 2041700000000100601, 'MediaGovernanceTaskCreate', NULL, NULL, NULL, 'Media:Governance:Create', 'button', '{"title":"common.create"}', 1, 1),
  (2041700000000120603, 2041700000000100601, 'MediaGovernanceSourceUpload', NULL, NULL, NULL, 'Media:Governance:SourceUpload', 'button', '{"title":"来源上传"}', 1, 2),
  (2041700000000120604, 2041700000000100601, 'MediaGovernanceDownload', NULL, NULL, NULL, 'Media:Governance:Download', 'button', '{"title":"来源下载"}', 1, 3),
  (2041700000000120605, 2041700000000100601, 'MediaGovernanceRun', NULL, NULL, NULL, 'Media:Governance:Run', 'button', '{"title":"开始治理"}', 1, 4),
  (2041700000000120606, 2041700000000100601, 'MediaGovernanceAgentStart', NULL, NULL, NULL, 'Media:Governance:AgentStart', 'button', '{"title":"启动 Agent"}', 1, 5),
  (2041700000000120607, 2041700000000100601, 'MediaGovernanceAgentOperate', NULL, NULL, NULL, 'Media:Governance:AgentOperate', 'button', '{"title":"Agent 操作"}', 1, 6),
  (2041700000000120608, 2041700000000100601, 'MediaGovernanceOperatorDecision', NULL, NULL, NULL, 'Media:Governance:OperatorDecision', 'button', '{"title":"人工放行"}', 1, 7),
  (2041700000000120609, 2041700000000100601, 'MediaGovernanceEvidence', NULL, NULL, NULL, 'Media:Governance:Evidence', 'button', '{"title":"查看证据"}', 1, 8)
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
    'MediaGovernanceTasks',
    'MediaGovernanceAgentQueue',
    'MediaGovernanceAgentSession',
    'MediaGovernanceTaskList',
    'MediaGovernanceTaskCreate',
    'MediaGovernanceSourceUpload',
    'MediaGovernanceDownload',
    'MediaGovernanceRun',
    'MediaGovernanceAgentStart',
    'MediaGovernanceAgentOperate',
    'MediaGovernanceOperatorDecision',
    'MediaGovernanceEvidence'
  );

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` IN (
  'MediaGovernance',
  'MediaGovernanceTasks',
  'MediaGovernanceAgentQueue',
  'MediaGovernanceAgentSession',
  'MediaGovernanceTaskList',
  'MediaGovernanceTaskCreate',
  'MediaGovernanceSourceUpload',
  'MediaGovernanceDownload',
  'MediaGovernanceRun',
  'MediaGovernanceAgentStart',
  'MediaGovernanceAgentOperate',
  'MediaGovernanceOperatorDecision',
  'MediaGovernanceEvidence'
)
WHERE role.`role_code` = 'super'
  AND role.`status` = 1
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;
