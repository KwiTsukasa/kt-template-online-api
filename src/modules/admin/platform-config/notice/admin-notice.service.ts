import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  SystemNoticePublishInput,
  SystemNoticePublisher,
  throwVbenError,
  ToolsService,
} from '@/common';
import { AdminNotice } from './admin-notice.entity';
import type { AdminNoticeQueryDto } from './admin-notice.dto';

const SYSTEM_NOTICE_DEFAULT_ROLE_CODE = 'super';
const NOTICE_SEVERITY_LEVEL_MAP: Record<string, number> = {
  fatal: 4,
  error: 3,
  warn: 2,
  info: 1,
};
type NormalizedSystemNoticeInput = {
  content: string;
  dedupeKey?: string;
  eventType: string;
  level: number;
  metadata?: Record<string, unknown>;
  notifyRoleCode: string;
  severity: string;
  source: string;
  summary: string;
  title: string;
};

@Injectable()
export class AdminNoticeService implements SystemNoticePublisher {
  constructor(
    @InjectRepository(AdminNotice)
    private readonly noticeRepository: Repository<AdminNotice>,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 按`query`读取分页数据；把变更持久化到当前存储（`noticeRepository.createQueryBuilder`）。
   * @param query - 限定分页数据筛选、排序与分页范围的查询条件，包含 `pageNo`、`page`、`pageSize`、`keyword` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的分页数据。
   */
  async page(query: AdminNoticeQueryDto = {}) {
    const pageNo = this.toolsService.toPositiveNumber(
      query.pageNo ?? query.page,
      1,
    );
    const pageSize = this.toolsService.toPositiveNumber(query.pageSize, 20);
    const builder = this.noticeRepository
      .createQueryBuilder('notice')
      .where('notice.isDeleted = :isDeleted', { isDeleted: false });

    const keyword = this.toolsService.toTrimmedString(query.keyword);
    if (keyword) {
      builder.andWhere(
        new Brackets((subBuilder) => {
          subBuilder
            .where('notice.title LIKE :keyword', { keyword: `%${keyword}%` })
            .orWhere('notice.content LIKE :keyword', {
              keyword: `%${keyword}%`,
            })
            .orWhere('notice.summary LIKE :keyword', {
              keyword: `%${keyword}%`,
            });
        }),
      );
    }

    this.applyLikeFilter(builder, 'notifyUsers', query.notifyUsers);
    this.applyExactTextFilter(builder, 'severity', query.severity);
    this.applyExactTextFilter(builder, 'source', query.source);
    this.applyExactTextFilter(builder, 'eventType', query.eventType);
    this.applyExactTextFilter(builder, 'notifyRoleCode', query.notifyRoleCode);

    const level = this.normalizeLevel(query.level);
    if (Number.isFinite(level)) {
      builder.andWhere('notice.level = :level', { level });
    }

    const status = this.normalizeStatus(query.status);
    if (Number.isFinite(status)) {
      builder.andWhere('notice.status = :status', { status });
    }

    const isTop = this.normalizeBoolean(query.isTop);
    if (isTop !== undefined) {
      builder.andWhere('notice.isTop = :isTop', { isTop });
    }

    const [items, total] = await builder
      .orderBy('notice.isTop', 'DESC')
      .addOrderBy('notice.lastSeenAt', 'DESC')
      .addOrderBy('notice.createTime', 'DESC')
      .skip((pageNo - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: items.map((item) => this.serialize(item)),
      total,
    };
  }

  /**
   * 按`input`投递System通知；当 `normalizedInput.dedupeKey` 成立时返回 `this.aggregateSystemNotice( existingNotice.…`。
   * @param input - 用于System通知的结构化输入。
   * @returns System通知。
   * @throws 当 `!normalizedInput.dedupeKey || !this.isDuplicateKeyError(err)` 成立时重新抛出该入口捕获且决定公开的原异常；当 `!existingNotice` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  async publishSystemNotice(input: SystemNoticePublishInput) {
    const normalizedInput = this.normalizeSystemNoticeInput(input);
    const now = new Date();

    if (normalizedInput.dedupeKey) {
      const existingNotice = await this.findActiveNoticeByDedupeKey(
        normalizedInput.dedupeKey,
      );

      if (existingNotice) {
        return this.aggregateSystemNotice(
          existingNotice.id,
          normalizedInput,
          now,
        );
      }
    }

    const notice = this.noticeRepository.create({
      ...normalizedInput,
      firstSeenAt: now,
      isTop: false,
      lastSeenAt: now,
      occurrenceCount: 1,
      status: 1,
    });
    try {
      const saved = await this.noticeRepository.save(notice);
      return saved.id;
    } catch (err) {
      if (!normalizedInput.dedupeKey || !this.isDuplicateKeyError(err)) {
        throw err;
      }

      const existingNotice = await this.findActiveNoticeByDedupeKey(
        normalizedInput.dedupeKey,
      );
      if (!existingNotice) throw err;
      return this.aggregateSystemNotice(
        existingNotice.id,
        normalizedInput,
        now,
      );
    }
  }

  /**
   * 按规范化标识查询未删除站内信并投影详情；标识为空或记录不存在时以业务错误拒绝。
   * @param id - 决定按规范化标识查询未删除站内信并投影详情内容、边界或目标的 `id` 值。
   * @returns 按规范化标识查询未删除站内信并投影详情。
   */
  async get(id: string) {
    const noticeId = this.toolsService.toTrimmedString(id);
    if (!noticeId) throwVbenError('站内信ID不能为空', HttpStatus.BAD_REQUEST);

    const notice = await this.noticeRepository.findOne({
      where: {
        id: noticeId,
        isDeleted: false,
      },
    });
    if (!notice) throwVbenError('站内信不存在', HttpStatus.BAD_REQUEST);

    return this.serialize(notice);
  }

  /**
   * 按`id`移除`remove` 对应结果；把变更持久化到当前存储（`noticeRepository.update`）。
   * @param id - 决定`remove` 对应结果内容、边界或目标的 `id` 值。
   * @returns 固定为 `null`，表示当前入口不会产生`remove` 对应。
   */
  async remove(id: string) {
    const noticeId = this.toolsService.toTrimmedString(id);
    if (!noticeId) throwVbenError('站内信ID不能为空', HttpStatus.BAD_REQUEST);

    const notice = await this.noticeRepository.findOne({
      where: {
        id: noticeId,
        isDeleted: false,
      },
    });
    if (!notice) throwVbenError('站内信不存在', HttpStatus.BAD_REQUEST);

    await this.noticeRepository.update(
      {
        id: noticeId,
      },
      {
        isDeleted: true,
      },
    );
    return null;
  }

  /**
   * 根据`id`、`status`处理状态；把变更持久化到当前存储（`noticeRepository.save`）。
   * @param id - 决定状态内容、边界或目标的 `id` 值。
   * @param status - 决定状态内容、边界或目标的 `status` 值。
   * @returns 固定为 `null`，表示当前入口不会产生状态。
   */
  async toggleStatus(id: string, status: number | string) {
    const normalizedStatus = this.normalizeStatus(status);
    if (Number.isNaN(normalizedStatus)) {
      throwVbenError('status 参数不合法', HttpStatus.BAD_REQUEST);
    }
    const noticeId = this.toolsService.toTrimmedString(id);
    if (!noticeId) throwVbenError('站内信ID不能为空', HttpStatus.BAD_REQUEST);

    const notice = await this.noticeRepository.findOne({
      where: {
        id: noticeId,
        isDeleted: false,
      },
    });
    if (!notice) throwVbenError('站内信不存在', HttpStatus.BAD_REQUEST);

    await this.noticeRepository.save(
      this.noticeRepository.merge(notice, {
        status: normalizedStatus,
      }),
    );

    return null;
  }

  /**
   * 根据`id`、`isTop`处理Top；把变更持久化到当前存储（`noticeRepository.save`）。
   * @param id - 决定Top内容、边界或目标的 `id` 值。
   * @param isTop - 决定是否启用“Top”分支的布尔选项。
   * @returns 固定为 `null`，表示当前入口不会产生Top。
   */
  async toggleTop(id: string, isTop: boolean | number | string) {
    const noticeId = this.toolsService.toTrimmedString(id);
    if (!noticeId) throwVbenError('站内信ID不能为空', HttpStatus.BAD_REQUEST);

    const normalizedIsTop = this.normalizeBoolean(isTop);
    if (normalizedIsTop === undefined) {
      throwVbenError('isTop 参数不合法', HttpStatus.BAD_REQUEST);
    }

    const notice = await this.noticeRepository.findOne({
      where: {
        id: noticeId,
        isDeleted: false,
      },
    });
    if (!notice) throwVbenError('站内信不存在', HttpStatus.BAD_REQUEST);

    await this.noticeRepository.save(
      this.noticeRepository.merge(notice, {
        isTop: normalizedIsTop,
      }),
    );

    return null;
  }

  /**
   * 根据`builder`、`field`、`value`更新模糊匹配。
   * @param builder - 用于模糊匹配的领域对象，包含 `andWhere` 字段。
   * @param field - 决定模糊匹配内容、边界或目标的 `field` 值。
   * @param value - 参与模糊匹配比较、格式化或输出的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private applyLikeFilter(
    builder: ReturnType<Repository<AdminNotice>['createQueryBuilder']>,
    field: keyof Pick<AdminNotice, 'notifyUsers'>,
    value?: string,
  ) {
    const normalizedValue = this.toolsService.toTrimmedString(value);
    if (!normalizedValue) return;

    builder.andWhere(`notice.${field} LIKE :${field}`, {
      [field]: `%${normalizedValue}%`,
    });
  }

  /**
   * 根据`builder`、`field`、`value`更新精确匹配文本。
   * @param builder - 用于精确匹配文本的领域对象，包含 `andWhere` 字段。
   * @param field - 决定精确匹配文本内容、边界或目标的 `field` 值。
   * @param value - 参与精确匹配文本比较、格式化或输出的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private applyExactTextFilter(
    builder: ReturnType<Repository<AdminNotice>['createQueryBuilder']>,
    field: keyof Pick<
      AdminNotice,
      'eventType' | 'notifyRoleCode' | 'severity' | 'source'
    >,
    value?: string,
  ) {
    const normalizedValue = this.toolsService.toTrimmedString(value);
    if (!normalizedValue) return;

    builder.andWhere(`notice.${field} = :${field}`, {
      [field]: normalizedValue,
    });
  }

  /**
   * 根据 `false` 判定输入是否满足条件。
   * @param value - 待转换为根据 `false` 判定输入是否满足条件的原始值。
   * @returns 满足根据 `false` 判定输入是否满足条件约束时为 `true`；不满足、未命中或显式失败分支为 `false`；没有可用结果或提前结束时为 `undefined`。
   */
  private normalizeBoolean(value: boolean | number | string | undefined) {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 1 || `${value}` === '1') return true;
    if (value === false || value === 0 || `${value}` === '0') return false;
    return undefined;
  }

  /**
   * 将`level`规范为Level，使等价输入得到一致表示；当 `Number.isFinite(normalizedLevel)` 成立时返回 `normalizedLevel`。
   * @param level - 决定Level内容、边界或目标的 `level` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 输入可转换为有限数时返回该数值，否则返回 `NaN`。
   */
  private normalizeLevel(level?: number | string) {
    const normalizedLevel = Number(level);
    if (Number.isFinite(normalizedLevel)) {
      return normalizedLevel;
    }
    return Number.NaN;
  }

  /**
   * 将`status`规范为状态，使等价输入得到一致表示；当 `normalizedStatus === 0 || normalizedStatus === 1` 成立时返回 `normalizedStatus`。
   * @param status - 决定状态内容、边界或目标的 `status` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 状态。
   */
  private normalizeStatus(status?: number | string) {
    const normalizedStatus = Number(status);
    if (normalizedStatus === 0 || normalizedStatus === 1) {
      return normalizedStatus;
    }
    return NaN;
  }

  /**
   * 将`severity`规范为Severity，使等价输入得到一致表示；当 `NOTICE_SEVERITY_LEVEL_MAP[normalized]` 成立时返回 `normalized`。
   * @param severity - 决定Severity内容、边界或目标的 `severity` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的Severity，取值为 `'info'`。
   */
  private normalizeSeverity(severity?: string) {
    const normalized = this.toolsService
      .toTrimmedString(severity)
      .toLowerCase();
    if (NOTICE_SEVERITY_LEVEL_MAP[normalized]) {
      return normalized;
    }
    return 'info';
  }

  /**
   * 将`input`规范为System通知输入，使等价输入得到一致表示。
   * @param input - 用于System通知输入的结构化输入，包含 `title`、`content`、`source`、`eventType` 字段。
   * @returns 包含 `content`、`dedupeKey`、`eventType`、`level`、`metadata` 字段的System通知输入；没有可用结果或提前结束时为 `undefined`。
   */
  private normalizeSystemNoticeInput(input: SystemNoticePublishInput) {
    const title = this.toolsService.toColumnText(input.title, 255);
    const content = this.toolsService.toStoredMessageText(input.content, 4000);
    const source = this.toolsService.toColumnText(
      this.toolsService.toTrimmedString(input.source) || 'system',
      64,
    );
    const eventType = this.toolsService.toColumnText(
      this.toolsService.toTrimmedString(input.eventType) || 'system.event',
      120,
    );
    const severity = this.normalizeSeverity(input.severity);
    const dedupeKey = this.toolsService.toStableColumnText(
      input.dedupeKey,
      255,
    );

    if (!title) throwVbenError('站内信标题不能为空', HttpStatus.BAD_REQUEST);
    if (!content) throwVbenError('站内信内容不能为空', HttpStatus.BAD_REQUEST);

    return {
      content,
      dedupeKey: dedupeKey || undefined,
      eventType,
      level: NOTICE_SEVERITY_LEVEL_MAP[severity],
      metadata: input.metadata,
      notifyRoleCode: this.toolsService.toColumnText(
        this.toolsService.toTrimmedString(input.notifyRoleCode) ||
          SYSTEM_NOTICE_DEFAULT_ROLE_CODE,
        64,
      ),
      severity,
      source,
      summary: this.toolsService.toStoredMessageText(
        input.summary || content,
        200,
      ),
      title,
    } satisfies NormalizedSystemNoticeInput;
  }

  /**
   * 按`dedupeKey`读取启用状态通知Dedupe键；从 `noticeRepository.findOne` 读取启用状态通知Dedupe键。
   * @param dedupeKey - 用于读取或更新启用状态通知Dedupe键的稳定键。
   * @returns 启用状态通知Dedupe键。
   */
  private async findActiveNoticeByDedupeKey(dedupeKey: string) {
    return this.noticeRepository.findOne({
      where: {
        dedupeKey,
        isDeleted: false,
      },
    });
  }

  /**
   * 根据`id`、`normalizedInput`、`lastSeenAt`处理aggregateSystem通知；把变更持久化到当前存储（`noticeRepository.createQueryBuilder`）。
   * @param id - 决定aggregateSystem通知内容、边界或目标的 `id` 值。
   * @param normalizedInput - 决定aggregateSystem通知内容、边界或目标的 `normalizedInput` 值。
   * @param lastSeenAt - 用于过期、排序或租约判定的时间基准。
   * @returns aggregateSystem通知。
   */
  private async aggregateSystemNotice(
    id: string,
    normalizedInput: NormalizedSystemNoticeInput,
    lastSeenAt: Date,
  ) {
    await this.noticeRepository
      .createQueryBuilder()
      .update(AdminNotice)
      .set({
        ...normalizedInput,
        lastSeenAt,
        occurrenceCount: () => 'occurrence_count + 1',
        status: 1,
      } as any)
      .where('id = :id', { id })
      .execute();
    return id;
  }

  /**
   * 仅把 MySQL `ER_DUP_ENTRY` 或错误号 1062 识别为唯一键冲突，其他错误一律返回 `false`。
   * @param err - `err` 仅为兼容调用签名保留，当前实现不读取该值。
   * @returns 返回 `error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062 || `${error?.me…` 的判定结果；条件成立为 `true`，否则为 `false`。
   */
  private isDuplicateKeyError(err: unknown) {
    const error = err as { code?: string; errno?: number; message?: string };
    return (
      error?.code === 'ER_DUP_ENTRY' ||
      error?.errno === 1062 ||
      `${error?.message || ''}`.includes('Duplicate entry')
    );
  }

  /**
   * 序列化业务数据，并输出固定投影 `content`、`createTime`、`createdBy`、`id`、`isDeleted` 字段。
   * @param notice - 用于`serialize` 对应结果的领域对象，包含 `content`、`createTime`、`createdBy`、`id` 字段。
   * @returns 包含 `content`、`createTime`、`createdBy`、`id`、`isDeleted` 字段的`serialize` 对应。
   */
  private serialize(notice: AdminNotice) {
    return {
      content: notice.content,
      createTime: notice.createTime,
      createdBy: notice.createdBy,
      id: notice.id,
      isDeleted: notice.isDeleted,
      isTop: notice.isTop,
      dedupeKey: notice.dedupeKey,
      eventType: notice.eventType,
      firstSeenAt: notice.firstSeenAt,
      lastSeenAt: notice.lastSeenAt,
      level: notice.level,
      metadata: notice.metadata,
      notifyUsers: notice.notifyUsers,
      notifyRoleCode: notice.notifyRoleCode,
      occurrenceCount: notice.occurrenceCount,
      severity: notice.severity,
      source: notice.source,
      status: notice.status,
      summary: notice.summary,
      title: notice.title,
      updateTime: notice.updateTime,
    };
  }
}
