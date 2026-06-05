-- 增量补齐本地博客管理菜单。
-- 用途：已有库不需要重跑完整 vben-admin-init.sql 时，可单独执行本文件。

SET NAMES utf8mb4;

INSERT INTO `admin_menu` (`id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`)
VALUES
  (2041700000000100300, 0, 'Blog', '/blog', NULL, '/blog/article', NULL, 'catalog', '{"icon":"lucide:newspaper","order":100,"title":"博客管理"}', 1, 100),
  (2041700000000100301, 2041700000000100300, 'BlogArticle', '/blog/article', '/blog/article/list', NULL, 'Blog:Article:List', 'menu', '{"icon":"lucide:file-text","title":"文章管理"}', 1, 0),
  (2041700000000120301, 2041700000000100301, 'BlogArticleCreate', NULL, NULL, NULL, 'Blog:Article:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120302, 2041700000000100301, 'BlogArticleEdit', NULL, NULL, NULL, 'Blog:Article:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120303, 2041700000000100301, 'BlogArticleDelete', NULL, NULL, NULL, 'Blog:Article:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120304, 2041700000000100301, 'BlogArticleImport', NULL, NULL, NULL, 'Blog:Article:Import', 'button', '{"title":"导入 WordPress"}', 1, 1),
  (2041700000000100302, 2041700000000100300, 'BlogCategory', '/blog/category', '/blog/category/list', NULL, 'Blog:Category:List', 'menu', '{"icon":"lucide:folder-tree","title":"分类管理"}', 1, 1),
  (2041700000000120311, 2041700000000100302, 'BlogCategoryCreate', NULL, NULL, NULL, 'Blog:Category:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120312, 2041700000000100302, 'BlogCategoryEdit', NULL, NULL, NULL, 'Blog:Category:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120313, 2041700000000100302, 'BlogCategoryDelete', NULL, NULL, NULL, 'Blog:Category:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100303, 2041700000000100300, 'BlogTag', '/blog/tag', '/blog/tag/list', NULL, 'Blog:Tag:List', 'menu', '{"icon":"lucide:tags","title":"标签管理"}', 1, 2),
  (2041700000000120321, 2041700000000100303, 'BlogTagCreate', NULL, NULL, NULL, 'Blog:Tag:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120322, 2041700000000100303, 'BlogTagEdit', NULL, NULL, NULL, 'Blog:Tag:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120323, 2041700000000100303, 'BlogTagDelete', NULL, NULL, NULL, 'Blog:Tag:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100304, 2041700000000100300, 'BlogTheme', '/blog/theme', '/blog/theme/config', NULL, 'Blog:Theme:List', 'menu', '{"icon":"lucide:palette","title":"主题配置"}', 1, 3),
  (2041700000000120331, 2041700000000100304, 'BlogThemeSave', NULL, NULL, NULL, 'Blog:Theme:Save', 'button', '{"title":"保存配置"}', 1, 0),
  (2041700000000120332, 2041700000000100304, 'BlogThemeImport', NULL, NULL, NULL, 'Blog:Theme:Import', 'button', '{"title":"导入 WordPress"}', 1, 1)
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

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` LIKE 'Blog%'
WHERE role.`role_code` IN ('super', 'admin')
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;
