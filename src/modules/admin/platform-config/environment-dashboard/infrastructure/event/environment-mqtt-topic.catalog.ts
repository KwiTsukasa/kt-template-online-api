export interface EnvironmentMqttTopics {
  signal(siteId: string, nodeId: string, serviceId: string): string;
  event(siteId: string, nodeId: string, serviceId: string): string;
  selfCheckResult(siteId: string): string;
  qqbotRuntime(selfId: string): string;
  qqbotNapcatLogin(selfId: string): string;
  pluginTaskRun(pluginKey: string, taskKey: string): string;
}

export function normalizeEnvironmentTopicSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[#+]/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

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
