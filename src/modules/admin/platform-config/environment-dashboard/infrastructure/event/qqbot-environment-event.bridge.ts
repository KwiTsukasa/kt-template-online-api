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

  /**
   * Initializes the bridge with the narrow dashboard event publisher contract.
   * @param publisher - Environment event bus-like publisher; no QQBot bus internals are required.
   */
  constructor(private readonly publisher: EnvironmentEventPublisher) {}

  /**
   * Publishes a NapCat runtime state transition into the environment dashboard bus.
   * @param input - QQBot/NapCat runtime event data from core or NapCat services.
   */
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

  /**
   * Publishes a plugin task run event into the environment dashboard bus.
   * @param input - Plugin task run metadata from plugin-platform task services.
   */
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

  /**
   * Creates deterministic-ish event IDs from event kind and source ID.
   * @param kind - Bridge event category used to avoid ID collisions.
   * @param sourceId - QQBot account or plugin task identifier.
   * @param observedAt - Optional source timestamp that keeps tests deterministic.
   * @returns Event ID safe for SSE replay cursors.
   */
  private createEventId(kind: string, sourceId: string, observedAt?: string) {
    const time = observedAt ? new Date(observedAt).getTime() : Date.now();
    return `${kind}-${sourceId}-${time}`;
  }
}
