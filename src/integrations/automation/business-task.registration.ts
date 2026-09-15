import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TASK_HANDLERS,
  type TaskHandler,
  type TaskHandlerRegistryPort,
} from '@/modules/task-execution/contract/task-handler.port';
import {
  MESSAGE_DELIVERY,
  type MessageDeliveryPort,
} from '@/modules/message-management/contract/message-delivery.port';
import {
  MEDIA_RSS_OPERATIONS,
  MEDIA_EXECUTION_OPERATIONS,
  type MediaRssOperationsPort,
  type MediaExecutionOperationsPort,
} from '@/modules/admin/media-governance/contract/media-automation.port';
import {
  NETWORK_DDNS_OPERATIONS,
  type NetworkDdnsOperationsPort,
} from '@/modules/admin/platform-config/network-management/contract/network-ddns-automation.port';
import {
  NAPCAT_INSPECTION,
  type NapcatInspectionPort,
} from '@/modules/bot-adapter/napcat/contract/napcat-inspection.port';
import { businessTaskDefaults } from './business-task.defaults';

@Injectable()
export class BusinessTaskRegistration implements OnModuleInit, OnModuleDestroy {
  private readonly unregister: Array<() => void> = [];
  constructor(
    private readonly config: ConfigService,
    @Inject(TASK_HANDLERS) private readonly handlers: TaskHandlerRegistryPort,
    @Inject(MESSAGE_DELIVERY) private readonly messages: MessageDeliveryPort,
    @Inject(MEDIA_RSS_OPERATIONS) private readonly rss: MediaRssOperationsPort,
    @Inject(MEDIA_EXECUTION_OPERATIONS)
    private readonly media: MediaExecutionOperationsPort,
    @Inject(NETWORK_DDNS_OPERATIONS)
    private readonly ddns: NetworkDdnsOperationsPort,
    @Inject(NAPCAT_INSPECTION) private readonly napcat: NapcatInspectionPort,
  ) {}

  onModuleInit() {
    for (const handler of this.declarations())
      this.unregister.push(this.handlers.register(handler));
  }

  onModuleDestroy() {
    for (const release of this.unregister.splice(0)) release();
  }

  /**
   * 将业务公开操作翻译为固定数据契约，周期和启停状态不进入执行处理器。
   * @returns 保持各业务可用性与失败语义的原子执行能力。
   */
  declarations(): TaskHandler[] {
    const operations: Record<string, () => Promise<void>> = {
      'message.delivery.scan': () => this.messages.drain(),
      'media.rss.poll': () => this.rss.pollDueSubscriptions(),
      'media.execution.reconcile': () => this.media.reconcileExecutions(),
      'network.ddns.reconcile': () => this.ddns.reconcileNow(),
      'napcat.offline.inspect': () => this.napcat.inspectOffline(),
    };
    return businessTaskDefaults(this.config).map((item) => ({
      key: item.key,
      version: 1,
      name: item.name,
      ownerKind: 'system',
      idempotent: item.idempotent,
      timeoutMs: item.timeoutMs,
      inputSchema: { fields: [] },
      outputSchema: { fields: [] },
      isAvailable: async () => {
        if (item.key === 'media.execution.reconcile')
          return this.media.executionAvailable();
        return true;
      },
      execute: async ({ signal }) => {
        if (signal.aborted) throw new Error('业务任务已经取消');
        await operations[item.key]();
        return {};
      },
    }));
  }
}
