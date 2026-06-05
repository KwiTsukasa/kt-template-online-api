-- Blog 初始化 SQL
-- 用途：补齐本地 Markdown 博客文章、分类和标签表结构。
-- 说明：生产环境建议关闭 DB_SYNC 后导入本文件；本文件不会清空已有数据。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `blog_article` (
  `id` bigint NOT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL DEFAULT '',
  `status` varchar(32) NOT NULL DEFAULT 'draft',
  `excerpt` text DEFAULT NULL,
  `content_markdown` mediumtext DEFAULT NULL,
  `content_html` mediumtext DEFAULT NULL,
  `cover` text DEFAULT NULL,
  `author_name` varchar(255) NOT NULL DEFAULT 'KwiTsukasa',
  `category_items` text DEFAULT NULL,
  `tag_items` text DEFAULT NULL,
  `views` int NOT NULL DEFAULT 0,
  `comments` int NOT NULL DEFAULT 0,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `publish_time` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_blog_article_slug` (`slug`),
  KEY `idx_blog_article_status` (`status`),
  KEY `idx_blog_article_publish_time` (`publish_time`),
  KEY `idx_blog_article_is_deleted` (`is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `blog_term` (
  `id` bigint NOT NULL,
  `kind` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL DEFAULT '',
  `description` text DEFAULT NULL,
  `parent_id` varchar(64) DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_blog_term_kind_slug` (`kind`, `slug`),
  KEY `idx_blog_term_parent_id` (`parent_id`),
  KEY `idx_blog_term_is_deleted` (`is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `blog_theme_config` (
  `id` varchar(64) NOT NULL,
  `config` longtext NOT NULL,
  `source` varchar(255) NOT NULL DEFAULT 'local',
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
