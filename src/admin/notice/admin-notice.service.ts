import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  throwVbenError,
  ToolsService,
} from '@/common';
import { AdminNotice } from './admin-notice.entity';
import type {
  AdminNoticeBodyDto,
  AdminNoticeQueryDto,
  AdminNoticeUpdateDto,
} from './admin-notice.dto';

@Injectable()
export class AdminNoticeService {
  constructor(
    @InjectRepository(AdminNotice)
    private readonly noticeRepository: Repository<AdminNotice>,
    private readonly toolsService: ToolsService,
  ) {}

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
      .addOrderBy('notice.createTime', 'DESC')
      .skip((pageNo - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: items.map((item) => this.serialize(item)),
      total,
    };
  }

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

  async create(body: AdminNoticeBodyDto, createdBy?: string) {
    const input = this.normalizeInput(body);
    const notice = this.noticeRepository.create({
      ...input,
      createdBy,
    });

    const saved = await this.noticeRepository.save(notice);
    return saved.id;
  }

  async update(body: AdminNoticeUpdateDto) {
    const id = this.toolsService.toTrimmedString(body.id);
    if (!id) throwVbenError('站内信ID不能为空', HttpStatus.BAD_REQUEST);

    const notice = await this.noticeRepository.findOne({
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!notice) throwVbenError('站内信不存在', HttpStatus.BAD_REQUEST);

    const input = this.normalizeInput({
      ...body,
      content: body.content || notice.content,
      title: body.title || notice.title,
    });
    await this.noticeRepository.save(
      this.noticeRepository.merge(notice, input),
    );
    return null;
  }

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

  private normalizeBoolean(value: boolean | number | string | undefined) {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 1 || `${value}` === '1') return true;
    if (value === false || value === 0 || `${value}` === '0') return false;
    return undefined;
  }

  private normalizeLevel(level?: number | string) {
    const normalizedLevel = Number(level);
    return Number.isFinite(normalizedLevel) ? normalizedLevel : Number.NaN;
  }

  private normalizeStatus(status?: number | string) {
    const normalizedStatus = Number(status);
    return normalizedStatus === 0 || normalizedStatus === 1
      ? normalizedStatus
      : NaN;
  }

  private normalizeNotifyUsers(notifyUsers?: string) {
    const normalized = this.toolsService.toTrimmedString(notifyUsers);
    if (!normalized) return undefined;

    const userIds = normalized
      .split(',')
      .map((item) => this.toolsService.toTrimmedString(item))
      .filter((item) => !!item)
      .filter((item, index, array) => array.indexOf(item) === index);

    return userIds.length ? userIds.join(',') : undefined;
  }

  private normalizeInput(body: AdminNoticeBodyDto) {
    const title = this.toolsService.toTrimmedString(body.title);
    const content = this.toolsService.toTrimmedString(body.content);
    const summary = this.toolsService.toTrimmedString(body.summary) || undefined;
    const level = this.normalizeLevel(body.level);
    const status = this.normalizeStatus(body.status);
    const isTop = this.normalizeBoolean(body.isTop);

    if (!title) throwVbenError('标题不能为空', HttpStatus.BAD_REQUEST);
    if (!content) throwVbenError('内容不能为空', HttpStatus.BAD_REQUEST);

    return {
      content,
      level: Number.isFinite(level) ? level : 1,
      notifyUsers: this.normalizeNotifyUsers(body.notifyUsers),
      isTop: isTop ?? false,
      status: status === 0 || status === 1 ? status : 1,
      summary,
      title,
    };
  }

  private serialize(notice: AdminNotice) {
    return {
      content: notice.content,
      createTime: notice.createTime,
      createdBy: notice.createdBy,
      id: notice.id,
      isDeleted: notice.isDeleted,
      isTop: notice.isTop,
      level: notice.level,
      notifyUsers: notice.notifyUsers,
      status: notice.status,
      summary: notice.summary,
      title: notice.title,
      updateTime: notice.updateTime,
    };
  }
}
