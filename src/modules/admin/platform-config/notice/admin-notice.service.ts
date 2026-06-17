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
  /**
   * 初始化 AdminNoticeService 实例。
   * @param noticeRepository - Admin仓库依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(AdminNotice)
    private readonly noticeRepository: Repository<AdminNotice>,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 获取分页数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
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
   * 投递 Admin 平台配置消息或任务。
   * @param input - input 输入；驱动 `this.normalizeSystemNoticeInput()` 的 Admin步骤。
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
   * 获取业务数据。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
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
   * 删除数据。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
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
   * 执行 Admin 平台配置流程。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param status - Admin列表；驱动 `this.normalizeStatus()`、`throwVbenError()` 的 Admin步骤。
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
   * 执行 Admin 平台配置流程。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param isTop - isTop 输入；驱动 `this.normalizeBoolean()`、`throwVbenError()` 的 Admin步骤。
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
   * 执行 Admin 平台配置流程。
   * @param builder - builder 输入；执行 `builder.andWhere()` 对应的 Admin步骤。
   * @param field - field 输入；影响 applyLikeFilter 的返回值。
   * @param value - 待转换值；驱动 `toolsService.toTrimmedString()` 的 Admin步骤。
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
   * 执行 Admin 平台配置流程。
   * @param builder - builder 输入；执行 `builder.andWhere()` 对应的 Admin步骤。
   * @param field - field 输入；影响 applyExactTextFilter 的返回值。
   * @param value - 待转文本值；驱动 `toolsService.toTrimmedString()` 的 Admin步骤。
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
   * 转换 Admin 平台配置输入。
   * @param value - 待转换值；决定 Admin条件分支。
   */
  private normalizeBoolean(value: boolean | number | string | undefined) {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 1 || `${value}` === '1') return true;
    if (value === false || value === 0 || `${value}` === '0') return false;
    return undefined;
  }

  /**
   * 转换 Admin 平台配置输入。
   * @param level - level 输入；驱动 `Number()` 的 Admin步骤。
   */
  private normalizeLevel(level?: number | string) {
    const normalizedLevel = Number(level);
    return Number.isFinite(normalizedLevel) ? normalizedLevel : Number.NaN;
  }

  /**
   * 转换 Admin 平台配置输入。
   * @param status - Admin列表；驱动 `Number()` 的 Admin步骤。
   */
  private normalizeStatus(status?: number | string) {
    const normalizedStatus = Number(status);
    return normalizedStatus === 0 || normalizedStatus === 1
      ? normalizedStatus
      : NaN;
  }

  /**
   * 转换 Admin 平台配置输入。
   * @param severity - severity 输入；驱动 `toTrimmedString()` 的 Admin步骤。
   */
  private normalizeSeverity(severity?: string) {
    const normalized = this.toolsService
      .toTrimmedString(severity)
      .toLowerCase();
    return NOTICE_SEVERITY_LEVEL_MAP[normalized] ? normalized : 'info';
  }

  /**
   * 转换 Admin 平台配置输入。
   * @param input - input 输入；使用 `title`、`content`、`source`、`eventType` 字段生成结果。
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
   * 查询 Admin 平台配置数据。
   * @param dedupeKey - dedupeKey 输入；限定 Admin查询范围。
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
   * 执行 Admin 平台配置流程。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param normalizedInput - normalizedInput 输入；影响 aggregateSystemNotice 的返回值。
   * @param lastSeenAt - lastSeenAt 输入；影响 aggregateSystemNotice 的返回值。
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
        /**
         * 执行 Admin回调。
         */
        occurrenceCount: () => 'occurrence_count + 1',
        status: 1,
      } as any)
      .where('id = :id', { id })
      .execute();
    return id;
  }

  /**
   * 判断 Admin 平台配置条件。
   * @param err - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
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
   * 序列化业务数据。
   * @param notice - notice 输入；使用 `content`、`createTime`、`createdBy`、`id` 字段生成结果。
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
