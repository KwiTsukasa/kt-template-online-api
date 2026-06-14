# Refactor V3 Schema Map

## Global Rules

- Primary keys are Snowflake `BIGINT`; API/Admin boundary treats IDs as strings.
- Table names use lower snake case.
- Queryable values are structured columns, not JSON-only fields.
- Event/log tables are append-only and have retention strategy.
- New schema is full initialization SQL, not historical `ALTER TABLE` patches.

## Domains

| Domain | Tables | Owner Batch | Notes |
| --- | --- | --- | --- |
| Admin Identity | `admin_user`, `admin_role`, `admin_permission`, `admin_menu`, `admin_department`, `admin_user_role`, `admin_role_permission`, `admin_role_menu` | Batch 2 | Login, menu, role, permission, department. |
| Platform Config | `platform_dict_group`, `platform_dict_item`, `platform_component_template`, `platform_setting` | Batch 2 | Dict and component template split from legacy Admin misc. |
| Blog Content | `blog_post`, `blog_taxonomy`, `blog_term`, `blog_post_term`, `blog_theme_profile`, `blog_import_job` | Batch 3 | Categories and tags use relation table. |
| WordPress Mirror | `wordpress_site`, `wordpress_auth_session`, `wordpress_remote_post`, `wordpress_remote_term`, `wordpress_sync_job`, `wordpress_sync_mapping` | Batch 3 | Remote state separate from local Blog content. |
| Asset | `asset_bucket`, `asset_object`, `asset_reference`, `asset_access_grant` | Batch 3 | MinIO object ownership and access grant. |
| System Event | `system_notice`, `system_event`, `system_event_dedupe`, `system_event_delivery` | Batch 2 | MySQL stores actionable events; Loki remains log query source. |
| Runtime Evidence | `runtime_evidence_index` | Batch 1 | Safe index only, no large logs or secrets. |
| QQBot Core | `qqbot_account`, `qqbot_connection_session`, `qqbot_capability_binding`, `qqbot_permission_policy`, `qqbot_command`, `qqbot_command_alias`, `qqbot_rule`, `qqbot_conversation`, `qqbot_message`, `qqbot_send_task`, `qqbot_send_log`, `qqbot_dedupe_event` | Batch 4 | Account, connection, permission, command, message, send queue. |
| NapCat Runtime | `napcat_container`, `napcat_device_identity`, `napcat_account_binding`, `napcat_login_session`, `napcat_login_challenge`, `napcat_runtime_cleanup` | Batch 7 | Device identity and login challenge state. |
| QQBot Plugin Platform | `qqbot_plugin`, `qqbot_plugin_version`, `qqbot_plugin_installation`, `qqbot_plugin_operation`, `qqbot_plugin_event_handler`, `qqbot_plugin_account_binding`, `qqbot_plugin_config`, `qqbot_plugin_asset`, `qqbot_plugin_runtime_event` | Batch 5 | Manifest, install lifecycle, runtime health, bindings. |
| Plugin-Owned Data | plugin namespace tables | Batch 6 | Table names start with registered plugin namespace. |
