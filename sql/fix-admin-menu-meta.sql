-- 修复基础后台菜单 meta 被写空的问题。
-- 只覆盖初始化 SQL 中维护的系统菜单，不影响自定义菜单。

SET NAMES utf8mb4;

UPDATE `admin_menu`
SET `meta` = CASE `name`
  WHEN 'Dashboard' THEN '{"order":-1,"title":"page.dashboard.title"}'
  WHEN 'Analytics' THEN '{"affixTab":true,"title":"page.dashboard.analytics"}'
  WHEN 'Workspace' THEN '{"icon":"carbon:workspace","title":"page.dashboard.workspace"}'
  WHEN 'System' THEN '{"badge":"new","badgeType":"normal","badgeVariants":"primary","icon":"carbon:settings","order":9997,"title":"system.title"}'
  WHEN 'SystemRole' THEN '{"icon":"carbon:user-role","title":"system.role.title"}'
  WHEN 'SystemRoleCreate' THEN '{"title":"common.create"}'
  WHEN 'SystemRoleEdit' THEN '{"title":"common.edit"}'
  WHEN 'SystemRoleDelete' THEN '{"title":"common.delete"}'
  WHEN 'SystemMenu' THEN '{"icon":"carbon:menu","title":"system.menu.title"}'
  WHEN 'SystemMenuCreate' THEN '{"title":"common.create"}'
  WHEN 'SystemMenuEdit' THEN '{"title":"common.edit"}'
  WHEN 'SystemMenuDelete' THEN '{"title":"common.delete"}'
  WHEN 'SystemDept' THEN '{"icon":"carbon:container-services","title":"system.dept.title"}'
  WHEN 'SystemDeptCreate' THEN '{"title":"common.create"}'
  WHEN 'SystemDeptEdit' THEN '{"title":"common.edit"}'
  WHEN 'SystemDeptDelete' THEN '{"title":"common.delete"}'
  WHEN 'Project' THEN '{"badgeType":"dot","icon":"carbon:data-center","order":9998,"title":"demos.vben.title"}'
  WHEN 'VbenDocument' THEN '{"icon":"carbon:book","iframeSrc":"https://doc.vben.pro","title":"demos.vben.document"}'
  WHEN 'VbenGithub' THEN '{"icon":"carbon:logo-github","link":"https://github.com/vbenjs/vue-vben-admin","title":"Github"}'
  WHEN 'About' THEN '{"icon":"lucide:copyright","order":9999,"title":"demos.vben.about"}'
  ELSE `meta`
END
WHERE `name` IN (
  'Dashboard',
  'Analytics',
  'Workspace',
  'System',
  'SystemRole',
  'SystemRoleCreate',
  'SystemRoleEdit',
  'SystemRoleDelete',
  'SystemMenu',
  'SystemMenuCreate',
  'SystemMenuEdit',
  'SystemMenuDelete',
  'SystemDept',
  'SystemDeptCreate',
  'SystemDeptEdit',
  'SystemDeptDelete',
  'Project',
  'VbenDocument',
  'VbenGithub',
  'About'
);
