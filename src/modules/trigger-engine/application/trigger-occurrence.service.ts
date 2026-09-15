import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DataSource, LessThanOrEqual, type EntityManager } from 'typeorm';
import { createSnowflakeId } from '@/common/snowflake/snowflake-id';
import {
  validateDataValues,
  type DataScalar,
} from '@/common/automation/data-schema';
import {
  definitionRecord,
  publishedReference,
  type PublishedReference,
} from '@/common/automation/definition.types';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import type {
  TriggerEvent,
  TriggerEventPort,
  TriggerOccurrencePort,
  TriggerOccurrenceView,
  TriggerRegistrationView,
} from '../contract/trigger-runtime.port';
import { nextTriggerAt } from '../domain/trigger.policy';
import {
  TriggerEventReceipt,
  TriggerOccurrence,
  TriggerRegistration,
} from '../infrastructure/persistence/trigger-runtime.entities';
import { TriggerEngineService } from './trigger-engine.service';
import { TriggerEventRegistry } from './trigger-event.registry';

@Injectable()
export class TriggerOccurrenceService
  implements TriggerOccurrencePort, TriggerEventPort
{
  constructor(
    private readonly database: DataSource,
    private readonly definitions: TriggerEngineService,
    private readonly sources: TriggerEventRegistry,
  ) {}

  /**
   * 先持久化未激活的注册，供消费方保存自己的关联后再开放事件发生。
   * @param request - 消费方不透明身份和固定触发器版本。
   * @returns 稳定注册身份；同一身份重试不会创建第二个注册。
   * @throws 消费身份复用为其他触发器版本时返回冲突。
   */
  async prepare(request: {
    consumerKey: string;
    triggerRef: PublishedReference;
  }): Promise<TriggerRegistrationView> {
    validateDefinitionInput(() => definitionRecord(request));
    this.validateKey(request.consumerKey);
    const reference = validateDefinitionInput(() =>
      publishedReference(request.triggerRef),
    );
    const repository = this.database.getRepository(TriggerRegistration);
    const existing = await repository.findOneBy({
      consumerKey: request.consumerKey,
    });
    if (existing) return this.matchRegistration(existing, reference);
    const definition = await this.definitions.resolve(reference);
    await this.definitions.checkForPublish(definition);
    let nextAt = nextTriggerAt(definition.trigger);
    let eventKey: string | null = null;
    let eventVersion: number | null = null;
    if (definition.trigger.type === 'once')
      nextAt = new Date(definition.trigger.at);
    if (definition.trigger.type === 'event') {
      eventKey = definition.trigger.eventKey;
      eventVersion = definition.trigger.eventVersion;
    }
    const row = repository.create({
      id: createSnowflakeId(),
      consumerKey: request.consumerKey,
      triggerId: reference.id,
      triggerVersion: reference.version,
      definition,
      status: 'prepared',
      nextAt,
      eventKey,
      eventVersion,
    });
    try {
      await repository.insert(row);
    } catch (error) {
      const duplicate = await repository.findOneBy({
        consumerKey: request.consumerKey,
      });
      if (!duplicate) throw error;
      return this.matchRegistration(duplicate, reference);
    }
    return this.registrationView(row);
  }

  /**
   * 只将已准备的注册激活，关闭的身份必须由消费方申请新注册。
   * @param registrationId - 消费方已保存关联的注册身份。
   * @returns 当前激活状态。
   * @throws 已关闭的注册不能重新激活。
   */
  async activate(registrationId: string): Promise<TriggerRegistrationView> {
    return this.database.transaction(async (manager) => {
      const row = await this.lockRegistration(manager, registrationId);
      if (row.status === 'closed')
        throw new ConflictException('已关闭的注册不能重新激活');
      await this.definitions.checkForPublish(row.definition);
      row.status = 'active';
      await manager.save(row);
      return this.registrationView(row);
    });
  }

  /**
   * 关闭未来发生条件并保留历史记录，重复关闭不会清除待确认事件。
   * @param registrationId - 待关闭的注册身份。
   * @returns 已关闭的注册状态。
   */
  async close(registrationId: string): Promise<TriggerRegistrationView> {
    return this.database.transaction(async (manager) => {
      const row = await this.lockRegistration(manager, registrationId);
      row.status = 'closed';
      row.nextAt = null;
      await manager.save(row);
      return this.registrationView(row);
    });
  }

  /**
   * 读取注册公开状态，消费方无需访问触发模块的实体或数据库。
   * @param registrationId - 注册身份。
   * @returns 固定版本和启停状态。
   * @throws 注册不存在时返回 HTTP 404。
   */
  async readRegistration(
    registrationId: string,
  ): Promise<TriggerRegistrationView> {
    const row = await this.database
      .getRepository(TriggerRegistration)
      .findOneBy({ id: registrationId });
    if (!row) throw new NotFoundException('触发注册不存在');
    return this.registrationView(row);
  }

  /**
   * 按注册身份读取一批未确认的持久事件，不修改其消费状态。
   * @param registrationId - 已由消费方保存的注册身份。
   * @returns 最多一百条待消费事件；关闭注册的历史事件仍可读取。
   */
  async pending(registrationId: string): Promise<TriggerOccurrenceView[]> {
    const rows = await this.database
      .getRepository(TriggerOccurrence)
      .find({
        where: { registrationId, status: 'pending' },
        order: { id: 'ASC' },
        take: 100,
      });
    return rows.map((row) => this.occurrenceView(row));
  }

  /**
   * 消费方可靠保存派发记录后确认对应事件，确认操作绑定原注册身份。
   * @param occurrenceId - 已经保存到消费方收件箱的事件身份。
   * @param registrationId - 事件所属的注册身份。
   * @throws 事件不属于该注册时拒绝确认。
   */
  async acknowledge(
    occurrenceId: string,
    registrationId: string,
  ): Promise<void> {
    const repository = this.database.getRepository(TriggerOccurrence);
    const row = await repository.findOneBy({
      id: occurrenceId,
      registrationId,
    });
    if (!row) throw new NotFoundException('触发事件不存在或不属于该注册');
    await repository.update(
      { id: occurrenceId, registrationId, status: 'pending' },
      { status: 'acknowledged', acknowledgedAt: new Date() },
    );
  }

  /**
   * 为手动注册保存一次发生记录，重试同一请求键返回原记录。
   * @param registrationId - 已激活的手动触发注册。
   * @param eventId - 调用方稳定保存的本次操作身份。
   * @returns 本次或此前已经持久化的发生记录。
   * @throws 非手动或未激活注册不能产生新的手动事件。
   */
  async fire(
    registrationId: string,
    eventId: string,
  ): Promise<TriggerOccurrenceView> {
    this.validateKey(eventId);
    return this.database.transaction(async (manager) => {
      const registration = await this.lockRegistration(manager, registrationId);
      const identityKey = this.hash([registrationId, 'manual', eventId]);
      const existing = await manager.findOneBy(TriggerOccurrence, {
        identityKey,
      });
      if (existing) return this.occurrenceView(existing);
      if (
        registration.status !== 'active' ||
        registration.definition.trigger.type !== 'manual'
      )
        throw new ConflictException('只有已激活的手动注册可以发起');
      return this.occurrenceView(
        await this.append(
          manager,
          registration,
          identityKey,
          new Date(),
          {},
          null,
        ),
      );
    });
  }

  /**
   * 在同一个数据库事务内去重业务事件并写入当前订阅者的发生记录。
   * @param event - 已注册事件源产生的稳定身份、时间与公开载荷。
   * @returns 实际接收该事件的发生记录身份；重复请求返回原集合。
   * @throws 事件源缺失、载荷越界或同一事件身份内容变化时拒绝整个事件。
   */
  async publish(event: TriggerEvent): Promise<{ occurrenceIds: string[] }> {
    validateDefinitionInput(() => definitionRecord(event));
    this.validateKey(event.eventId);
    const source = this.sources.resolve(event.eventKey, event.eventVersion);
    if (!source) throw new BadRequestException('事件源固定版本未加载');
    const payload = validateDefinitionInput(() =>
      validateDataValues(source.payloadSchema, event.payload),
    );
    if (
      typeof event.occurredAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
        event.occurredAt,
      ) ||
      !Number.isFinite(Date.parse(event.occurredAt))
    )
      throw new BadRequestException('事件时间必须包含明确时区');
    const occurredAt = new Date(event.occurredAt);
    const id = this.hash([event.eventKey, event.eventVersion, event.eventId]);
    const requestHash = this.hash([
      occurredAt.toISOString(),
      Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const previous = await this.duplicateEvent(id, requestHash);
    if (previous) return previous;
    try {
      return await this.database.transaction(async (manager) => {
        await manager.insert(TriggerEventReceipt, {
          id,
          requestHash,
          eventKey: event.eventKey,
          eventVersion: event.eventVersion,
          occurredAt,
        });
        const registrations = await manager
          .getRepository(TriggerRegistration)
          .createQueryBuilder('registration')
          .where(
            'registration.status = :status AND registration.eventKey = :eventKey AND registration.eventVersion = :eventVersion',
            {
              status: 'active',
              eventKey: event.eventKey,
              eventVersion: event.eventVersion,
            },
          )
          .orderBy('registration.id', 'ASC')
          .setLock('pessimistic_write')
          .getMany();
        const occurrenceIds: string[] = [];
        for (const registration of registrations) {
          const trigger = registration.definition.trigger;
          if (
            trigger.type !== 'event' ||
            !isDeepStrictEqual(trigger.payloadSchema, source.payloadSchema)
          )
            throw new ConflictException('事件源契约与已发布触发器不一致');
          const occurrence = await this.append(
            manager,
            registration,
            this.hash([registration.id, id]),
            occurredAt,
            payload,
            id,
          );
          occurrenceIds.push(occurrence.id);
        }
        return { occurrenceIds };
      });
    } catch (error) {
      const duplicate = await this.duplicateEvent(id, requestHash);
      if (duplicate) return duplicate;
      throw error;
    }
  }

  /**
   * 根据数据库持久游标生成到期事件，游标推进和事件写入在同一事务中完成。
   * @param now - 本轮恢复使用的时间基准。
   * @returns 本轮产生的事件数量；积压周期合并为一次并保留最早到期时间。
   */
  async recordDue(now = new Date()): Promise<number> {
    const rows = await this.database
      .getRepository(TriggerRegistration)
      .find({
        where: { status: 'active', nextAt: LessThanOrEqual(now) },
        order: { nextAt: 'ASC', id: 'ASC' },
        take: 100,
      });
    let count = 0;
    for (const candidate of rows) {
      count += await this.database.transaction(async (manager) => {
        const row = await this.lockRegistration(manager, candidate.id);
        if (
          row.status !== 'active' ||
          !row.nextAt ||
          row.nextAt.getTime() > now.getTime()
        )
          return 0;
        const dueAt = row.nextAt;
        await this.append(
          manager,
          row,
          this.hash([row.id, 'time', dueAt.toISOString()]),
          dueAt,
          {},
          null,
        );
        const trigger = row.definition.trigger;
        row.nextAt = nextTriggerAt(trigger, now);
        if (trigger.type === 'interval') {
          const periods =
            Math.floor((now.getTime() - dueAt.getTime()) / trigger.everyMs) + 1;
          row.nextAt = new Date(dueAt.getTime() + periods * trigger.everyMs);
        }
        await manager.save(row);
        return 1;
      });
    }
    return count;
  }

  /**
   * 在触发资源页面列出其注册状态，不解析消费方内部的计划数据。
   * @param triggerId - 当前触发器资源身份。
   * @returns 最近一百个注册状态。
   */
  async registrations(triggerId: string) {
    const rows = await this.database
      .getRepository(TriggerRegistration)
      .find({ where: { triggerId }, order: { id: 'DESC' }, take: 100 });
    return rows.map((row) => this.registrationView(row));
  }

  /**
   * 按触发器和可选游标读取发生记录，保留未确认事件供页面诊断。
   * @param triggerId - 当前触发器资源身份。
   * @param beforeId - 上一页末尾身份，省略时读取最近一页。
   * @returns 最近一百条事件及继续读取的游标。
   * @throws 分页身份非法时拒绝查询。
   */
  async occurrences(triggerId: string, beforeId?: string) {
    const query = this.database
      .getRepository(TriggerOccurrence)
      .createQueryBuilder('occurrence')
      .where('occurrence.triggerId = :triggerId', { triggerId });
    if (beforeId) {
      if (!/^[1-9]\d{0,19}$/.test(beforeId))
        throw new BadRequestException('发生记录游标不合法');
      query.andWhere('occurrence.id < :beforeId', { beforeId });
    }
    const rows = await query
      .orderBy('occurrence.id', 'DESC')
      .take(101)
      .getMany();
    let nextCursor: string | null = null;
    if (rows.length > 100) {
      rows.pop();
      nextCursor = rows[rows.length - 1].id;
    }
    return { list: rows.map((row) => this.occurrenceView(row)), nextCursor };
  }

  /**
   * 对已接收事件验证内容一致性，并返回首次事务生成的订阅者集合。
   * @param id - 从事件源版本及事件身份计算的摘要。
   * @param requestHash - 规范时间与载荷内容的摘要。
   * @returns 已有发生记录身份；事件尚未接收时为空。
   * @throws 同一事件身份被复用为不同内容时返回冲突。
   */
  private async duplicateEvent(id: string, requestHash: string) {
    const receipt = await this.database
      .getRepository(TriggerEventReceipt)
      .findOneBy({ id });
    if (!receipt) return undefined;
    if (receipt.requestHash !== requestHash)
      throw new ConflictException('事件身份已经用于其他内容');
    const rows = await this.database
      .getRepository(TriggerOccurrence)
      .find({
        where: { eventReceiptId: id },
        select: { id: true },
        order: { id: 'ASC' },
      });
    return { occurrenceIds: rows.map((row) => row.id) };
  }

  /**
   * 使用当前事务锁定单个注册，串行化激活、关闭和事件发生。
   * @param manager - 当前数据库事务的实体管理器。
   * @param id - 注册身份。
   * @returns 持有行锁的注册记录。
   * @throws 注册不存在时返回 HTTP 404。
   */
  private async lockRegistration(manager: EntityManager, id: string) {
    const row = await manager.findOne(TriggerRegistration, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw new NotFoundException('触发注册不存在');
    return row;
  }

  /**
   * 在调用方事务内追加完整发生记录，唯一摘要阻止同一发生点重复保存。
   * @param manager - 拥有注册锁或事件收件事务的管理器。
   * @param registration - 发生条件对应的固定注册。
   * @param identityKey - 注册与发生点共同确定的唯一摘要。
   * @param occurredAt - 原始到期时间或业务事件时间。
   * @param payload - 经过事件源契约验证的公开字段。
   * @param eventReceiptId - 业务事件收件身份；时间和手动事件为空。
   * @returns 已持久化的待确认发生记录。
   */
  private async append(
    manager: EntityManager,
    registration: TriggerRegistration,
    identityKey: string,
    occurredAt: Date,
    payload: Record<string, DataScalar>,
    eventReceiptId: string | null,
  ) {
    const row = manager.create(TriggerOccurrence, {
      id: createSnowflakeId(),
      identityKey,
      registrationId: registration.id,
      triggerId: registration.triggerId,
      triggerVersion: registration.triggerVersion,
      occurredAt,
      payload,
      eventReceiptId,
      status: 'pending',
      acknowledgedAt: null,
    });
    await manager.insert(TriggerOccurrence, row);
    return row;
  }

  /**
   * 确认消费身份仍指向原始触发版本，禁止重试时偷偷改变发生条件。
   * @param row - 已存在的注册记录。
   * @param reference - 本次请求指定的触发版本。
   * @returns 原注册公开状态。
   * @throws 消费身份对应的触发版本变化时返回冲突。
   */
  private matchRegistration(
    row: TriggerRegistration,
    reference: PublishedReference,
  ) {
    if (
      row.triggerId !== reference.id ||
      row.triggerVersion !== reference.version
    )
      throw new ConflictException('消费身份已经用于其他触发版本');
    return this.registrationView(row);
  }

  /**
   * 投影注册的固定引用和生命周期，不将内部定义快照交给消费方修改。
   * @param row - 模块内部的注册记录。
   * @returns 公开注册视图。
   */
  private registrationView(row: TriggerRegistration): TriggerRegistrationView {
    return {
      id: row.id,
      consumerKey: row.consumerKey,
      triggerRef: { id: row.triggerId, version: row.triggerVersion },
      status: row.status,
      nextAt: row.nextAt,
    };
  }

  /**
   * 只暴露声明过的事件载荷及身份，隐藏内部去重摘要和收件表关联。
   * @param row - 已持久化的发生记录。
   * @returns 消费方和管理页面共享的事件视图。
   */
  private occurrenceView(row: TriggerOccurrence): TriggerOccurrenceView {
    return {
      id: row.id,
      registrationId: row.registrationId,
      triggerRef: { id: row.triggerId, version: row.triggerVersion },
      occurredAt: row.occurredAt,
      payload: row.payload,
      status: row.status,
    };
  }

  /**
   * 限制调用方提供的幂等身份大小，拒绝空白和控制字符。
   * @param value - 消费身份或事件请求身份。
   * @throws 身份为空、过长或包含控制字符时拒绝处理。
   */
  private validateKey(value: unknown): void {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 191 ||
      /[\u0000-\u001f]/.test(value)
    )
      throw new BadRequestException('请求身份必须是 1 至 191 个可见字符');
  }

  /**
   * 对顺序明确的身份片段生成固定长度摘要，避免拼接分隔符发生歧义。
   * @param value - 已规范化且排序明确的身份片段。
   * @returns 数据库唯一索引使用的摘要。
   */
  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
