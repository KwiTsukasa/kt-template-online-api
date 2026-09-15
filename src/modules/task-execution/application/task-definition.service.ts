import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, Not, IsNull } from 'typeorm';
import { isDeepStrictEqual } from 'node:util';
import {
  DefinitionRepository,
  validateDefinitionInput,
} from '@/common/automation/definition.repository';
import {
  publishedReference,
  type PublishedReference,
} from '@/common/automation/definition.types';
import type { AtomicTaskDefinition } from '../contract/task-definition.types';
import type { TaskCapability } from '../contract/task-execution.port';
import { normalizeAtomicTaskDefinition } from '../domain/task-definition.policy';
import {
  AtomicTaskDraft,
  AtomicTaskRevision,
} from '../infrastructure/persistence/task-execution.entities';
import { TaskHandlerRegistry } from './task-handler.registry';
import type { DefinitionProvision } from '@/common/automation/definition-provision.port';

@Injectable()
export class TaskDefinitionService {
  readonly definitions: DefinitionRepository<AtomicTaskDefinition>;
  constructor(
    private readonly database: DataSource,
    readonly handlers: TaskHandlerRegistry,
  ) {
    this.definitions = new DefinitionRepository(
      database,
      AtomicTaskDraft,
      AtomicTaskRevision,
      normalizeAtomicTaskDefinition,
    );
  }

  /**
   * 由资源所属模块建立来源声明的首个发布版本，重启或重复同步不覆盖管理员编辑。
   * @param input - 集成声明的稳定来源键、默认配置和可选迁移身份。
   * @returns 已保留或新建的资源以及本次创建标志。
   */
  provision(input: DefinitionProvision<AtomicTaskDefinition>) {
    return this.definitions.provision(input, async (definition) => {
      await this.checkForPublish(definition);
    });
  }

  /**
   * 在发布前检查处理器版本、实时可用性和重试约束。
   * @param definition - 原子任务的执行定义。
   * @throws 能力缺失、不可用或重试未声明幂等时返回 HTTP 400。
   */
  async checkForPublish(definition: AtomicTaskDefinition): Promise<void> {
    const handler = this.handlers.resolve(definition.handler);
    if (!handler || !(await handler.isAvailable()))
      throw new BadRequestException('处理器版本未加载或已停用');
    if (!this.matchesContract(definition))
      throw new BadRequestException('任务的数据契约与处理器版本不匹配');
    if (definition.timeoutMs > handler.timeoutMs)
      throw new BadRequestException('任务期限不能超过处理器允许的期限');
    if (definition.maxAttempts > 1 && !handler.idempotent)
      throw new BadRequestException('处理器未声明幂等，不能自动重试');
  }

  /**
   * 将固定任务版本映射为工作流可引用的能力，运行时仍须重新检查可用性。
   * @param reference - 已发布原子任务版本。
   * @returns 数据契约、身份和当前可用性。
   * @throws 版本或处理器契约缺失时拒绝解析。
   */
  async resolve(reference: PublishedReference): Promise<TaskCapability> {
    reference = validateDefinitionInput(() => publishedReference(reference));
    const definition = await this.definitions.published(reference);
    const handler = this.handlers.resolve(definition.handler);
    const revision = await this.database
      .getRepository(AtomicTaskRevision)
      .findOneByOrFail({
        definitionId: reference.id,
        version: reference.version,
      });
    let available = false;
    if (handler && this.matchesContract(definition))
      available = await handler.isAvailable();
    return {
      id: reference.id,
      version: reference.version,
      name: revision.name,
      key: definition.handler.key,
      ownerKind: definition.contract.ownerKind,
      available,
      idempotent: definition.contract.idempotent,
      timeoutMs: definition.timeoutMs,
      inputSchema: definition.contract.inputSchema,
      outputSchema: definition.contract.outputSchema,
    };
  }

  /**
   * 列出当前可解析的已发布任务供流程节点选择，未发布草稿不进入执行目录。
   * @returns 固定版本的任务能力列表。
   */
  async capabilities(): Promise<TaskCapability[]> {
    const rows = await this.database.getRepository(AtomicTaskDraft).find({
      where: { publishedVersion: Not(IsNull()) },
      order: { name: 'ASC' },
      take: 500,
    });
    const capabilities: TaskCapability[] = [];
    for (const row of rows) {
      const reference = { id: row.id, version: row.publishedVersion };
      capabilities.push(await this.resolve(reference));
    }
    return capabilities;
  }

  /**
   * 比较发布时冻结的契约与当前代码注册，阻止同版本偷偷改变参数语义。
   * @param definition - 已规范化的任务定义。
   * @returns 当前处理器仍满足固定契约时为真。
   */
  matchesContract(definition: AtomicTaskDefinition): boolean {
    const handler = this.handlers.resolve(definition.handler);
    if (!handler) return false;
    return isDeepStrictEqual(definition.contract, {
      inputSchema: handler.inputSchema,
      outputSchema: handler.outputSchema,
      idempotent: handler.idempotent,
      ownerKind: handler.ownerKind,
    });
  }
}
