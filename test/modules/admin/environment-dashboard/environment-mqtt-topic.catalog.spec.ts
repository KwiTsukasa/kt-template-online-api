import {
  buildEnvironmentMqttTopics,
  normalizeEnvironmentTopicSegment,
} from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/event/environment-mqtt-topic.catalog';

describe('environment mqtt topic catalog', () => {
  it('builds deterministic environment dashboard topics under the configured prefix', () => {
    const topics = buildEnvironmentMqttTopics('kt/env');

    expect(topics.signal('nas-prod', 'k8s', 'api')).toBe(
      'kt/env/signal/nas-prod/k8s/api',
    );
    expect(topics.event('nas-prod', 'k8s', 'api')).toBe(
      'kt/env/event/nas-prod/k8s/api',
    );
    expect(topics.selfCheckResult('nas-prod')).toBe(
      'kt/env/self-check/nas-prod',
    );
  });

  it('normalizes dynamic segments so topic builders never escape the prefix', () => {
    expect(normalizeEnvironmentTopicSegment('/plugin task/#1')).toBe(
      'plugin-task--1',
    );
    expect(
      buildEnvironmentMqttTopics('kt/env').pluginTaskRun(
        'bangdream',
        '/bestdori sync',
      ),
    ).toBe('kt/env/qqbot/plugin-task/bangdream/bestdori-sync/run');
  });
});
