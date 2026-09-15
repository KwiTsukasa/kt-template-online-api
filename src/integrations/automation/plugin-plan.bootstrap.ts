import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  PLUGIN_TASK_CAPABILITIES,
  type PluginTaskCapabilityPort,
} from '@/modules/plugin-platform/contract/plugin-task-capability.port';
import { DefaultPlanProvisioner } from './default-plan.provisioner';
import {
  PluginTaskRegistration,
  pluginTaskHandlerKey,
} from './plugin-task.registration';

@Injectable()
export class PluginPlanBootstrap
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PluginPlanBootstrap.name);
  private readonly failures = new Map<string, string>();
  private dirty = true;
  private closing = false;
  private running?: Promise<void>;
  private unsubscribe?: () => void;
  private retry?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(PLUGIN_TASK_CAPABILITIES)
    private readonly capabilities: PluginTaskCapabilityPort,
    private readonly registration: PluginTaskRegistration,
    private readonly provisioner: DefaultPlanProvisioner,
  ) {}

  async onApplicationBootstrap() {
    this.unsubscribe = this.capabilities.subscribe(() => {
      this.dirty = true;
      void this.reconcile();
    });
    await this.reconcile();
    this.retry = setInterval(() => void this.reconcile(), 5000);
    this.retry.unref();
  }

  async onModuleDestroy() {
    this.closing = true;
    this.unsubscribe?.();
    if (this.retry) clearInterval(this.retry);
    await this.running;
  }

  /**
   * 串行收敛插件公开声明，只补齐默认资源；重复事件不会覆盖管理员配置或启动并行装配。
   * @returns 本轮装配结束，失败来源保留待后续恢复。
   */
  reconcile(): Promise<void> {
    if (this.running) return this.running;
    if (this.closing || !this.dirty) return Promise.resolve();
    this.dirty = false;
    this.running = this.provision().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /**
   * 在应用层把活动插件清单翻译成三个独立资源，安装或停用事件不反向修改插件和计划启停。
   * @throws 缺少对应能力时中止该插件任务的初始化，由本轮捕获并记录原因。
   */
  private async provision(): Promise<void> {
    for (const snapshot of this.capabilities.list()) {
      if (!snapshot.active || this.closing) continue;
      for (const task of snapshot.tasks) {
        const sourceKey = `plugin:${snapshot.installationId}:${task.key}`;
        try {
          const handler = this.registration.declaration(
            pluginTaskHandlerKey(snapshot, task.key),
          );
          if (!handler) throw new Error('执行能力尚未完成注册');
          await this.provisioner.ensure({
            sourceKey,
            name: task.name,
            description: task.description || '插件声明的默认执行计划',
            handler,
            trigger: {
              type: 'cron',
              expression: task.defaultCron,
              timezone: 'Asia/Shanghai',
            },
            enabled: task.enabled,
          });
          this.failures.delete(sourceKey);
        } catch (error) {
          this.dirty = true;
          let message = '默认计划暂时无法装配';
          if (error instanceof Error) message = error.message;
          if (this.failures.get(sourceKey) !== message)
            this.logger.warn(`${sourceKey}: ${message}`);
          this.failures.set(sourceKey, message);
        }
      }
    }
  }
}
