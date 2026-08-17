export interface EnvironmentMqttTopics {
  signal(siteId: string, nodeId: string, serviceId: string): string;
  event(siteId: string, nodeId: string, serviceId: string): string;
  selfCheckResult(siteId: string): string;
  qqbotRuntime(selfId: string): string;
  qqbotNapcatLogin(selfId: string): string;
  pluginTaskRun(pluginKey: string, taskKey: string): string;
}

/**
 * 将`value`规范为环境主题分段，使等价输入得到一致表示。
 * @param value - 待转换为环境主题分段的原始值。
 * @returns 规范化后的环境主题分段；主值为空时采用 `'unknown'` 兜底。
 */
export function normalizeEnvironmentTopicSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[#+]/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

/**
 * 根据`topicPrefix`构造环境MQTT主题。
 * @param topicPrefix - 决定环境MQTT主题内容、边界或目标的 `topicPrefix` 值；省略时默认采用 `process.env.ENV_DASHBOARD_MQTT_TOPIC_PREFIX || 'k…`。
 * @returns 包含 `event`、`pluginTaskRun`、`qqbotNapcatLogin`、`qqbotRuntime`、`selfCheckResult` 字段的环境MQTT主题。
 */
export function buildEnvironmentMqttTopics(
  topicPrefix = process.env.ENV_DASHBOARD_MQTT_TOPIC_PREFIX || 'kt/env',
): EnvironmentMqttTopics {
  const prefix = topicPrefix.replace(/[\\/]+/g, '/').replace(/\/+$/g, '');

  return {
    event: (siteId: string, nodeId: string, serviceId: string) =>
      [
        prefix,
        'event',
        normalizeEnvironmentTopicSegment(siteId),
        normalizeEnvironmentTopicSegment(nodeId),
        normalizeEnvironmentTopicSegment(serviceId),
      ].join('/'),
    pluginTaskRun: (pluginKey: string, taskKey: string) =>
      [
        prefix,
        'qqbot',
        'plugin-task',
        normalizeEnvironmentTopicSegment(pluginKey),
        normalizeEnvironmentTopicSegment(taskKey),
        'run',
      ].join('/'),
    qqbotNapcatLogin: (selfId: string) =>
      [
        prefix,
        'qqbot',
        'napcat',
        normalizeEnvironmentTopicSegment(selfId),
        'login',
      ].join('/'),
    qqbotRuntime: (selfId: string) =>
      [
        prefix,
        'qqbot',
        'runtime',
        normalizeEnvironmentTopicSegment(selfId),
      ].join('/'),
    selfCheckResult: (siteId: string) =>
      [prefix, 'self-check', normalizeEnvironmentTopicSegment(siteId)].join(
        '/',
      ),
    signal: (siteId: string, nodeId: string, serviceId: string) =>
      [
        prefix,
        'signal',
        normalizeEnvironmentTopicSegment(siteId),
        normalizeEnvironmentTopicSegment(nodeId),
        normalizeEnvironmentTopicSegment(serviceId),
      ].join('/'),
  };
}
