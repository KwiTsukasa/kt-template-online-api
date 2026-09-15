import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BOT_REMINDERS,
  type BotReminderPort,
  type BotReminderScheduling,
  type ReminderTiming,
  type ReminderScheduleState,
} from '@/modules/bot-adapter/core/contract/message/bot-reminder.port';
import {
  TASK_HANDLERS,
  type TaskHandlerRegistryPort,
  type TaskHandler,
} from '@/modules/task-execution/contract/task-handler.port';
import {
  SCHEDULE_PLANS,
  type SchedulePlanPort,
} from '@/modules/task-scheduling/contract/schedule.types';
import type { TriggerConfiguration } from '@/modules/trigger-engine/contract/trigger.types';
import { DefaultPlanProvisioner } from './default-plan.provisioner';
import { BOT_REMINDER_HANDLER } from './bot-reminder.defaults';

@Injectable()
export class BotReminderRegistration
  implements
    OnModuleInit,
    OnApplicationBootstrap,
    OnModuleDestroy,
    BotReminderScheduling
{
  private readonly logger = new Logger(BotReminderRegistration.name);
  private unregister?: () => void;
  private detach?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private closing = false;
  private cursor = '';
  private readonly failures = new Map<string, string>();
  private handler: TaskHandler;

  constructor(
    @Inject(BOT_REMINDERS) private readonly reminders: BotReminderPort,
    @Inject(TASK_HANDLERS) private readonly handlers: TaskHandlerRegistryPort,
    @Inject(SCHEDULE_PLANS) private readonly schedules: SchedulePlanPort,
    private readonly provisioner: DefaultPlanProvisioner,
  ) {}

  onModuleInit() {
    this.handler = {
      ...BOT_REMINDER_HANDLER,
      isAvailable: async () => !this.closing,
      execute: async ({ input, signal }) => {
        await this.reminders.execute(
          String(input.reminderId),
          String(input.occurredAt),
          signal,
        );
        return {};
      },
    };
    this.unregister = this.handlers.register(this.handler);
    this.detach = this.reminders.attach(this);
  }

  async onApplicationBootstrap() {
    await this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), 2000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
    this.detach?.();
    this.unregister?.();
  }

  /**
   * 将提醒时刻和身份绑定到独立触发器与计划，正文、群成员和权限不进入通用调度数据。
   * @param timing - Bot 领域公布的最小提醒时序。
   * @returns 统一计划的实际启用及下次发生状态。
   */
  async ensure(timing: ReminderTiming): Promise<ReminderScheduleState> {
    let trigger: TriggerConfiguration = { type: 'once', at: timing.dueAt };
    if (timing.repeat)
      trigger = {
        type: 'cron',
        expression: timing.repeat,
        timezone: 'Asia/Shanghai',
      };
    const key = createHash('sha256').update(timing.id).digest('hex');
    const result = await this.provisioner.ensure({
      sourceKey: 'bot:reminder:' + key,
      taskSourceKey: 'system:bot.reminder.deliver:task',
      name: 'Bot 提醒投递',
      description: 'Bot 领域保存发送内容；此计划仅引用提醒身份和发生时间',
      handler: this.handler,
      trigger,
      enabled: true,
      input: {
        reminderId: { source: 'literal', value: timing.id },
        occurredAt: { source: 'occurrence', field: 'occurredAt' },
      },
    });
    return this.read(result.scheduleId);
  }

  /**
   * 从计划公开状态返回真实发生时间，不根据本地时钟伪造已安排结果。
   * @param scheduleId - 装配时返回给 Bot 的不透明计划身份。
   * @returns 统一计划当前状态。
   */
  async read(scheduleId: string): Promise<ReminderScheduleState> {
    const state = await this.schedules.state(scheduleId);
    return {
      scheduleId,
      enabled: state.enabled && state.activationStatus === 'active',
      nextRunAt: state.nextRunAt,
    };
  }

  /**
   * 使用计划自己的状态修订关闭未来触发，已接收任务由 Bot 的取消意图阻止发送。
   * @param scheduleId - 要关闭的计划身份。
   */
  async close(scheduleId: string): Promise<void> {
    const state = await this.schedules.state(scheduleId);
    if (state.enabled) await this.schedules.disable(scheduleId, state.revision);
  }

  /**
   * 串行恢复未确认的提醒意图，计时器只修复装配，实际到期执行由触发器负责。
   * @returns 本轮同步结束，异常已记录供下一轮恢复。
   */
  reconcile(): Promise<void> {
    if (this.running) return this.running;
    if (this.closing) return Promise.resolve();
    this.running = this.synchronizeBatch()
      .catch((error) => {
        this.logger.error('提醒意图扫描失败: ' + String(error));
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  /**
   * 按游标处理一批提醒并单独记录失败，某条坏记录不会阻塞其他发起人的提醒。
   */
  private async synchronizeBatch(): Promise<void> {
    const ids = await this.reminders.pending(this.cursor);
    if (!ids.length) this.cursor = '';
    for (const id of ids) {
      if (this.closing) return;
      this.cursor = id;
      try {
        await this.reminders.synchronize(id);
        this.failures.delete(id);
      } catch (error) {
        const message = String(error);
        if (this.failures.get(id) !== message)
          this.logger.warn(`提醒 ${id} 同步失败: ${message}`);
        this.failures.set(id, message);
      }
    }
  }
}
