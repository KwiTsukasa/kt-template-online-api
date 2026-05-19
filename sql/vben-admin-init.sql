-- Vben Admin 后台初始化 SQL
-- 用途：为 kt-template-admin 提供用户、角色、菜单、部门、字典表结构和基础数据。
-- 说明：应用启动不会自动写入这些数据；请按目标环境手动导入本文件。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `admin_menu` (
  `id` bigint NOT NULL,
  `pid` bigint NOT NULL DEFAULT 0,
  `name` varchar(120) NOT NULL,
  `path` varchar(255) DEFAULT NULL,
  `component` varchar(255) DEFAULT NULL,
  `redirect` varchar(255) DEFAULT NULL,
  `auth_code` varchar(120) DEFAULT NULL,
  `type` varchar(32) NOT NULL DEFAULT 'menu',
  `meta` longtext DEFAULT NULL,
  `status` int NOT NULL DEFAULT 1,
  `sort` int NOT NULL DEFAULT 0,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_menu_name` (`name`),
  KEY `idx_admin_menu_pid` (`pid`),
  KEY `idx_admin_menu_path` (`path`),
  KEY `idx_admin_menu_auth_code` (`auth_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_role` (
  `id` bigint NOT NULL,
  `role_code` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `status` int NOT NULL DEFAULT 1,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_role_code` (`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_user` (
  `id` bigint NOT NULL,
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `real_name` varchar(255) NOT NULL,
  `home_path` varchar(255) NOT NULL DEFAULT '',
  `timezone` varchar(255) NOT NULL DEFAULT 'Asia/Shanghai',
  `status` int NOT NULL DEFAULT 1,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_user_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_dept` (
  `id` bigint NOT NULL,
  `pid` bigint NOT NULL DEFAULT 0,
  `name` varchar(255) NOT NULL,
  `status` int NOT NULL DEFAULT 1,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_admin_dept_pid` (`pid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_dict` (
  `id` bigint NOT NULL,
  `dict_code` varchar(255) NOT NULL,
  `label` varchar(255) NOT NULL,
  `value` varchar(255) NOT NULL,
  `children_code` varchar(255) DEFAULT NULL,
  `sort` int NOT NULL DEFAULT 0,
  `status` int NOT NULL DEFAULT 1,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_dict_code_value` (`dict_code`, `value`),
  KEY `idx_admin_dict_code` (`dict_code`),
  KEY `idx_admin_dict_children_code` (`children_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_component` (
  `id` bigint NOT NULL,
  `name` varchar(255) NOT NULL DEFAULT '',
  `type` int NOT NULL,
  `component_type` int NOT NULL,
  `image` mediumtext NOT NULL,
  `template` mediumtext NOT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_admin_component_type` (`type`),
  KEY `idx_admin_component_component_type` (`component_type`),
  KEY `idx_admin_component_deleted` (`is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_user_role` (
  `user_id` bigint NOT NULL,
  `role_id` bigint NOT NULL,
  PRIMARY KEY (`user_id`, `role_id`),
  KEY `idx_admin_user_role_role_id` (`role_id`),
  CONSTRAINT `fk_admin_user_role_user` FOREIGN KEY (`user_id`) REFERENCES `admin_user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_admin_user_role_role` FOREIGN KEY (`role_id`) REFERENCES `admin_role` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_role_menu` (
  `role_id` bigint NOT NULL,
  `menu_id` bigint NOT NULL,
  PRIMARY KEY (`role_id`, `menu_id`),
  KEY `idx_admin_role_menu_menu_id` (`menu_id`),
  CONSTRAINT `fk_admin_role_menu_role` FOREIGN KEY (`role_id`) REFERENCES `admin_role` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_admin_role_menu_menu` FOREIGN KEY (`menu_id`) REFERENCES `admin_menu` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_menu` (`id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`)
VALUES
  (2041700000000100001, 0, 'Dashboard', '/dashboard', NULL, '/analytics', NULL, 'catalog', '{"order":-1,"title":"page.dashboard.title"}', 1, 0),
  (2041700000000100101, 2041700000000100001, 'Analytics', '/analytics', '/dashboard/analytics/index', NULL, NULL, 'menu', '{"affixTab":true,"title":"page.dashboard.analytics"}', 1, 0),
  (2041700000000100102, 2041700000000100001, 'Workspace', '/workspace', '/dashboard/workspace/index', NULL, NULL, 'menu', '{"icon":"carbon:workspace","title":"page.dashboard.workspace"}', 1, 0),
  (2041700000000100002, 0, 'System', '/system', NULL, NULL, NULL, 'catalog', '{"badge":"new","badgeType":"normal","badgeVariants":"primary","icon":"carbon:settings","order":9997,"title":"system.title"}', 1, 9997),
  (2041700000000100200, 2041700000000100002, 'SystemRole', '/system/role', '/system/role/list', NULL, 'System:Role:List', 'menu', '{"icon":"carbon:user-role","title":"system.role.title"}', 1, 0),
  (2041700000000120001, 2041700000000100200, 'SystemRoleCreate', NULL, NULL, NULL, 'System:Role:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120002, 2041700000000100200, 'SystemRoleEdit', NULL, NULL, NULL, 'System:Role:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120003, 2041700000000100200, 'SystemRoleDelete', NULL, NULL, NULL, 'System:Role:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100201, 2041700000000100002, 'SystemMenu', '/system/menu', '/system/menu/list', NULL, 'System:Menu:List', 'menu', '{"icon":"carbon:menu","title":"system.menu.title"}', 1, 0),
  (2041700000000120101, 2041700000000100201, 'SystemMenuCreate', NULL, NULL, NULL, 'System:Menu:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120102, 2041700000000100201, 'SystemMenuEdit', NULL, NULL, NULL, 'System:Menu:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120103, 2041700000000100201, 'SystemMenuDelete', NULL, NULL, NULL, 'System:Menu:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100202, 2041700000000100002, 'SystemDept', '/system/dept', '/system/dept/list', NULL, 'System:Dept:List', 'menu', '{"icon":"carbon:container-services","title":"system.dept.title"}', 1, 0),
  (2041700000000120201, 2041700000000100202, 'SystemDeptCreate', NULL, NULL, NULL, 'System:Dept:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120202, 2041700000000100202, 'SystemDeptEdit', NULL, NULL, NULL, 'System:Dept:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120203, 2041700000000100202, 'SystemDeptDelete', NULL, NULL, NULL, 'System:Dept:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100203, 2041700000000100002, 'SystemKtTableDemo', '/system/ktTableDemo', '/system/ktTableDemo/list', NULL, 'System:KtTableDemo:List', 'menu', '{"icon":"lucide:table-2","title":"system.ktTableDemo.title"}', 1, 3),
  (2041700000000120204, 2041700000000100203, 'SystemKtTableDemoCreate', NULL, NULL, NULL, 'System:KtTableDemo:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120205, 2041700000000100203, 'SystemKtTableDemoEdit', NULL, NULL, NULL, 'System:KtTableDemo:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120206, 2041700000000100203, 'SystemKtTableDemoDelete', NULL, NULL, NULL, 'System:KtTableDemo:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100300, 0, 'Blog', '/blog', NULL, '/blog/article', NULL, 'catalog', '{"icon":"lucide:newspaper","order":100,"title":"博客管理"}', 1, 100),
  (2041700000000100301, 2041700000000100300, 'BlogArticle', '/blog/article', '/blog/article/list', NULL, 'Blog:Article:List', 'menu', '{"icon":"lucide:file-text","title":"文章管理"}', 1, 0),
  (2041700000000120301, 2041700000000100301, 'BlogArticleCreate', NULL, NULL, NULL, 'Blog:Article:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120302, 2041700000000100301, 'BlogArticleEdit', NULL, NULL, NULL, 'Blog:Article:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120303, 2041700000000100301, 'BlogArticleDelete', NULL, NULL, NULL, 'Blog:Article:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100302, 2041700000000100300, 'BlogCategory', '/blog/category', '/blog/category/list', NULL, 'Blog:Category:List', 'menu', '{"icon":"lucide:folder-tree","title":"分类管理"}', 1, 1),
  (2041700000000120311, 2041700000000100302, 'BlogCategoryCreate', NULL, NULL, NULL, 'Blog:Category:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120312, 2041700000000100302, 'BlogCategoryEdit', NULL, NULL, NULL, 'Blog:Category:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120313, 2041700000000100302, 'BlogCategoryDelete', NULL, NULL, NULL, 'Blog:Category:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100303, 2041700000000100300, 'BlogTag', '/blog/tag', '/blog/tag/list', NULL, 'Blog:Tag:List', 'menu', '{"icon":"lucide:tags","title":"标签管理"}', 1, 2),
  (2041700000000120321, 2041700000000100303, 'BlogTagCreate', NULL, NULL, NULL, 'Blog:Tag:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120322, 2041700000000100303, 'BlogTagEdit', NULL, NULL, NULL, 'Blog:Tag:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120323, 2041700000000100303, 'BlogTagDelete', NULL, NULL, NULL, 'Blog:Tag:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100009, 0, 'Project', '/vben-admin', NULL, NULL, NULL, 'catalog', '{"badgeType":"dot","icon":"carbon:data-center","order":9998,"title":"demos.vben.title"}', 1, 9998),
  (2041700000000100901, 2041700000000100009, 'VbenDocument', '/vben-admin/document', 'IFrameView', NULL, NULL, 'embedded', '{"icon":"carbon:book","iframeSrc":"https://doc.vben.pro","title":"demos.vben.document"}', 1, 0),
  (2041700000000100902, 2041700000000100009, 'VbenGithub', '/vben-admin/github', 'IFrameView', NULL, NULL, 'link', '{"icon":"carbon:logo-github","link":"https://github.com/vbenjs/vue-vben-admin","title":"Github"}', 1, 0),
  (2041700000000100010, 0, 'About', '/about', '_core/about/index', NULL, NULL, 'menu', '{"icon":"lucide:copyright","order":9999,"title":"demos.vben.about"}', 1, 9999)
ON DUPLICATE KEY UPDATE
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

INSERT INTO `admin_role` (`id`, `role_code`, `name`, `remark`, `status`)
VALUES
  (2041700000000010001, 'super', '超级管理员', '拥有所有后台权限', 1),
  (2041700000000010002, 'admin', '管理员', '拥有系统管理与工作台权限', 1),
  (2041700000000010003, 'user', '普通用户', '仅拥有基础查看权限', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `remark` = VALUES(`remark`),
  `status` = VALUES(`status`),
  `is_deleted` = 0;

INSERT INTO `admin_user` (`id`, `username`, `password`, `real_name`, `home_path`, `timezone`, `status`)
VALUES
  (2041700000000000001, 'vben', '123456', 'Vben', '/workspace', 'Asia/Shanghai', 1),
  (2041700000000000002, 'admin', '123456', 'Admin', '/workspace', 'Asia/Shanghai', 1),
  (2041700000000000003, 'jack', '123456', 'Jack', '/analytics', 'Asia/Shanghai', 1)
ON DUPLICATE KEY UPDATE
  `password` = VALUES(`password`),
  `real_name` = VALUES(`real_name`),
  `home_path` = VALUES(`home_path`),
  `timezone` = VALUES(`timezone`),
  `status` = VALUES(`status`),
  `is_deleted` = 0;

INSERT INTO `admin_dept` (`id`, `pid`, `name`, `status`, `remark`)
VALUES
  (2041700000000200001, 0, 'KT 总部', 1, '根部门'),
  (2041700000000200002, 2041700000000200001, '研发中心', 1, '产品研发与平台建设'),
  (2041700000000200003, 2041700000000200001, '运营中心', 1, '模板运营与内容管理')
ON DUPLICATE KEY UPDATE
  `pid` = VALUES(`pid`),
  `name` = VALUES(`name`),
  `status` = VALUES(`status`),
  `remark` = VALUES(`remark`),
  `is_deleted` = 0;

INSERT INTO `admin_dict` (`id`, `dict_code`, `label`, `value`, `children_code`, `sort`, `status`)
VALUES
  (2041700000000300001, 'COMPONENT_TYPE', '图表', '1', 'CHART', 1, 1),
  (2041700000000300002, 'COMPONENT_TYPE', '组件', '2', 'COMPONENT', 2, 1),
  (2041700000000300101, 'CHART', '未分类', '-1', NULL, 0, 1),
  (2041700000000300102, 'CHART', '折线图', '1', NULL, 1, 1),
  (2041700000000300103, 'CHART', '柱状图', '2', NULL, 2, 1),
  (2041700000000300104, 'CHART', '饼图', '3', NULL, 3, 1),
  (2041700000000300201, 'COMPONENT', '未分类', '-1', NULL, 0, 1),
  (2041700000000300202, 'COMPONENT', '基础组件', '1', NULL, 1, 1),
  (2041700000000300203, 'COMPONENT', '业务组件', '2', NULL, 2, 1)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `children_code` = VALUES(`children_code`),
  `sort` = VALUES(`sort`),
  `status` = VALUES(`status`),
  `is_deleted` = 0;

DELETE FROM `admin_user_role`
WHERE `user_id` IN (
  2041700000000000001,
  2041700000000000002,
  2041700000000000003
);

INSERT INTO `admin_user_role` (`user_id`, `role_id`)
VALUES
  (2041700000000000001, 2041700000000010001),
  (2041700000000000002, 2041700000000010002),
  (2041700000000000003, 2041700000000010003);

DELETE FROM `admin_role_menu`
WHERE `role_id` IN (
  2041700000000010001,
  2041700000000010002,
  2041700000000010003
);

INSERT INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT 2041700000000010001, `id`
FROM `admin_menu`
WHERE `is_deleted` = 0;

INSERT INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT 2041700000000010002, `id`
FROM `admin_menu`
WHERE `is_deleted` = 0;

INSERT INTO `admin_role_menu` (`role_id`, `menu_id`)
VALUES
  (2041700000000010003, 2041700000000100001),
  (2041700000000010003, 2041700000000100101),
  (2041700000000010003, 2041700000000100102),
  (2041700000000010003, 2041700000000100009),
  (2041700000000010003, 2041700000000100901),
  (2041700000000010003, 2041700000000100902),
  (2041700000000010003, 2041700000000100010);

SET FOREIGN_KEY_CHECKS = 1;
