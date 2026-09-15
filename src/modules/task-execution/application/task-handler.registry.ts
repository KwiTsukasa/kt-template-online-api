import { Injectable } from '@nestjs/common';
import { normalizeDataSchema } from '@/common/automation/data-schema';
import type {
  TaskHandler,
  TaskHandlerReference,
  TaskHandlerRegistryPort,
} from '../contract/task-handler.port';

@Injectable()
export class TaskHandlerRegistry implements TaskHandlerRegistryPort {
  private readonly handlers = new Map<string, TaskHandler>();

  /**
   * 注册经代码审核的能力及输入输出契约，拒绝用数据库内容生成处理器。
   * @param handler - 业务装配层提供的执行能力。
   * @returns 只撤销本次注册的释放函数。
   * @throws 身份重复、执行约束或数据契约不合法时拒绝注册。
   */
  register(handler: TaskHandler): () => void {
    if (
      !/^[a-z][a-z0-9_.:-]{2,190}$/.test(handler.key) ||
      !Number.isSafeInteger(handler.version) ||
      handler.version < 1 ||
      !/^[a-z][a-z0-9-]{1,31}$/.test(handler.ownerKind)
    )
      throw new Error('处理器身份不合法');
    if (
      !Number.isSafeInteger(handler.timeoutMs) ||
      handler.timeoutMs < 1000 ||
      handler.timeoutMs > 3600000
    )
      throw new Error('处理器期限必须在一秒到一小时之间');
    if (
      typeof handler.idempotent !== 'boolean' ||
      typeof handler.execute !== 'function' ||
      typeof handler.isAvailable !== 'function'
    )
      throw new Error('处理器执行约束不合法');
    const key = `${handler.key}@${handler.version}`;
    if (this.handlers.has(key)) throw new Error('处理器版本重复注册');
    const saved = {
      ...handler,
      inputSchema: normalizeDataSchema(handler.inputSchema),
      outputSchema: normalizeDataSchema(handler.outputSchema),
    };
    this.handlers.set(key, saved);
    return () => {
      if (this.handlers.get(key) === saved) this.handlers.delete(key);
    };
  }

  /**
   * 只解析指定处理器契约版本，模块卸载后不会回落到其他版本。
   * @param reference - 代码能力的固定版本。
   * @returns 当前加载的处理器，未加载时为空。
   */
  resolve(reference: TaskHandlerReference): TaskHandler | undefined {
    return this.handlers.get(`${reference.key}@${reference.version}`);
  }

  /**
   * 暴露不含执行函数的能力目录，供任务定义选择处理器。
   * @returns 带实时可用性的处理器元数据。
   */
  async catalog() {
    return Promise.all(
      [...this.handlers.values()].map(async (handler) => ({
        key: handler.key,
        version: handler.version,
        name: handler.name,
        ownerKind: handler.ownerKind,
        idempotent: handler.idempotent,
        timeoutMs: handler.timeoutMs,
        inputSchema: handler.inputSchema,
        outputSchema: handler.outputSchema,
        available: await handler.isAvailable(),
      })),
    );
  }
}
