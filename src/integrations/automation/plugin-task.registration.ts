import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  TASK_HANDLERS,
  type TaskHandlerRegistryPort,
  type TaskHandler,
} from '@/modules/task-execution/contract/task-handler.port';
import {
  PLUGIN_TASK_CAPABILITIES,
  PLUGIN_TASK_EXECUTION,
  type PluginTaskCapabilities,
  type PluginTaskCapabilityPort,
  type PluginTaskExecutionPort,
} from '@/modules/plugin-platform/contract/plugin-task-capability.port';

/**
 * 为安装、包版本与能力键生成稳定处理器身份，插件升级不会替换旧版已发布引用。
 * @param snapshot - 插件平台公布的持久安装与包版本。
 * @param taskKey - 清单中的任务能力键。
 * @returns 长度有界且与其他安装隔离的处理器键。
 */
export function pluginTaskHandlerKey(
  snapshot: PluginTaskCapabilities,
  taskKey: string,
): string {
  return (
    'plugin.' +
    createHash('sha256')
      .update([snapshot.installationId, snapshot.versionId, taskKey].join('\0'))
      .digest('hex')
  );
}

@Injectable()
export class PluginTaskRegistration implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginTaskRegistration.name);
  private readonly registrations = new Map<string, () => void>();
  private readonly registeredHandlers = new Map<string, TaskHandler>();
  private unsubscribe?: () => void;
  private retry?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(PLUGIN_TASK_CAPABILITIES)
    private readonly capabilities: PluginTaskCapabilityPort,
    @Inject(PLUGIN_TASK_EXECUTION)
    private readonly executor: PluginTaskExecutionPort,
    @Inject(TASK_HANDLERS) private readonly handlers: TaskHandlerRegistryPort,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.capabilities.subscribe(() => this.reconcile());
    this.reconcile();
    this.retry = setInterval(() => this.reconcile(), 1000);
    this.retry.unref();
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    if (this.retry) clearInterval(this.retry);
    for (const unregister of this.registrations.values()) unregister();
    this.registrations.clear();
    this.registeredHandlers.clear();
  }

  /**
   * 仅返回已完成注册的固定能力，默认计划无需读取原子任务模块内部注册表。
   * @param key - 安装与包版本绑定的处理器身份。
   * @returns 已注册能力；尚未注册或已经撤销时为空。
   */
  declaration(key: string): TaskHandler | undefined {
    return this.registeredHandlers.get(key);
  }

  /**
   * 读取插件公开声明并注册固定执行契约；失败只保留待恢复的集成状态，不调用插件安装操作。
   */
  private reconcile(): void {
    const snapshots = this.capabilities.list();
    const desired = new Set<string>();
    for (const snapshot of snapshots) {
      for (const task of snapshot.tasks) {
        const key = pluginTaskHandlerKey(snapshot, task.key);
        desired.add(key);
        if (this.registrations.has(key)) continue;
        try {
          const handler: TaskHandler = {
            key,
            version: 1,
            name: task.name,
            ownerKind: 'plugin',
            idempotent: task.idempotent === true,
            timeoutMs: task.timeoutMs,
            inputSchema: task.inputSchema || { fields: [] },
            outputSchema: task.outputSchema || { fields: [] },
            isAvailable: async () =>
              this.capabilities
                .list()
                .some(
                  (current) =>
                    current.installationId === snapshot.installationId &&
                    current.pluginId === snapshot.pluginId &&
                    current.versionId === snapshot.versionId &&
                    current.active,
                ),
            execute: async (execution) => {
              if (execution.signal.aborted) throw new Error('插件任务已经取消');
              const result = await this.executor.executeTask({
                installationId: snapshot.installationId,
                pluginId: snapshot.pluginId,
                versionId: snapshot.versionId,
                taskKey: task.key,
                taskHandlerName: task.handlerName,
                taskId: execution.runId,
                input: execution.input,
                timeoutMs: task.timeoutMs,
                triggerType: 'workflow',
              });
              if (!task.outputSchema?.fields.length) return {};
              return result;
            },
          };
          const unregister = this.handlers.register(handler);
          this.registrations.set(key, unregister);
          this.registeredHandlers.set(key, handler);
        } catch {
          this.logger.warn('插件任务能力暂时无法注册，等待集成恢复');
        }
      }
    }
    for (const [key, unregister] of this.registrations) {
      if (desired.has(key)) continue;
      unregister();
      this.registrations.delete(key);
      this.registeredHandlers.delete(key);
    }
  }
}
