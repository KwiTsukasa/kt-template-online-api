import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { isIP } from 'node:net';
import { KtDateTime } from '@/common';
import { QqbotMessageDelivery } from '../../infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '../../infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessageSubscription } from '../../infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_SCAN_INTERVAL_MS,
} from './system-message-runner.constants';
import { SystemMessageDeliveryRunnerService } from './system-message-delivery-runner.service';
import { SystemMessageFanoutService } from './system-message-fanout.service';

const NETWORK_STUN_SOURCE = 'network.stun.mapping-port-changed';
const NETWORK_TCP_NATMAP_SOURCE = 'network.tcp.natmap-endpoint-changed';
const NETWORK_DDNS_MESSAGE_SOURCES = [
  NETWORK_STUN_SOURCE,
  NETWORK_TCP_NATMAP_SOURCE,
] as const;

@Injectable()
export class SystemMessageDeliveryCoordinatorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    SystemMessageDeliveryCoordinatorService.name,
  );
  private destroyed = false;
  private drainRequested = false;
  private drainPromise: null | Promise<void> = null;
  private scanInterval?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    private readonly fanoutRunner: SystemMessageFanoutService,
    private readonly deliveryRunner: SystemMessageDeliveryRunnerService,
  ) {}

  onModuleInit(): void {
    if (this.destroyed || this.scanInterval) return;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      this.requestDrain();
    }, 0);
    this.startupTimer.unref?.();
    this.scanInterval = setInterval(
      () => this.requestDrain(),
      SYSTEM_MESSAGE_SCAN_INTERVAL_MS,
    );
    this.scanInterval.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.drainRequested = false;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.scanInterval) clearInterval(this.scanInterval);
    this.startupTimer = undefined;
    this.scanInterval = undefined;
    await this.drainPromise;
  }

  /** 请求排空。 */
  requestDrain(): void {
    if (this.destroyed) return;
    this.drainRequested = true;
    if (this.drainPromise) return;
    this.drainPromise = this.drainLoop()
      .catch((error: unknown) =>
        this.logger.warn(
          'System message drain failed',
          error instanceof Error ? error.message : undefined,
        ),
      )
      .finally(() => {
        this.drainPromise = null;
        if (!this.destroyed && this.drainRequested) this.requestDrain();
      });
  }

  /** 通知DDNS已同步的。 */
  async notifyDdnsSynced(input: {
    appliedAddress: string;
    ddnsRecordId: string;
  }): Promise<void> {
    if (
      this.destroyed ||
      typeof input.appliedAddress !== 'string' ||
      isIP(input.appliedAddress) !== 4 ||
      typeof input.ddnsRecordId !== 'string' ||
      input.ddnsRecordId.length === 0
    )
      return;
    const advanced = await this.dataSource.transaction(async (manager) => {
      let affected = 0;
      for (const sourceKey of NETWORK_DDNS_MESSAGE_SOURCES) {
        const subscriptions = await manager
          .getRepository(QqbotMessageSubscription)
          .find({
            where: {
              enabled: true,
              isDeleted: false,
              sourceKey,
            },
          });
        const subscriptionIds = subscriptions
          .filter(
            (subscription) =>
              typeof subscription.sourceConfig?.ddnsRecordId === 'string' &&
              subscription.sourceConfig.ddnsRecordId === input.ddnsRecordId,
          )
          .map((subscription) => subscription.id);
        if (!subscriptionIds.length) continue;
        const events = await manager
          .getRepository(QqbotMessageEvent)
          .find({ where: { sourceKey } });
        const eventIds = events
          .filter((event) => event.payload.publicIpv4 === input.appliedAddress)
          .map((event) => event.id);
        if (!eventIds.length) continue;
        const result = await manager.getRepository(QqbotMessageDelivery).update(
          {
            messageEventId: In(eventIds),
            status: 'waiting_ddns',
            subscriptionId: In(subscriptionIds),
          },
          { nextAttemptAt: new KtDateTime() },
        );
        affected += result.affected || 0;
      }
      return affected;
    });
    if (advanced > 0) this.requestDrain();
  }

  /** 返回排空循环。 */
  private async drainLoop(): Promise<void> {
    while (!this.destroyed && this.drainRequested) {
      this.drainRequested = false;
      const fanout = await this.runBounded('fan-out', () =>
        this.fanoutRunner.runOnce(),
      );
      const delivery = await this.runBounded('delivery', () =>
        this.deliveryRunner.runOnce(),
      );
      if (
        fanout === SYSTEM_MESSAGE_BATCH_SIZE ||
        delivery === SYSTEM_MESSAGE_BATCH_SIZE
      )
        this.drainRequested = true;
    }
  }

  /** 执行有界的。 */
  private async runBounded(
    name: string,
    runner: () => Promise<number>,
  ): Promise<number> {
    try {
      return await runner();
    } catch (error) {
      this.logger.warn(
        `System message ${name} scan failed`,
        error instanceof Error ? error.message : undefined,
      );
      return 0;
    }
  }
}
