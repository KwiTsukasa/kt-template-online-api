import type {
  QqbotPlugin,
  QqbotPluginInstallation,
} from '@/modules/qqbot/plugin-platform/infrastructure/persistence';

type PluginStateRow = Pick<QqbotPlugin, 'id' | 'pluginKey'>;
type InstallationStateRow = Pick<
  QqbotPluginInstallation,
  'pluginId' | 'status'
>;

/**
 * 解析Inactive Plugin Keys。
 * @param plugins - 插件列表；转换 插件平台列表项。
 * @param installations - 插件平台列表；驱动 `for()` 的 插件平台步骤。
 */
export function resolveInactivePluginKeys(
  plugins: PluginStateRow[],
  installations: InstallationStateRow[],
) {
  const pluginKeysById = new Map(
    plugins.map((plugin) => [plugin.id, plugin.pluginKey] as const),
  );
  const statesByPluginKey = new Map<
    string,
    { hasEnabled: boolean; hasInactive: boolean }
  >();

  for (const installation of installations) {
    const pluginKey = pluginKeysById.get(installation.pluginId);
    if (!pluginKey) continue;
    const state = statesByPluginKey.get(pluginKey) || {
      hasEnabled: false,
      hasInactive: false,
    };
    if (installation.status === 'enabled') {
      state.hasEnabled = true;
    } else {
      state.hasInactive = true;
    }
    statesByPluginKey.set(pluginKey, state);
  }

  return [...statesByPluginKey.entries()]
    .filter(([, state]) => !state.hasEnabled && state.hasInactive)
    .map(([pluginKey]) => pluginKey);
}
