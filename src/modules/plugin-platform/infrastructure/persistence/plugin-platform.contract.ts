export const PLUGIN_PLATFORM_DOMAIN_CONTRACT = {
  routes: {
    installLocal: '/plugin-platform/install-local',
    installations: '/plugin-platform/installations',
    runtimeEvents: '/plugin-platform/runtime-events',
    validate: '/plugin-platform/validate',
  },
  tables: [
    'plugin',
    'plugin_version',
    'plugin_installation',
    'plugin_operation',
    'plugin_event_handler',
    'plugin_config',
    'plugin_asset',
    'plugin_runtime_event',
  ],
} as const;
