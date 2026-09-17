import {
  rejectDefinitionInput,
  requireRequest,
  requireConsistent,
  requireFound,
} from '@/common/automation/validation';

import {
  DataSource,
  type EntityManager,
  type EntityTarget,
  Like,
} from 'typeorm';
import { createSnowflakeId } from '../snowflake/snowflake-id';
import {
  DefinitionDraftRow,
  DefinitionRevisionRow,
} from './definition.entities';
import type {
  DefinitionDocument,
  DefinitionWrite,
  PublishedReference,
} from './definition.types';
import type { DefinitionProvision } from './definition-provision.port';
import { isAutomationUniqueConflict } from './database-error';

/**
 * 将纯领域校验失败转换为明确的请求错误，不把数据库或执行异常吞成校验通过。
 * @param action - 不含持久化和副作用的同步校验。
 * @returns 领域校验产生的规范值。
 * @throws 领域输入不合法时返回 HTTP 400。
 */
export function validateDefinitionInput<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    rejectDefinitionInput(error);
  }
}

export class DefinitionRepository<T> {
  constructor(
    private readonly database: DataSource,
    private readonly draftEntity: EntityTarget<DefinitionDraftRow>,
    private readonly revisionEntity: EntityTarget<DefinitionRevisionRow>,
    private readonly normalize: (definition: unknown) => T | Promise<T>,
    private readonly onPublish?: (
      definition: T,
      reference: PublishedReference,
      manager: EntityManager,
    ) => Promise<void>,
  ) {}

  /**
   * 以来源键原子建立默认资源及首个发布版本，已有资源的名称、草稿与发布状态始终保留。
   * @param input - 集成声明的来源键、默认内容及迁移时可选的原资源身份。
   * @param checkReferences - 资源所属模块对首次发布依赖的校验。
   * @returns 已有或新建的定义，以及本次是否建立了资源。
   * @throws 来源键或保留身份无效、身份冲突、首次发布校验失败时拒绝写入。
   */
  async provision(
    input: DefinitionProvision<T>,
    checkReferences: (definition: T) => Promise<void>,
  ) {
    requireRequest(
      typeof input.sourceKey === 'string' &&
        /^[a-z][a-z0-9_.:-]{2,190}$/.test(input.sourceKey),
      '资源来源键无效',
    );
    if (input.preferredId !== undefined) {
      requireRequest(
        typeof input.preferredId === 'string' &&
          /^[1-9]\d{0,18}$/.test(input.preferredId) &&
          BigInt(input.preferredId) <= 9223372036854775807n,
        '迁移资源身份无效',
      );
    }
    const repository = this.database.getRepository(this.draftEntity);
    const existing = await repository.findOneBy({ sourceKey: input.sourceKey });
    if (existing) {
      requireConsistent(
        !input.preferredId || existing.id === input.preferredId,
        '来源键已关联其他资源身份',
      );
      return { document: existing as DefinitionDocument<T>, created: false };
    }
    const metadata = this.metadata(input);
    const definition = await this.normalizeInput(input.definition);
    await checkReferences(definition);
    const id = input.preferredId || createSnowflakeId();
    try {
      await this.database.transaction(async (manager) => {
        await manager.getRepository(this.draftEntity).insert({
          id,
          sourceKey: input.sourceKey,
          ...metadata,
          definition: definition as object,
          revision: 1,
          publishedVersion: 1,
        });
        await manager.getRepository(this.revisionEntity).insert({
          definitionId: id,
          version: 1,
          ...metadata,
          definition: definition as object,
        });
        await this.onPublish?.(definition, { id, version: 1 }, manager);
      });
      return { document: await this.detail(id), created: true };
    } catch (error) {
      if (!isAutomationUniqueConflict(error)) throw error;
      const concurrent = await repository.findOneBy({
        sourceKey: input.sourceKey,
      });
      requireConsistent(concurrent, '待迁移身份已被其他资源占用');
      requireConsistent(
        !input.preferredId || concurrent.id === input.preferredId,
        '来源键已关联其他资源身份',
      );
      return { document: concurrent as DefinitionDocument<T>, created: false };
    }
  }

  /**
   * 在当前资源自己的表中分页读取草稿，不跨域聚合其他定义。
   * @param query - 名称关键字与有界分页参数。
   * @returns 草稿列表与分页总数。
   */
  async page(query: Record<string, unknown>) {
    const pageNo = Math.max(1, Math.min(100000, Number(query.pageNo) || 1));
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 20));
    const name = String(query.name || '').slice(0, 128);
    const [list, total] = await this.database
      .getRepository(this.draftEntity)
      .findAndCount({
        where: { name: Like(`%${name}%`) },
        order: { updateTime: 'DESC', id: 'DESC' },
        skip: (Math.floor(pageNo) - 1) * Math.floor(pageSize),
        take: Math.floor(pageSize),
      });
    return {
      list,
      total,
      pageNo: Math.floor(pageNo),
      pageSize: Math.floor(pageSize),
    };
  }

  /**
   * 按当前资源标识读取草稿，缺失记录明确返回不存在。
   * @param id - 当前模块的资源标识。
   * @returns 包含编辑版本的草稿。
   * @throws 资源不存在时返回 HTTP 404。
   */
  async detail(id: string): Promise<DefinitionDocument<T>> {
    const row = await this.database
      .getRepository(this.draftEntity)
      .findOneBy({ id });
    requireFound(row, '定义不存在');
    return row as DefinitionDocument<T>;
  }

  /**
   * 校验元数据和领域定义后创建草稿，发布版本初始为空。
   * @param body - 名称、说明和当前模块的领域定义。
   * @returns 创建后的资源与编辑版本。
   */
  async create(body: DefinitionWrite): Promise<DefinitionDocument<T>> {
    const metadata = this.metadata(body);
    const definition = await this.normalizeInput(body.definition);
    const row = this.database.getRepository(this.draftEntity).create({
      ...metadata,
      definition,
      id: createSnowflakeId(),
      revision: 1,
      publishedVersion: null,
    });
    return (await this.database
      .getRepository(this.draftEntity)
      .save(row)) as DefinitionDocument<T>;
  }

  /**
   * 以编辑版本作原子更新条件，防止覆盖另一个编辑者已经保存的内容。
   * @param id - 当前模块的资源标识。
   * @param body - 完整草稿与读取时的编辑版本。
   * @returns 保存后的草稿。
   * @throws 草稿版本变化时返回 HTTP 409。
   */
  async update(
    id: string,
    body: DefinitionWrite,
  ): Promise<DefinitionDocument<T>> {
    const metadata = this.metadata(body);
    const definition = await this.normalizeInput(body.definition);
    this.requireRevision(body.expectedRevision);
    const changed = await this.database.getRepository(this.draftEntity).update(
      { id, revision: body.expectedRevision },
      {
        ...metadata,
        definition: definition as object,
        revision: body.expectedRevision + 1,
      },
    );
    requireConsistent(changed.affected === 1, '草稿已变化，请刷新后编辑');
    return this.detail(id);
  }

  /**
   * 在同一事务内锁定草稿并插入不可变版本，发布前由拥有者校验依赖资源。
   * @param id - 待发布资源标识。
   * @param expectedRevision - 编辑者最后读取的草稿版本。
   * @param checkReferences - 当前模块对固定版本依赖的校验。
   * @returns 新发布的版本及用于继续编辑的草稿版本。
   * @throws 草稿缺失或版本冲突时拒绝发布。
   */
  async publish(
    id: string,
    expectedRevision: number,
    checkReferences: (definition: T) => Promise<void>,
  ) {
    this.requireRevision(expectedRevision);
    return this.database.transaction(async (manager) => {
      const drafts = manager.getRepository(this.draftEntity);
      const row = await drafts.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      requireFound(row, '定义不存在');
      requireConsistent(
        row.revision === expectedRevision,
        '草稿已变化，请刷新后发布',
      );
      const definition = await this.normalizeInput(row.definition);
      await checkReferences(definition);
      const version = (row.publishedVersion || 0) + 1;
      const revisions = manager.getRepository(this.revisionEntity);
      await revisions.insert({
        definitionId: id,
        version,
        name: row.name,
        description: row.description,
        definition: definition as object,
      });
      await drafts.update(
        { id, revision: expectedRevision },
        { publishedVersion: version, revision: expectedRevision + 1 },
      );
      await this.onPublish?.(definition, { id, version }, manager);
      return { id, version, revision: expectedRevision + 1 };
    });
  }

  /**
   * 返回当前资源的已发布版本目录，不返回其他资源的版本。
   * @param id - 当前模块的资源标识。
   * @returns 按发布时间倒序排列的版本记录。
   */
  async versions(id: string) {
    await this.detail(id);
    return this.database.getRepository(this.revisionEntity).find({
      where: { definitionId: id },
      order: { version: 'DESC' },
      take: 100,
    });
  }

  /**
   * 只解析指定发布版本，草稿更新和后续发布不会改变调用结果。
   * @param reference - 资源标识与固定发布版本。
   * @returns 该发布版本保存的领域定义。
   * @throws 指定版本不存在时返回 HTTP 404。
   */
  async published(reference: PublishedReference): Promise<T> {
    const row = await this.database
      .getRepository(this.revisionEntity)
      .findOneBy({ definitionId: reference.id, version: reference.version });
    requireFound(row, '引用的发布版本不存在');
    return row.definition as T;
  }

  /**
   * 限制名称和说明长度，拒绝对象隐式转换造成的无效元数据。
   * @param body - 创建或修改资源的请求。
   * @returns 可写入数据库的元数据。
   * @throws 名称或说明类型及长度非法时返回 HTTP 400。
   */
  private metadata(body: DefinitionWrite) {
    requireRequest(
      body &&
        typeof body.name === 'string' &&
        body.name.trim() &&
        body.name.trim().length <= 128,
      '名称需要 1 至 128 个字符',
    );
    requireRequest(
      body.description === undefined ||
        (typeof body.description === 'string' &&
          body.description.length <= 2048),
      '说明最多 2048 个字符',
    );
    return { name: body.name.trim(), description: body.description || '' };
  }

  /**
   * 要求调用方显式携带正整数编辑版本，禁止无条件覆盖。
   * @param revision - 请求携带的编辑版本。
   * @throws 版本未提供或不是正整数时返回 HTTP 400。
   */
  private requireRevision(revision: unknown): asserts revision is number {
    requireRequest(
      Number.isSafeInteger(revision) && Number(revision) >= 1,
      '必须提供正整数 expectedRevision',
    );
  }

  /**
   * 等待领域解析完成后才允许持久化，异步 XML 解析错误与同步校验错误均返回请求错误。
   * @param definition - 调用方提交的领域定义。
   * @returns 完整解析并规范化的定义。
   * @throws 领域格式不合法时返回 HTTP 400。
   */
  private async normalizeInput(definition: unknown): Promise<T> {
    try {
      return await this.normalize(definition);
    } catch (error) {
      rejectDefinitionInput(error);
    }
  }
}
