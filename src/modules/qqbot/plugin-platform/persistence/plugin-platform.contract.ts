export const QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT = {
  routes: {
    accountBindings: '/qqbot/plugin-platform/account-bindings',
    installLocal: '/qqbot/plugin-platform/install-local',
    installations: '/qqbot/plugin-platform/installations',
    runtimeEvents: '/qqbot/plugin-platform/runtime-events',
    validate: '/qqbot/plugin-platform/validate',
  },
  tables: [
    'qqbot_plugin',
    'qqbot_plugin_version',
    'qqbot_plugin_installation',
    'qqbot_plugin_operation',
    'qqbot_plugin_event_handler',
    'qqbot_plugin_account_binding',
    'qqbot_plugin_config',
    'qqbot_plugin_asset',
    'qqbot_plugin_runtime_event',
  ],
} as const;
