export interface EnvironmentMqttTopics {
  signal(siteId: string, nodeId: string, serviceId: string): string;
  event(siteId: string, nodeId: string, serviceId: string): string;
  selfCheckResult(siteId: string): string;
  qqbotRuntime(selfId: string): string;
  qqbotNapcatLogin(selfId: string): string;
  pluginTaskRun(pluginKey: string, taskKey: string): string;
}

/**
 * Normalizes a dynamic MQTT topic segment without allowing wildcard escapes.
 * @param value - Site, node, service, account, plugin, or task identifier from runtime data.
 * @returns Safe single topic segment with MQTT wildcards and slashes removed.
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
 * Creates the environment dashboard topic catalog for a configured prefix.
 * @param topicPrefix - Non-secret MQTT topic prefix; defaults to `ENV_DASHBOARD_MQTT_TOPIC_PREFIX`.
 * @returns Topic builders used by dashboard adapters and QQBot bridge code.
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
