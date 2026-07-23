CREATE TABLE IF NOT EXISTS admin_menu (
  id BIGINT NOT NULL PRIMARY KEY,
  pid BIGINT NOT NULL DEFAULT 0,
  name VARCHAR(120) NOT NULL,
  path VARCHAR(255) NULL,
  component VARCHAR(255) NULL,
  redirect VARCHAR(255) NULL,
  auth_code VARCHAR(120) NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'menu',
  meta LONGTEXT NULL,
  status INT NOT NULL DEFAULT 1,
  sort INT NOT NULL DEFAULT 0,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_admin_menu_name (name),
  KEY idx_admin_menu_pid (pid),
  KEY idx_admin_menu_path (path),
  KEY idx_admin_menu_auth_code (auth_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_role (
  id BIGINT NOT NULL PRIMARY KEY,
  role_code VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  status INT NOT NULL DEFAULT 1,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_admin_role_code (role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_user (
  id BIGINT NOT NULL PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  real_name VARCHAR(255) NOT NULL,
  avatar VARCHAR(1024) NOT NULL DEFAULT '',
  dept_id BIGINT NULL,
  home_path VARCHAR(255) NOT NULL DEFAULT '',
  timezone VARCHAR(255) NOT NULL DEFAULT 'Asia/Shanghai',
  status INT NOT NULL DEFAULT 1,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_admin_user_username (username),
  KEY idx_admin_user_dept_id (dept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_dept (
  id BIGINT NOT NULL PRIMARY KEY,
  pid BIGINT NOT NULL DEFAULT 0,
  name VARCHAR(255) NOT NULL,
  status INT NOT NULL DEFAULT 1,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_admin_dept_pid (pid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_dict (
  id BIGINT NOT NULL PRIMARY KEY,
  dict_code VARCHAR(255) NOT NULL,
  label VARCHAR(255) NOT NULL,
  value VARCHAR(255) NOT NULL,
  children_code VARCHAR(255) NULL,
  sort INT NOT NULL DEFAULT 0,
  status INT NOT NULL DEFAULT 1,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_admin_dict_code_value (dict_code, value),
  KEY idx_admin_dict_code (dict_code),
  KEY idx_admin_dict_children_code (children_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_component (
  id BIGINT NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT '',
  type INT NOT NULL,
  component_type INT NOT NULL,
  image MEDIUMTEXT NOT NULL,
  template MEDIUMTEXT NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_admin_component_type (type),
  KEY idx_admin_component_component_type (component_type),
  KEY idx_admin_component_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_notice (
  id BIGINT NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  summary TEXT NULL,
  level INT NOT NULL DEFAULT 1,
  status INT NOT NULL DEFAULT 1,
  severity VARCHAR(16) NOT NULL DEFAULT 'info',
  source VARCHAR(64) NOT NULL DEFAULT 'system',
  event_type VARCHAR(120) NOT NULL DEFAULT 'system.event',
  dedupe_key VARCHAR(255) NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  notify_role_code VARCHAR(64) NOT NULL DEFAULT 'super',
  metadata JSON NULL,
  is_top TINYINT NOT NULL DEFAULT 0,
  notify_users TEXT NULL,
  created_by BIGINT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  active_dedupe_key VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN is_deleted = 0 AND dedupe_key IS NOT NULL THEN dedupe_key ELSE NULL END) VIRTUAL,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  first_seen_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  UNIQUE KEY uk_admin_notice_active_dedupe_key (active_dedupe_key),
  KEY idx_admin_notice_status (status),
  KEY idx_admin_notice_severity (severity),
  KEY idx_admin_notice_source_event (source, event_type),
  KEY idx_admin_notice_dedupe_key (dedupe_key),
  KEY idx_admin_notice_notify_role (notify_role_code),
  KEY idx_admin_notice_is_top (is_top),
  KEY idx_admin_notice_is_deleted (is_deleted),
  KEY idx_admin_notice_create_time (create_time),
  KEY idx_admin_notice_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS network_port_forward (
  id BIGINT NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  remark TEXT NULL,
  protocol VARCHAR(8) NOT NULL,
  external_port INT UNSIGNED NOT NULL,
  internal_port INT UNSIGNED NOT NULL,
  active_key VARCHAR(32) NULL,
  target_ipv4 VARCHAR(15) NOT NULL,
  desired_presence VARCHAR(16) NOT NULL DEFAULT 'present',
  keeper_desired_enabled TINYINT(1) NOT NULL DEFAULT 0,
  probe_request_id VARCHAR(64) NULL,
  desired_revision BIGINT NOT NULL DEFAULT 0,
  desired_issued_at DATETIME(6) NOT NULL,
  reported_revision BIGINT NOT NULL DEFAULT 0,
  sync_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  keeper_status VARCHAR(16) NOT NULL DEFAULT 'disabled',
  current_public_ipv4 VARCHAR(15) NULL,
  current_public_port INT NULL,
  current_observed_at DATETIME(6) NULL,
  current_valid_until DATETIME(6) NULL,
  last_observed_ipv4 VARCHAR(15) NULL,
  last_observed_port INT NULL,
  last_observed_at DATETIME(6) NULL,
  last_error_code VARCHAR(64) NULL,
  last_error_message VARCHAR(512) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_network_port_forward_active_key (active_key),
  KEY idx_network_port_forward_status (is_deleted, sync_status),
  KEY idx_network_port_forward_protocol (protocol, external_port)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS network_ddns_record (
  id BIGINT NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  remark TEXT NULL,
  record_type VARCHAR(8) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  port_forward_id BIGINT NULL,
  domain VARCHAR(253) NOT NULL,
  sub_domain VARCHAR(253) NOT NULL,
  active_key VARCHAR(300) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'disabled',
  provider_record_id VARCHAR(32) NULL,
  source_address VARCHAR(45) NULL,
  applied_address VARCHAR(45) NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at DATETIME(3) NULL,
  last_attempt_at DATETIME(3) NULL,
  last_synced_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) NULL,
  last_error_message VARCHAR(512) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  update_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_network_ddns_record_active_key (active_key),
  KEY idx_network_ddns_record_status (is_deleted, enabled, sync_status, next_retry_at),
  KEY idx_network_ddns_record_port_forward (port_forward_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS network_agent_state (
  agent_id VARCHAR(64) NOT NULL PRIMARY KEY,
  target_ipv4 VARCHAR(15) NOT NULL,
  desired_revision BIGINT NOT NULL DEFAULT 0,
  desired_issued_at DATETIME(6) NOT NULL,
  published_revision BIGINT NOT NULL DEFAULT 0,
  applied_revision BIGINT NOT NULL DEFAULT 0,
  online TINYINT(1) NOT NULL DEFAULT 0,
  version VARCHAR(64) NULL,
  started_at DATETIME(6) NULL,
  last_heartbeat_at DATETIME(6) NULL,
  current_public_ipv6 VARCHAR(45) NULL,
  current_ipv6_observed_at DATETIME(3) NULL,
  last_mqtt_error_code VARCHAR(64) NULL,
  last_mqtt_error_message VARCHAR(500) NULL,
  last_reconcile_error_code VARCHAR(64) NULL,
  last_reconcile_error_message VARCHAR(500) NULL,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS network_endpoint_history (
  id BIGINT NOT NULL PRIMARY KEY,
  event_id VARCHAR(128) NOT NULL,
  mapping_id BIGINT NOT NULL,
  event_type VARCHAR(16) NOT NULL,
  public_ipv4 VARCHAR(15) NULL,
  public_port INT NULL,
  first_observed_at DATETIME(6) NOT NULL,
  last_observed_at DATETIME(6) NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  reason VARCHAR(128) NULL,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_network_endpoint_history_event_id (event_id),
  KEY idx_network_endpoint_history_mapping (mapping_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_user_role (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  KEY idx_admin_user_role_role_id (role_id),
  CONSTRAINT fk_admin_user_role_user FOREIGN KEY (user_id) REFERENCES admin_user (id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_user_role_role FOREIGN KEY (role_id) REFERENCES admin_role (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_role_menu (
  role_id BIGINT NOT NULL,
  menu_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, menu_id),
  KEY idx_admin_role_menu_menu_id (menu_id),
  CONSTRAINT fk_admin_role_menu_role FOREIGN KEY (role_id) REFERENCES admin_role (id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_role_menu_menu FOREIGN KEY (menu_id) REFERENCES admin_menu (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_permission (
  id BIGINT NOT NULL PRIMARY KEY,
  permission_key VARCHAR(128) NOT NULL,
  permission_name VARCHAR(128) NOT NULL,
  module_key VARCHAR(64) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_admin_permission_key (permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_department (
  id BIGINT NOT NULL PRIMARY KEY,
  parent_id BIGINT NULL,
  dept_name VARCHAR(128) NOT NULL,
  sort_no INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_admin_department_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_role_permission (
  id BIGINT NOT NULL PRIMARY KEY,
  role_id BIGINT NOT NULL,
  permission_id BIGINT NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_admin_role_permission (role_id, permission_id),
  KEY idx_admin_role_permission_permission (permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_dict_group (
  id BIGINT NOT NULL PRIMARY KEY,
  group_key VARCHAR(128) NOT NULL,
  group_name VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_platform_dict_group_key (group_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_dict_item (
  id BIGINT NOT NULL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  item_key VARCHAR(128) NOT NULL,
  item_label VARCHAR(128) NOT NULL,
  item_value VARCHAR(255) NOT NULL,
  sort_no INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_platform_dict_item (group_id, item_key),
  KEY idx_platform_dict_item_group (group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_component_template (
  id BIGINT NOT NULL PRIMARY KEY,
  template_key VARCHAR(128) NOT NULL,
  template_name VARCHAR(128) NOT NULL,
  schema_json JSON NULL,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_platform_component_template_key (template_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_setting (
  id BIGINT NOT NULL PRIMARY KEY,
  setting_key VARCHAR(128) NOT NULL,
  setting_value TEXT NULL,
  value_type VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_platform_setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_post (
  id BIGINT NOT NULL PRIMARY KEY,
  slug VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary TEXT NULL,
  content_markdown LONGTEXT NULL,
  content_html LONGTEXT NULL,
  status VARCHAR(32) NOT NULL,
  publish_time DATETIME NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_blog_post_slug (slug),
  KEY idx_blog_post_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_article (
  id BIGINT NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  excerpt TEXT NULL,
  content_markdown MEDIUMTEXT NULL,
  content_html MEDIUMTEXT NULL,
  cover TEXT NULL,
  author_name VARCHAR(255) NOT NULL DEFAULT 'KwiTsukasa',
  category_items TEXT NULL,
  tag_items TEXT NULL,
  views INT NOT NULL DEFAULT 0,
  comments INT NOT NULL DEFAULT 0,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  publish_time DATETIME NULL,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_blog_article_slug (slug),
  KEY idx_blog_article_status (status),
  KEY idx_blog_article_publish_time (publish_time),
  KEY idx_blog_article_is_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_taxonomy (
  id BIGINT NOT NULL PRIMARY KEY,
  taxonomy_key VARCHAR(64) NOT NULL,
  taxonomy_name VARCHAR(128) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_blog_taxonomy_key (taxonomy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_term (
  id BIGINT NOT NULL PRIMARY KEY,
  taxonomy_id BIGINT NULL,
  kind VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  term_name VARCHAR(128) NULL,
  description TEXT NULL,
  parent_id VARCHAR(64) NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_blog_term_taxonomy (taxonomy_id),
  KEY idx_blog_term_kind_slug (kind, slug),
  KEY idx_blog_term_parent_id (parent_id),
  KEY idx_blog_term_is_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_post_term (
  id BIGINT NOT NULL PRIMARY KEY,
  post_id BIGINT NOT NULL,
  term_id BIGINT NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_blog_post_term (post_id, term_id),
  KEY idx_blog_post_term_term (term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_theme_profile (
  id BIGINT NOT NULL PRIMARY KEY,
  profile_key VARCHAR(128) NOT NULL,
  profile_name VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_blog_theme_profile_key (profile_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_theme_config (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  config LONGTEXT NOT NULL,
  source VARCHAR(255) NOT NULL DEFAULT 'local',
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_import_job (
  id BIGINT NOT NULL PRIMARY KEY,
  source_key VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  summary_json JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_blog_import_job_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wordpress_site (
  id BIGINT NOT NULL PRIMARY KEY,
  site_key VARCHAR(128) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wordpress_site_key (site_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wordpress_auth_session (
  id BIGINT NOT NULL PRIMARY KEY,
  site_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  expires_at DATETIME NULL,
  safe_summary JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_wordpress_auth_session_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wordpress_remote_post (
  id BIGINT NOT NULL PRIMARY KEY,
  site_id BIGINT NOT NULL,
  remote_id VARCHAR(64) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  raw_payload JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wordpress_remote_post (site_id, remote_id),
  KEY idx_wordpress_remote_post_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wordpress_remote_term (
  id BIGINT NOT NULL PRIMARY KEY,
  site_id BIGINT NOT NULL,
  remote_id VARCHAR(64) NOT NULL,
  taxonomy_key VARCHAR(64) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  raw_payload JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wordpress_remote_term (site_id, taxonomy_key, remote_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wordpress_sync_job (
  id BIGINT NOT NULL PRIMARY KEY,
  site_id BIGINT NOT NULL,
  job_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  summary_json JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_wordpress_sync_job_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wordpress_sync_mapping (
  id BIGINT NOT NULL PRIMARY KEY,
  site_id BIGINT NOT NULL,
  remote_type VARCHAR(64) NOT NULL,
  remote_id VARCHAR(64) NOT NULL,
  local_type VARCHAR(64) NOT NULL,
  local_id BIGINT NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wordpress_sync_mapping (site_id, remote_type, remote_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_bucket (
  id BIGINT NOT NULL PRIMARY KEY,
  bucket_key VARCHAR(128) NOT NULL,
  bucket_name VARCHAR(128) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_bucket_key (bucket_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_object (
  id BIGINT NOT NULL PRIMARY KEY,
  bucket_id BIGINT NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  source_module VARCHAR(64) NOT NULL,
  mime_type VARCHAR(128) NULL,
  size_bytes BIGINT NULL,
  status VARCHAR(32) NOT NULL,
  metadata_json JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_object_key (bucket_id, object_key),
  KEY idx_asset_object_source (source_module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_reference (
  id BIGINT NOT NULL PRIMARY KEY,
  object_id BIGINT NOT NULL,
  owner_module VARCHAR(64) NOT NULL,
  owner_type VARCHAR(64) NOT NULL,
  owner_id BIGINT NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_reference (object_id, owner_module, owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_access_grant (
  id BIGINT NOT NULL PRIMARY KEY,
  object_id BIGINT NOT NULL,
  grant_token VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_access_grant_token (grant_token),
  KEY idx_asset_access_grant_object (object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_notice (
  id BIGINT NOT NULL PRIMARY KEY,
  notice_key VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  level VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_system_notice_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_event (
  id BIGINT NOT NULL PRIMARY KEY,
  event_key VARCHAR(128) NOT NULL,
  source_module VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_system_event_key (event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_event_dedupe (
  id BIGINT NOT NULL PRIMARY KEY,
  dedupe_key VARCHAR(255) NOT NULL,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  hit_count INT NOT NULL DEFAULT 1,
  UNIQUE KEY uk_system_event_dedupe_key (dedupe_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_event_delivery (
  id BIGINT NOT NULL PRIMARY KEY,
  event_id BIGINT NOT NULL,
  delivery_target VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_system_event_delivery_event (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_evidence_index (
  id BIGINT NOT NULL PRIMARY KEY,
  evidence_key VARCHAR(128) NOT NULL,
  evidence_type VARCHAR(64) NOT NULL,
  artifact_path VARCHAR(512) NOT NULL,
  safe_summary JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_runtime_evidence_key (evidence_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_account (
  id BIGINT NOT NULL PRIMARY KEY,
  self_id VARCHAR(64) NOT NULL,
  connection_mode VARCHAR(32) NOT NULL DEFAULT 'reverse-ws',
  name VARCHAR(120) NOT NULL DEFAULT '',
  display_name VARCHAR(128) NULL,
  access_token VARCHAR(255) NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  connect_status VARCHAR(32) NOT NULL DEFAULT 'offline',
  onebot_status VARCHAR(32) NOT NULL DEFAULT 'offline',
  container_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  webui_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  qq_login_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  client_role VARCHAR(32) NULL,
  last_connected_at DATETIME NULL,
  last_heartbeat_at DATETIME NULL,
  last_error TEXT NULL,
  napcat_login_password_secret VARCHAR(1024) NULL,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_account_self_id (self_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_account_ability (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  self_id VARCHAR(64) NOT NULL,
  ability_type VARCHAR(32) NOT NULL,
  ability_key VARCHAR(128) NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_account_ability (account_id, ability_type, ability_key),
  KEY idx_qqbot_account_ability_self (self_id, ability_type, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_connection_session (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  session_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  connected_at DATETIME NULL,
  disconnected_at DATETIME NULL,
  close_reason TEXT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_connection_session_key (session_key),
  KEY idx_qqbot_connection_session_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_capability_binding (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  capability_key VARCHAR(128) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_capability_binding (account_id, capability_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_permission_policy (
  id BIGINT NOT NULL PRIMARY KEY,
  policy_key VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_value VARCHAR(128) NOT NULL,
  effect VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_permission_policy (policy_key, scope_type, scope_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_allowlist (
  id BIGINT NOT NULL PRIMARY KEY,
  self_id VARCHAR(64) NOT NULL DEFAULT '',
  target_type VARCHAR(32) NOT NULL DEFAULT 'qq',
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  user_id VARCHAR(64) NOT NULL DEFAULT '',
  precise_user TINYINT NOT NULL DEFAULT 0,
  enabled TINYINT NOT NULL DEFAULT 1,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_blocklist (
  id BIGINT NOT NULL PRIMARY KEY,
  self_id VARCHAR(64) NOT NULL DEFAULT '',
  target_type VARCHAR(32) NOT NULL DEFAULT 'qq',
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  user_id VARCHAR(64) NOT NULL DEFAULT '',
  precise_user TINYINT NOT NULL DEFAULT 0,
  enabled TINYINT NOT NULL DEFAULT 1,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_command (
  id BIGINT NOT NULL PRIMARY KEY,
  operation_key VARCHAR(128) NOT NULL,
  command_key VARCHAR(128) NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL DEFAULT '',
  aliases TEXT NOT NULL,
  prefixes VARCHAR(120) NOT NULL DEFAULT '/,!,！',
  plugin_key VARCHAR(128) NULL,
  parser_key VARCHAR(40) NOT NULL DEFAULT 'plain',
  target_type VARCHAR(32) NOT NULL DEFAULT 'all',
  default_params TEXT NULL,
  reply_template TEXT NULL,
  error_template TEXT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 0,
  cooldown_ms INT NOT NULL DEFAULT 1500,
  cooldown_seconds INT NOT NULL DEFAULT 0,
  last_hit_at DATETIME NULL,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_command_key (command_key),
  KEY idx_qqbot_command_operation (operation_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_command_alias (
  id BIGINT NOT NULL PRIMARY KEY,
  command_id BIGINT NOT NULL,
  alias_text VARCHAR(128) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_command_alias (command_id, alias_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_command_log (
  id BIGINT NOT NULL PRIMARY KEY,
  command_id VARCHAR(64) NOT NULL,
  command_code VARCHAR(80) NOT NULL DEFAULT '',
  plugin_key VARCHAR(80) NOT NULL,
  operation_key VARCHAR(120) NOT NULL,
  self_id VARCHAR(64) NOT NULL DEFAULT '',
  target_type VARCHAR(32) NOT NULL DEFAULT 'private',
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  user_id VARCHAR(64) NOT NULL DEFAULT '',
  raw_message TEXT NOT NULL,
  input TEXT NULL,
  output TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  error_message TEXT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_config (
  id BIGINT NOT NULL PRIMARY KEY,
  config_key VARCHAR(120) NOT NULL,
  config_value TEXT NOT NULL,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_rule (
  id BIGINT NOT NULL PRIMARY KEY,
  rule_key VARCHAR(128) NULL,
  name VARCHAR(120) NOT NULL DEFAULT '',
  match_type VARCHAR(32) NOT NULL DEFAULT 'keyword',
  keyword VARCHAR(500) NOT NULL,
  target_type VARCHAR(32) NOT NULL DEFAULT 'all',
  reply_content TEXT NOT NULL,
  account_id BIGINT NULL,
  command_id BIGINT NULL,
  matcher_json JSON NULL,
  action_json JSON NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 0,
  cooldown_ms INT NOT NULL DEFAULT 1500,
  last_hit_at DATETIME NULL,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_rule_key (rule_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_conversation (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NULL,
  self_id VARCHAR(64) NOT NULL,
  conversation_type VARCHAR(64) NULL,
  conversation_key VARCHAR(128) NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NULL,
  target_name VARCHAR(120) NOT NULL DEFAULT '',
  last_message_id VARCHAR(64) NULL,
  last_message_text TEXT NOT NULL,
  last_message_time DATETIME NULL,
  message_count INT NOT NULL DEFAULT 0,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_conversation (account_id, conversation_type, conversation_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_message (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NULL,
  self_id VARCHAR(64) NOT NULL,
  conversation_id BIGINT NULL,
  message_id VARCHAR(128) NULL,
  direction VARCHAR(32) NOT NULL,
  message_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  group_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NOT NULL,
  sender_nickname VARCHAR(120) NOT NULL DEFAULT '',
  raw_message TEXT NOT NULL,
  message_text TEXT NOT NULL,
  summary TEXT NULL,
  raw_payload JSON NULL,
  raw_event JSON NULL,
  event_time DATETIME NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_message (account_id, message_id),
  KEY idx_qqbot_message_conversation (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_send_task (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NULL,
  conversation_id BIGINT NULL,
  task_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  reserved_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error TEXT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_send_task_key (task_key),
  KEY idx_qqbot_send_task_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_send_log (
  id BIGINT NOT NULL PRIMARY KEY,
  task_id BIGINT NULL,
  account_id BIGINT NULL,
  self_id VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  message_text TEXT NOT NULL,
  params JSON NULL,
  status VARCHAR(32) NOT NULL,
  echo VARCHAR(80) NULL,
  message_id VARCHAR(64) NULL,
  safe_summary JSON NULL,
  error_message TEXT NULL,
  response JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_qqbot_send_log_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_dedupe_event (
  id BIGINT NOT NULL PRIMARY KEY,
  dedupe_key VARCHAR(255) NOT NULL,
  account_id BIGINT NULL,
  expires_at DATETIME NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_dedupe_event_key (dedupe_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_dedupe (
  id BIGINT NOT NULL PRIMARY KEY,
  event_key VARCHAR(255) NOT NULL,
  expire_at DATETIME NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_dedupe_event_key (event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_key VARCHAR(128) NOT NULL,
  plugin_name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_plugin_key (plugin_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_version (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  version VARCHAR(64) NOT NULL,
  package_hash VARCHAR(128) NOT NULL,
  manifest_json JSON NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_plugin_version (plugin_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_installation (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  version_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  runtime_status VARCHAR(32) NOT NULL,
  installed_path VARCHAR(512) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_qqbot_plugin_installation_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_operation (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  operation_name VARCHAR(128) NOT NULL,
  handler_name VARCHAR(128) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_plugin_operation (plugin_id, operation_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_event_handler (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  event_key VARCHAR(128) NOT NULL,
  handler_name VARCHAR(128) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_plugin_event_handler (plugin_id, event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_account_binding (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_plugin_account_binding (plugin_id, account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_config (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  config_key VARCHAR(128) NOT NULL,
  config_value JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_plugin_config (plugin_id, config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_asset (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  asset_key VARCHAR(255) NOT NULL,
  asset_path VARCHAR(512) NOT NULL,
  content_hash VARCHAR(128) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_plugin_asset (plugin_id, asset_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_runtime_event (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  installation_id BIGINT NULL,
  event_type VARCHAR(64) NOT NULL,
  level VARCHAR(32) NOT NULL,
  safe_summary JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_qqbot_plugin_runtime_event_plugin (plugin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_task (
  id BIGINT NOT NULL PRIMARY KEY,
  plugin_id BIGINT NOT NULL,
  installation_id BIGINT NOT NULL,
  task_key VARCHAR(128) NOT NULL,
  task_name VARCHAR(128) NOT NULL,
  handler_name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  default_cron VARCHAR(64) NOT NULL,
  cron_expression VARCHAR(64) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  timeout_ms INT NOT NULL,
  runtime_status VARCHAR(32) NOT NULL DEFAULT 'idle',
  last_run_id BIGINT NULL,
  last_run_at DATETIME NULL,
  last_status VARCHAR(32) NULL,
  last_error TEXT NULL,
  last_duration_ms INT NULL,
  next_run_at DATETIME NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qqbot_plugin_task (installation_id, task_key),
  KEY idx_qqbot_plugin_task_plugin (plugin_id),
  KEY idx_qqbot_plugin_task_enabled (enabled),
  KEY idx_qqbot_plugin_task_status (runtime_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_plugin_task_run (
  id BIGINT NOT NULL PRIMARY KEY,
  task_id BIGINT NOT NULL,
  plugin_id BIGINT NOT NULL,
  installation_id BIGINT NOT NULL,
  task_key VARCHAR(128) NOT NULL,
  trigger_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  job_id VARCHAR(191) NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  duration_ms INT NULL,
  safe_summary JSON NULL,
  error_message TEXT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_qqbot_plugin_task_run_task_time (task_id, create_time),
  KEY idx_qqbot_plugin_task_run_plugin_time (plugin_id, create_time),
  KEY idx_qqbot_plugin_task_run_status_time (status, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_container (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NULL,
  container_name VARCHAR(120) NOT NULL,
  base_url VARCHAR(255) NOT NULL,
  webui_port INT NULL,
  webui_token VARCHAR(255) NULL,
  image VARCHAR(255) NOT NULL DEFAULT '',
  data_dir VARCHAR(500) NOT NULL DEFAULT '',
  reverse_ws_url VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'creating',
  last_started_at DATETIME NULL,
  last_checked_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_napcat_container_name (container_name),
  KEY idx_napcat_container_status (status, is_deleted),
  KEY idx_napcat_container_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_device_identity (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  container_id BIGINT NULL,
  data_dir VARCHAR(512) NOT NULL,
  hostname VARCHAR(128) NOT NULL,
  hostname_strategy VARCHAR(64) NOT NULL DEFAULT 'legacy',
  machine_id_path VARCHAR(512) NOT NULL,
  mac_address VARCHAR(64) NOT NULL,
  mac_strategy VARCHAR(64) NOT NULL DEFAULT 'legacy',
  verification_status VARCHAR(32) NOT NULL,
  last_login_evidence JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_napcat_device_identity_account (account_id),
  KEY idx_napcat_device_identity_container (container_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_account_binding (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  container_id BIGINT NOT NULL,
  device_identity_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  is_primary TINYINT NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT NOT NULL DEFAULT 0,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_napcat_account_binding_account (account_id),
  KEY idx_napcat_account_binding_container (container_id, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_login_session (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NULL,
  session_key VARCHAR(128) NOT NULL,
  login_stage VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  progress_message VARCHAR(255) NOT NULL,
  session_payload JSON NULL,
  expires_at DATETIME NULL,
  completed_at DATETIME NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_napcat_login_session_key (session_key),
  KEY idx_napcat_login_session_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_login_challenge (
  id BIGINT NOT NULL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  challenge_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  challenge_url TEXT NULL,
  challenge_payload JSON NULL,
  resolved_at DATETIME NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_napcat_login_challenge_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_runtime_cleanup (
  id BIGINT NOT NULL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  cleanup_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  error_message TEXT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_napcat_runtime_cleanup_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_runtime_profile (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  container_id BIGINT NULL,
  device_identity_id BIGINT NULL,
  profile_version VARCHAR(64) NOT NULL,
  image_ref VARCHAR(255) NOT NULL,
  image_digest VARCHAR(255) NULL,
  base_image_digest VARCHAR(255) NULL,
  desktop_profile_version VARCHAR(64) NULL,
  locale_available TINYINT NOT NULL DEFAULT 0,
  fontconfig_evidence JSON NULL,
  timezone_evidence JSON NULL,
  runtime_uid INT NULL,
  runtime_gid INT NULL,
  shm_size VARCHAR(32) NULL,
  locale VARCHAR(64) NULL,
  xdg_config_home VARCHAR(255) NULL,
  xdg_cache_home VARCHAR(255) NULL,
  xdg_data_home VARCHAR(255) NULL,
  persist_cache TINYINT NOT NULL DEFAULT 1,
  persist_local_share TINYINT NOT NULL DEFAULT 1,
  persist_logs TINYINT NOT NULL DEFAULT 1,
  hostname_strategy VARCHAR(64) NOT NULL,
  mac_strategy VARCHAR(64) NOT NULL,
  migrate_device_identity TINYINT NOT NULL DEFAULT 0,
  profile_status VARCHAR(32) NOT NULL,
  last_check_evidence JSON NULL,
  last_checked_at DATETIME NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_napcat_runtime_profile_account (account_id),
  KEY idx_napcat_runtime_profile_container (container_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_protocol_profile (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  container_id BIGINT NULL,
  profile_version VARCHAR(64) NOT NULL,
  packet_backend VARCHAR(64) NOT NULL,
  packet_server VARCHAR(255) NOT NULL DEFAULT '',
  o3_hook_mode INT NOT NULL DEFAULT 1,
  o3_hook_gray_enabled TINYINT NOT NULL DEFAULT 0,
  onebot_config_hash VARCHAR(128) NULL,
  onebot_config_json JSON NULL,
  napcat_config_hash VARCHAR(128) NULL,
  napcat_config_json JSON NULL,
  profile_status VARCHAR(32) NOT NULL,
  last_check_evidence JSON NULL,
  last_checked_at DATETIME NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_napcat_protocol_profile_account (account_id),
  KEY idx_napcat_protocol_profile_container (container_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_session_behavior_profile (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  profile_version VARCHAR(64) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  cold_start_until DATETIME NULL,
  housekeeping_enabled TINYINT NOT NULL DEFAULT 0,
  housekeeping_interval_ms INT NULL,
  next_housekeeping_at DATETIME NULL,
  last_housekeeping_at DATETIME NULL,
  last_housekeeping_result JSON NULL,
  presence_enabled TINYINT NOT NULL DEFAULT 0,
  presence_strategy VARCHAR(64) NULL,
  last_presence_event_at DATETIME NULL,
  next_presence_event_at DATETIME NULL,
  auto_capability_stage VARCHAR(32) NOT NULL,
  last_behavior_evidence JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_napcat_session_behavior_profile_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_login_event (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  container_id BIGINT NULL,
  event_kind VARCHAR(64) NOT NULL,
  event_source VARCHAR(32) NOT NULL,
  event_status VARCHAR(32) NOT NULL,
  evidence JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_napcat_login_event_account (account_id, create_time),
  KEY idx_napcat_login_event_container (container_id, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS napcat_risk_mode (
  id BIGINT NOT NULL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  risk_mode VARCHAR(32) NOT NULL,
  reason VARCHAR(255) NULL,
  source_event VARCHAR(64) NULL,
  expires_at DATETIME NULL,
  last_evidence JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_napcat_risk_mode_account (account_id),
  KEY idx_napcat_risk_mode_mode (risk_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_napcat_webui_gateway_audit (
  id BIGINT NOT NULL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  admin_user_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  self_id VARCHAR(32) NOT NULL,
  container_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  client_ip VARCHAR(128) NULL,
  user_agent VARCHAR(512) NULL,
  detail_json JSON NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_napcat_webui_gateway_audit_session (session_id),
  KEY idx_napcat_webui_gateway_audit_account_event (account_id, event_type),
  KEY idx_napcat_webui_gateway_audit_admin_time (admin_user_id, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
