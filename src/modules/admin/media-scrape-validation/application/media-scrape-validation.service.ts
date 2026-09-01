import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import type { MediaGovernanceTask } from '@/modules/admin/media-governance/application/media-governance.service';
import {
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance.entities';
import type {
  MediaScrapeValidationPageQueryDto,
  MediaScrapeValidationResultDto,
  MediaScrapeValidationRevisionDto,
} from '../contract/media-scrape-validation.dto';
import { MediaScrapeValidationEntity } from '../infrastructure/persistence/media-scrape-validation.entity';

export const MEDIA_SCRAPE_VALIDATION_SINK = Symbol(
  'MEDIA_SCRAPE_VALIDATION_SINK',
);

export interface MediaScrapeValidationSink {
  enqueueTask(task: MediaGovernanceTask): Promise<void>;
}

export type MediaScrapeValidationStatus =
  | 'healthy'
  | 'issues'
  | 'pending'
  | 'running';

@Injectable()
export class MediaScrapeValidationService
  implements MediaScrapeValidationSink, OnModuleInit
{
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MediaScrapeValidationEntity)
    private readonly validationRepository: Repository<MediaScrapeValidationEntity>,
    @InjectRepository(MediaGovernanceTaskEntity)
    private readonly taskRepository: Repository<MediaGovernanceTaskEntity>,
    @InjectRepository(MediaGovernanceUnitEntity)
    private readonly unitRepository: Repository<MediaGovernanceUnitEntity>,
  ) {}

  onModuleInit() {
    void this.backfillClosedTasks().catch(() => undefined);
  }

  /**
   * 为已经机械验收关闭的历史任务补建独立刮削校验记录。
   */
  private async backfillClosedTasks(): Promise<void> {
    const tasks = await this.taskRepository.find({
      where: { stage: 'closed' },
    });
    const units = await this.unitRepository.find();
    for (const task of tasks) {
      const taskUnits = units.filter((unit) => unit.taskId === task.id);
      await this.enqueueSnapshot({
        closedAt: task.closedAt?.toISOString() ?? null,
        evidenceSha256s: taskUnits
          .map((unit) => unit.evidenceSha256)
          .filter((value): value is string => Boolean(value)),
        governanceRevision: task.revision,
        mediaType: task.mediaType,
        metadataIdentity: task.metadataIdentity,
        providerRef: task.providerRef,
        releaseYear: task.releaseYear,
        seriesId: task.seriesId,
        taskId: task.id,
        title: task.titleHint,
        unitIds: taskUnits.map((unit) => unit.id),
        workId: task.workId,
      });
    }
  }

  /**
   * 在治理任务机械关闭后保存只读身份和验收快照，任何刮削结果均不回写任务。
   * @param task - 已完成机械验收的媒体治理任务。
   */
  async enqueueTask(task: MediaGovernanceTask): Promise<void> {
    if (task.stage !== 'closed' || task.runState !== 'succeeded') return;
    await this.enqueueSnapshot({
      closedAt: task.closedAt,
      evidenceSha256s: task.units
        .map((unit) => unit.evidenceSha256)
        .filter((value): value is string => Boolean(value)),
      governanceRevision: task.revision,
      mediaType: task.mediaType,
      metadataIdentity: task.metadataIdentity,
      providerRef: task.providerRef,
      releaseYear: task.releaseYear,
      seriesId: task.seriesId,
      taskId: task.id,
      title: task.titleHint,
      unitIds: task.units.map((unit) => unit.id),
      workId: task.workId,
    });
  }

  /**
   * 幂等保存治理快照；同一治理修订号不会覆盖已完成的刮削结论。
   * @param snapshot - 与已关闭治理任务绑定的只读身份和验收快照。
   */
  private async enqueueSnapshot(snapshot: {
    closedAt: null | string;
    evidenceSha256s: string[];
    governanceRevision: number;
    mediaType: string;
    metadataIdentity: null | Record<string, unknown>;
    providerRef: null | Record<string, unknown>;
    releaseYear: null | number;
    seriesId: null | string;
    taskId: string;
    title: string;
    unitIds: string[];
    workId: null | string;
  }): Promise<void> {
    const existing = await this.validationRepository.findOneBy({
      taskId: snapshot.taskId,
    });
    if (
      existing &&
      existing.governanceRevision === snapshot.governanceRevision
    ) {
      return;
    }
    const requestedAt = new Date();
    const entity = this.validationRepository.create({
      completedAt: null,
      evidenceSha256: null,
      governanceRevision: snapshot.governanceRevision,
      governanceSnapshot: {
        closedAt: snapshot.closedAt,
        evidenceSha256s: snapshot.evidenceSha256s,
        unitIds: snapshot.unitIds,
      },
      id: existing?.id ?? `media-scrape-${randomUUID()}`,
      identitySnapshot: {
        mediaType: snapshot.mediaType,
        metadataIdentity: snapshot.metadataIdentity,
        providerRef: snapshot.providerRef,
        releaseYear: snapshot.releaseYear,
      },
      issueProjection: [],
      mediaType: snapshot.mediaType,
      reason: null,
      requestedAt,
      revision: existing?.revision ?? 1,
      seriesId: snapshot.seriesId,
      startedAt: null,
      status: 'pending',
      taskId: snapshot.taskId,
      title: snapshot.title,
      workId: snapshot.workId,
    });
    if (existing) entity.revision += 1;
    await this.validationRepository.save(entity);
  }

  /**
   * 按状态和关键词分页读取独立刮削校验记录。
   * @param query - 状态、关键词和分页条件。
   * @returns 当前页记录及总数。
   */
  async page(query: MediaScrapeValidationPageQueryDto) {
    const rows = await this.validationRepository.find({
      order: { requestedAt: 'DESC' },
    });
    const keyword = query.keyword?.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (query.status && row.status !== query.status) return false;
      if (!keyword) return true;
      return (
        row.title.toLowerCase().includes(keyword) ||
        row.taskId.toLowerCase().includes(keyword)
      );
    });
    const start = (query.pageNo - 1) * query.pageSize;
    return {
      items: filtered
        .slice(start, start + query.pageSize)
        .map((row) => this.project(row)),
      total: filtered.length,
    };
  }

  /**
   * 读取一条独立刮削校验详情。
   * @param validationId - 刮削校验记录标识。
   * @returns 带状态文案的刮削校验详情。
   */
  async detail(validationId: string) {
    const entity = await this.requiredEntity(validationId);
    return this.project(entity);
  }

  /**
   * 将已有结论重新排入刮削校验队列，不改变关联治理任务。
   * @param validationId - 刮削校验记录标识。
   * @param input - 调用方读取到的记录修订号。
   * @returns 重新排队后的刮削校验详情。
   */
  async requestRecheck(
    validationId: string,
    input: MediaScrapeValidationRevisionDto,
  ) {
    const entity = await this.requiredEntity(validationId);
    if (entity.revision !== input.expectedRevision) {
      throwVbenError(
        `刮削校验版本已变化，当前版本为 ${entity.revision}`,
        HttpStatus.CONFLICT,
      );
    }
    if (entity.status === 'running') {
      throwVbenError('刮削校验正在运行', HttpStatus.CONFLICT);
    }
    entity.status = 'pending';
    entity.reason = null;
    entity.issueProjection = [];
    entity.evidenceSha256 = null;
    entity.startedAt = null;
    entity.completedAt = null;
    entity.requestedAt = new Date();
    entity.revision += 1;
    await this.validationRepository.save(entity);
    return this.project(entity);
  }

  /**
   * 以数据库行锁领取最早待处理记录，供 NAS 机械校验执行器消费。
   * @returns 已转为运行态的校验快照；队列为空时返回 `null`。
   */
  async claimNext() {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(MediaScrapeValidationEntity);
      const entity = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        order: { requestedAt: 'ASC' },
        where: { status: 'pending' },
      });
      if (!entity) return null;
      entity.status = 'running';
      entity.startedAt = new Date();
      entity.revision += 1;
      await repository.save(entity);
      return this.project(entity);
    });
  }

  /**
   * 接受 NAS 执行器的校验结论，只更新独立记录并保持治理任务终态不变。
   * @param validationId - 刮削校验记录标识。
   * @param input - 绑定运行修订号、证据摘要与缺项列表的结果。
   * @returns 已完成的刮削校验详情。
   */
  async complete(validationId: string, input: MediaScrapeValidationResultDto) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(MediaScrapeValidationEntity);
      const entity = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: validationId },
      });
      if (!entity) {
        throwVbenError('刮削校验记录不存在', HttpStatus.NOT_FOUND);
      }
      if (
        entity.revision !== input.expectedRevision ||
        entity.status !== 'running'
      ) {
        throwVbenError('刮削校验回调身份已过期', HttpStatus.CONFLICT);
      }
      if (input.status === 'healthy' && input.issues.length > 0) {
        throwVbenError('健康结论不能包含刮削缺项', HttpStatus.BAD_REQUEST);
      }
      if (input.status === 'issues' && input.issues.length === 0) {
        throwVbenError('缺项结论必须包含刮削问题', HttpStatus.BAD_REQUEST);
      }
      entity.status = input.status;
      entity.reason = input.summary;
      entity.issueProjection = input.issues.map((issue) => ({ ...issue }));
      entity.evidenceSha256 = input.evidenceSha256;
      entity.completedAt = new Date();
      entity.revision += 1;
      await repository.save(entity);
      return this.project(entity);
    });
  }

  /**
   * 读取必需的刮削校验实体，不存在时返回统一 404。
   * @param validationId - 刮削校验记录标识。
   * @returns 对应的持久化实体。
   */
  private async requiredEntity(validationId: string) {
    const entity = await this.validationRepository.findOneBy({
      id: validationId,
    });
    if (!entity) {
      throwVbenError('刮削校验记录不存在', HttpStatus.NOT_FOUND);
    }
    return entity;
  }

  /**
   * 把持久化实体转换为前端稳定投影并附加状态文案。
   * @param entity - 当前刮削校验实体。
   * @returns 不含内部 ORM 状态的 API 投影。
   */
  private project(entity: MediaScrapeValidationEntity) {
    let statusLabel = '等待 NAS 刮削校验';
    if (entity.status === 'running') statusLabel = '正在校验 NAS 刮削状态';
    if (entity.status === 'healthy') statusLabel = '刮削校验正常';
    if (entity.status === 'issues') statusLabel = '发现刮削缺项';
    return {
      completedAt: entity.completedAt?.toISOString() ?? null,
      evidenceSha256: entity.evidenceSha256,
      governanceRevision: entity.governanceRevision,
      governanceSnapshot: entity.governanceSnapshot,
      id: entity.id,
      identitySnapshot: entity.identitySnapshot,
      issues: entity.issueProjection,
      mediaType: entity.mediaType,
      reason: entity.reason,
      requestedAt: entity.requestedAt.toISOString(),
      revision: entity.revision,
      seriesId: entity.seriesId,
      startedAt: entity.startedAt?.toISOString() ?? null,
      status: entity.status as MediaScrapeValidationStatus,
      statusLabel,
      taskId: entity.taskId,
      title: entity.title,
      workId: entity.workId,
    };
  }
}
