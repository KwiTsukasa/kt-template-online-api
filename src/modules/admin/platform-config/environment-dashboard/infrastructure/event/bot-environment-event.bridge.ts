import type {
  EnvironmentEventEnvelope,
  EnvironmentHealthStatus,
} from '../../domain/environment-dashboard.types';
import { buildEnvironmentMqttTopics } from './environment-mqtt-topic.catalog';

export interface EnvironmentEventPublisher {
  publish(event: EnvironmentEventEnvelope): Promise<void> | void;
}

export interface NapcatRuntimeEventInput {
  accountId?: string;
  message: string;
  observedAt?: string;
  selfId: string;
  severity: EnvironmentHealthStatus;
}

export interface PluginTaskRunEventInput {
  message: string;
  observedAt?: string;
  pluginKey: string;
  severity: EnvironmentHealthStatus;
  taskKey: string;
}

export class BotEnvironmentEventBridge {
  private readonly topics = buildEnvironmentMqttTopics();

  constructor(private readonly publisher: EnvironmentEventPublisher) {}

  /**
   * 发布NapCat运行态事件；通过 `publisher.publish` 发布领域状态，通过 `createEventId` 生成稳定标识，通过 `toISOString` 统一时间表示。
   * @param input - 包含 `selfId`、`observedAt`、`severity`、`message` 字段的结构化领域输入。
   */
  async publishNapcatRuntimeEvent(input: NapcatRuntimeEventInput) {
    await this.publisher.publish({
      eventId: this.createEventId('napcat', input.selfId, input.observedAt),
      nodeId: 'nas-prod-bot-adapter',
      observedAt: input.observedAt || new Date().toISOString(),
      serviceId: 'napcat',
      severity: input.severity,
      signalId: `napcat-${input.selfId}`,
      siteId: 'nas-prod',
      sourceKind: 'local',
      summary: input.message,
      topic: this.topics.botRuntime(input.selfId),
    });
  }

  /**
   * 发布插件任务运行；通过 `publisher.publish` 发布领域状态，通过 `createEventId` 生成稳定标识，通过 `toISOString` 统一时间表示。
   * @param input - 包含 `pluginKey`、`taskKey`、`observedAt`、`severity` 字段的结构化领域输入。
   */
  async publishPluginTaskRun(input: PluginTaskRunEventInput) {
    await this.publisher.publish({
      eventId: this.createEventId(
        'plugin-task',
        `${input.pluginKey}-${input.taskKey}`,
        input.observedAt,
      ),
      nodeId: 'nas-prod-plugin-platform',
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
   * 根据`kind`、`sourceId`、`observedAt`构造事件标识。
   * @param kind - 决定事件标识内容、边界或目标的 `kind` 值。
   * @param sourceId - 用于精确定位来源的标识。
   * @param observedAt - 用于过期、排序或租约判定的时间基准；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按参数编码并拼接完成的事件标识。
   */
  private createEventId(kind: string, sourceId: string, observedAt?: string) {
    const time = (() => {
      if (observedAt) {
        return new Date(observedAt).getTime();
      }
      return Date.now();
    })();
    return `${kind}-${sourceId}-${time}`;
  }
}
