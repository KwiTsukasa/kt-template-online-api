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
 * 从`plugins`、`installations`解析Inactive插件Keys；从 `pluginKeysById.get` 读取Inactive插件Keys。
 * @param plugins - 决定Inactive插件Keys内容、边界或目标的 `plugins` 值。
 * @param installations - 决定Inactive插件Keys内容、边界或目标的 `installations` 值。
 * @returns Inactive插件Keys。
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
