import type {
  EnvironmentEventEnvelope,
  EnvironmentHealthStatus,
} from '../../domain/environment-dashboard.types';
import { buildEnvironmentMqttTopics } from './environment-mqtt-topic.catalog';

export interface EnvironmentEventPublisher {
  publish(event: EnvironmentEventEnvelope): Promise<void> | void;
}

export interface QqbotNapcatRuntimeEventInput {
  accountId?: string;
  message: string;
  observedAt?: string;
  selfId: string;
  severity: EnvironmentHealthStatus;
}

export interface QqbotPluginTaskRunEventInput {
  message: string;
  observedAt?: string;
  pluginKey: string;
  severity: EnvironmentHealthStatus;
  taskKey: string;
}

export class QqbotEnvironmentEventBridge {
  private readonly topics = buildEnvironmentMqttTopics();

  constructor(private readonly publisher: EnvironmentEventPublisher) {}

  /** 发布NapCat运行态事件。 */
  async publishNapcatRuntimeEvent(input: QqbotNapcatRuntimeEventInput) {
    await this.publisher.publish({
      eventId: this.createEventId(
        'qqbot-napcat',
        input.selfId,
        input.observedAt,
      ),
      nodeId: 'nas-prod-qqbot',
      observedAt: input.observedAt || new Date().toISOString(),
      serviceId: 'napcat',
      severity: input.severity,
      signalId: `napcat-${input.selfId}`,
      siteId: 'nas-prod',
      sourceKind: 'local',
      summary: input.message,
      topic: this.topics.qqbotRuntime(input.selfId),
    });
  }

  /** 发布插件任务运行。 */
  async publishPluginTaskRun(input: QqbotPluginTaskRunEventInput) {
    await this.publisher.publish({
      eventId: this.createEventId(
        'qqbot-plugin-task',
        `${input.pluginKey}-${input.taskKey}`,
        input.observedAt,
      ),
      nodeId: 'nas-prod-qqbot',
      observedAt: input.observedAt || new Date().toISOString(),
      serviceId: 'plugin-tasks',
      severity: input.severity,
      signalId: `plugin-task-${input.pluginKey}-${input.taskKey}`,
      siteId: 'nas-prod',
      sourceKind: 'local',
      summary: input.message,
      topic: this.topics.pluginTaskRun(input.pluginKey, input.taskKey),
    });
  }

  /** 创建事件标识。 */
  private createEventId(kind: string, sourceId: string, observedAt?: string) {
    const time = observedAt ? new Date(observedAt).getTime() : Date.now();
    return `${kind}-${sourceId}-${time}`;
  }
}
