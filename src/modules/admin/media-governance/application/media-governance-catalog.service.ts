import { createHash, randomUUID } from 'node:crypto';
import {
  HttpStatus,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { throwVbenError, toKtDateTime } from '@/common';
import type {
  MediaGovernanceEpisodePageQueryDto,
  MediaGovernanceMagnetBatchCreateDto,
  MediaGovernanceCatalogIdentitySearchQueryDto,
  MediaGovernanceRssDiscoverySearchDto,
  MediaGovernanceRssContextRepairDto,
  MediaGovernanceRssIdentitySelectionDto,
  MediaGovernanceRssIdentitySearchQueryDto,
  MediaGovernanceRssSubscriptionCreateDto,
  MediaGovernanceRssSubscriptionRebindDto,
  MediaGovernanceRssSubscriptionStateDto,
  MediaGovernanceSeriesPageQueryDto,
  MediaGovernanceSeriesReconcileDto,
  MediaGovernanceSeriesCreateDto,
  MediaGovernanceSeriesSeasonFactDto,
  MediaGovernanceWorkCreateDto,
  MediaGovernanceWorkTaskCreateDto,
} from '@/modules/admin/media-governance/contract/media-governance-catalog.dto';
import type {
  MediaGovernanceMediaType,
  MediaGovernanceProvider,
} from '@/modules/admin/media-governance/contract/media-governance.dto';
import {
  MediaGovernanceEpisodeEntity,
  MediaGovernanceRssItemEntity,
  MediaGovernanceRssSubscriptionEntity,
  MediaGovernanceSeasonEntity,
  MediaGovernanceSeriesEntity,
  MediaGovernanceSeriesExternalRefEntity,
  MediaGovernanceTaskEpisodeBindingEntity,
  MediaGovernanceWorkEntity,
  MediaGovernanceWorkExternalRefEntity,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';
import {
  MediaGovernanceSourceEntity,
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance.entities';
import {
  discoverMediaGovernanceRssSources,
  searchMediaGovernanceCatalogIdentityCandidates,
  searchMediaGovernanceRssIdentityCandidates,
  type MediaGovernanceRssIdentityCandidate,
  verifyMediaGovernanceRssIdentity,
  verifyMediaGovernanceCatalogIdentity,
} from '@/modules/admin/media-governance/infrastructure/integration/media-governance-rss-discovery';
import {
  mediaGovernanceMagnetInfoHash,
  mediaGovernanceRssTitleIncluded,
  normalizeMediaGovernanceMagnetUri,
  parseMediaGovernanceEpisodeNumber,
  parseMediaGovernanceRss,
  type MediaGovernanceRssEntry,
} from '@/modules/admin/media-governance/infrastructure/integration/media-governance-rss-parser';
import { parseTorrentDescriptor } from '@/modules/admin/media-governance/domain/media-torrent-descriptor';
import {
  MediaGovernanceService,
  type MediaGovernanceTask,
} from './media-governance.service';
import {
  MediaGovernanceEventStreamService,
  type MediaGovernanceTaskChangedData,
} from './media-governance-event-stream.service';

const RSS_POLL_TICK_MS = 60_000;
const RSS_MAX_BYTES = 4 * 1024 * 1024;
const RSS_RETRYABLE_ITEM_STATES = new Set(['discovered', 'failed', 'ignored']);
const RSS_TORRENT_MAX_BYTES = 2 * 1024 * 1024;
const RSS_TORRENT_HOSTS = new Set([
  'acg.rip',
  'anibt.net',
  'mikanani.kas.pub',
  'nyaa.si',
  'www.shanaproject.com',
]);

type HistoricalClassificationStatus =
  | 'classifiable'
  | 'classified'
  | 'not-applicable'
  | 'pending';

type HistoricalIdentity = {
  provider: string;
  providerId: string;
};

type RssTaskIdentity = {
  provider: 'bangumi' | 'tmdb';
  providerId: string;
  releaseYear: null | number;
  title: string;
};

type HistoricalIdentityTarget = {
  matchRole: 'canonical' | 'external-ref';
  series: MediaGovernanceSeriesEntity;
};

type HistoricalSeasonEvidence = {
  episodeNumbers: number[];
  season: MediaGovernanceSeasonEntity;
};

type HistoricalEvidenceResult =
  | {
      ok: false;
      reasonCode: string;
      reasonLabel: string;
    }
  | {
      ok: true;
      seasons: HistoricalSeasonEvidence[];
    };

type HistoricalClassificationTarget = {
  canonicalProvider: string;
  canonicalProviderId: string;
  matchRole: 'canonical' | 'catalog-binding' | 'external-ref';
  releaseYear: number;
  seasons: Array<{
    canonicalEpisodeCount: number;
    canonicalEpisodeStart: number;
    episodeCount: number;
    episodeRanges: Array<{ end: number; start: number }>;
    existingBindingCount: number;
    missingBindingCount: number;
    seasonNumber: number;
  }>;
  seriesId: string;
  title: string;
};

type HistoricalClassificationItem = {
  existingBindingCount: number;
  mediaType: string;
  metadataIdentity: HistoricalIdentity | null;
  reasonCode: string;
  reasonLabel: string;
  status: HistoricalClassificationStatus;
  target: HistoricalClassificationTarget | null;
  taskId: string;
  title: string;
};

type HistoricalClassificationScope = {
  bindingsByTask: Map<string, MediaGovernanceTaskEpisodeBindingEntity[]>;
  canonicalEpisodes: Set<string>;
  episodesById: Map<string, MediaGovernanceEpisodeEntity>;
  identityTargets: Map<string, HistoricalIdentityTarget[]>;
  seasonsById: Map<string, MediaGovernanceSeasonEntity>;
  seriesById: Map<string, MediaGovernanceSeriesEntity>;
  seasonsByIdentity: Map<string, MediaGovernanceSeasonEntity>;
};

type TaskSeasonEvidence = {
  episodeNumbers: number[];
  seasonNumber: number;
};

type TaskSeasonEvidenceResult =
  | {
      ok: false;
      reasonCode: string;
      reasonLabel: string;
    }
  | {
      ok: true;
      seasons: TaskSeasonEvidence[];
    };

export interface MediaGovernanceCatalogSynchronizationResult {
  changed: boolean;
  reasonCode: string;
  reasonLabel: string;
  seriesId: null | string;
  status: 'ignored' | 'pending' | 'synchronized';
  taskId: string;
}

/**
 * 把离散集号压缩为连续起止范围，供系列详情展示任务覆盖而不返回数百条重复记录。
 * @param values - 需要按升序压缩的集号集合。
 * @returns 不重叠且升序的起止范围。
 */
function compressEpisodeRanges(values: number[]) {
  const episodes = [...new Set(values)].sort((left, right) => left - right);
  const ranges: Array<{ end: number; start: number }> = [];
  for (const episode of episodes) {
    const current = ranges.at(-1);
    if (current && episode === current.end + 1) {
      current.end = episode;
      continue;
    }
    ranges.push({ end: episode, start: episode });
  }
  return ranges;
}

/**
 * 为历史任务归档生成只依据资料源与资料编号的匹配键，明确排除标题和年份参与自动合并。
 * @param provider - canonical 或外部引用的资料源。
 * @param providerId - 资料源内唯一编号。
 * @returns 去除首尾空白后的精确身份键。
 */
function historicalIdentityKey(provider: string, providerId: string): string {
  return `${provider.trim()}:${providerId.trim()}`;
}

/**
 * 比较两个集号集合是否完全一致，避免把来源映射与单元声明冲突的任务自动归类。
 * @param left - 第一组集号。
 * @param right - 第二组集号。
 * @returns 两组集号完全相同时返回 `true`。
 */
function sameEpisodeSet(left: Set<number>, right: Set<number>): boolean {
  if (left.size !== right.size) return false;
  for (const episodeNumber of left) {
    if (!right.has(episodeNumber)) return false;
  }
  return true;
}

/**
 * 将资料源与 Work 类型收敛为不会混淆 TMDB TV/Movie 的稳定命名空间。
 *
 * @param provider - 已核验身份的资料源。
 * @param workType - 当前 Work 的 TV、电影或剧场版类型。
 * @returns 可参与 Work 唯一键的 provider namespace。
 */
function workIdentityNamespace(
  provider: string,
  workType: MediaGovernanceMediaType,
): string {
  if (provider === 'bangumi') return 'subject';
  if (workType === 'tv') return 'tv';
  return 'movie';
}

/**
 * 将电影与剧场版视为同一独立媒体族，同时阻止 TV Task 跨类型绑定。
 * @param taskType - 遗留 Task 保存的媒体类型快照。
 * @param workType - 新 Work 经用户确认的媒体类型。
 * @returns 两者都为 TV 或都为独立电影媒体时返回 true。
 */
function sameWorkMediaKind(
  taskType: MediaGovernanceMediaType,
  workType: MediaGovernanceMediaType,
) {
  if (taskType === 'tv' || workType === 'tv') return taskType === workType;
  return true;
}

/**
 * 从已确认文件选择中交叉校验 Unit 声明与主媒体视频映射，按季返回唯一集号证据。
 *
 * @param task - 待归类的媒体治理任务快照。
 * @param requireMappedVideo - 是否要求来源清单已检查且每个 Unit 都有完整视频映射。
 * @returns 完整季集证据，或第一条稳定失败原因。
 */
function collectTaskSeasonEvidence(
  task: MediaGovernanceTask,
  requireMappedVideo: boolean,
): TaskSeasonEvidenceResult {
  const units = task.units.filter((unit) => unit.unitKind === 'season');
  if (units.length === 0) {
    return {
      ok: false,
      reasonCode: 'season-evidence-missing',
      reasonLabel: '任务缺少 TV Season 单元',
    };
  }
  const primarySources = task.sources.filter(
    (source) => source.sourceRole === 'primary_media',
  );
  if (
    requireMappedVideo &&
    (primarySources.length === 0 ||
      primarySources.some((source) => source.manifestState !== 'inspected'))
  ) {
    return {
      ok: false,
      reasonCode: 'source-manifest-unconfirmed',
      reasonLabel: '主媒体来源尚未完成文件清单确认',
    };
  }
  const episodesBySeason = new Map<number, Set<number>>();
  for (const unit of units) {
    const seasonMatch = /^S(\d{2})$/u.exec(unit.seasonNumber ?? '');
    if (!seasonMatch) {
      return {
        ok: false,
        reasonCode: 'season-evidence-invalid',
        reasonLabel: '任务季号不是唯一的 S00–S99 canonical 令牌',
      };
    }
    const seasonNumber = Number(seasonMatch[1]);
    const declaredEpisodes = new Set<number>();
    for (const rawEpisode of unit.expectedEpisodeNumbers ?? []) {
      const episodeNumber = Number(rawEpisode);
      if (
        !Number.isInteger(episodeNumber) ||
        episodeNumber < 1 ||
        episodeNumber > 2000
      ) {
        return {
          ok: false,
          reasonCode: 'episode-evidence-invalid',
          reasonLabel: '任务声明包含非法集号',
        };
      }
      declaredEpisodes.add(episodeNumber);
    }
    const mappedEpisodes = new Set<number>();
    for (const source of primarySources) {
      for (const mapping of source.selectedFileMappings ?? []) {
        if (mapping.unitId !== unit.id || mapping.fileRole !== 'video')
          continue;
        const episodeNumber = mapping.episodeNumber;
        if (
          episodeNumber === null ||
          episodeNumber === undefined ||
          !Number.isInteger(episodeNumber) ||
          episodeNumber < 1 ||
          episodeNumber > 2000
        ) {
          return {
            ok: false,
            reasonCode: 'episode-evidence-invalid',
            reasonLabel: '来源文件映射包含非法集号',
          };
        }
        mappedEpisodes.add(episodeNumber);
      }
    }
    if (
      declaredEpisodes.size > 0 &&
      mappedEpisodes.size > 0 &&
      !sameEpisodeSet(declaredEpisodes, mappedEpisodes)
    ) {
      return {
        ok: false,
        reasonCode: 'episode-evidence-conflict',
        reasonLabel: 'Task Unit 声明与来源文件映射的集号不一致',
      };
    }
    if (
      requireMappedVideo &&
      (declaredEpisodes.size === 0 ||
        mappedEpisodes.size === 0 ||
        !sameEpisodeSet(declaredEpisodes, mappedEpisodes))
    ) {
      return {
        ok: false,
        reasonCode: 'episode-mapping-unconfirmed',
        reasonLabel: 'Task Unit 与主媒体视频映射尚未形成完整一一对应',
      };
    }
    let unitEpisodes = declaredEpisodes;
    if (unitEpisodes.size === 0) unitEpisodes = mappedEpisodes;
    if (unitEpisodes.size === 0) {
      return {
        ok: false,
        reasonCode: 'episode-evidence-missing',
        reasonLabel: '任务缺少可证明的集号声明或来源文件映射',
      };
    }
    const seasonEpisodes = episodesBySeason.get(seasonNumber) ?? new Set();
    for (const episodeNumber of unitEpisodes) {
      if (seasonEpisodes.has(episodeNumber)) {
        return {
          ok: false,
          reasonCode: 'episode-evidence-conflict',
          reasonLabel: '同一任务的多个 Unit 重复声明了相同季集',
        };
      }
      seasonEpisodes.add(episodeNumber);
    }
    episodesBySeason.set(seasonNumber, seasonEpisodes);
  }
  return {
    ok: true,
    seasons: [...episodesBySeason.entries()]
      .sort(([left], [right]) => left - right)
      .map(([seasonNumber, episodeNumbers]) => ({
        episodeNumbers: [...episodeNumbers].sort((left, right) => left - right),
        seasonNumber,
      })),
  };
}

/**
 * 把零开始的季号格式化为现有媒体治理任务使用的两位季令牌。
 * @param seasonNumber - 0–99 的 canonical 季号。
 * @returns `S00`–`S99` 季令牌。
 */
function seasonToken(seasonNumber: number): string {
  return `S${String(seasonNumber).padStart(2, '0')}`;
}

/**
 * 按目标 Work 与季令牌重算未密封 RSS Task 的输入摘要，确保后续恢复 Run 使用新的目录上下文。
 * @param task - 已通过 revision、活动 Run 和密封状态门禁的任务实体。
 * @param workId - 任务迁入的目标 Work。
 * @param targetSeasonToken - 目标 Season 的两位季令牌。
 * @returns 与任务创建入口字段顺序一致的 SHA-256 摘要。
 */
function rssContextTaskInputSnapshot(
  task: MediaGovernanceTaskEntity,
  workId: string,
  targetSeasonToken: string,
): string {
  const normalizedInput = {
    mediaType: task.mediaType,
    operationKind: task.operationKind,
    providerRef: task.providerRef,
    releaseYear: task.releaseYear,
    seasonNumbers: [targetSeasonToken],
    seriesId: task.seriesId,
    titleHint: task.titleHint,
    workId,
    workItemId: task.workItemId,
  };
  return createHash('sha256')
    .update(JSON.stringify(normalizedInput))
    .digest('hex');
}

/**
 * 把未知错误裁剪为可持久化且不泄露响应正文的单行原因。
 * @param error - RSS 拉取、解析或任务创建阶段抛出的错误。
 * @returns 最多五百字符的稳定错误摘要。
 */
function boundedError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/\s+/gu, ' ').trim().slice(0, 500);
  }
  return 'media-rss-poll-failed';
}

@Injectable()
export class MediaGovernanceCatalogService
  implements OnApplicationBootstrap, OnModuleDestroy, OnModuleInit
{
  private readonly catalogSynchronizationQueue = new Map<
    string,
    Promise<void>
  >();
  private readonly pollingSubscriptions = new Set<string>();
  private rssTimer: null | NodeJS.Timeout = null;
  private unsubscribeTaskChanged: null | (() => void) = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mediaTasks: MediaGovernanceService,
    @Optional()
    private readonly eventStream?: MediaGovernanceEventStreamService,
  ) {}

  onModuleInit() {
    this.unsubscribeTaskChanged =
      this.eventStream?.subscribeTaskChanged((event) => {
        this.handleTaskChanged(event);
      }) ?? null;
    this.rssTimer = setInterval(() => {
      void this.pollDueSubscriptions();
    }, RSS_POLL_TICK_MS);
    this.rssTimer.unref?.();
  }

  onApplicationBootstrap() {
    for (const task of this.readHistoricalTasks()) {
      if (task.metadataStatus !== 'verified') continue;
      this.queueCatalogSynchronization(task.id);
    }
  }

  onModuleDestroy() {
    this.unsubscribeTaskChanged?.();
    this.unsubscribeTaskChanged = null;
    if (this.rssTimer) clearInterval(this.rssTimer);
    this.rssTimer = null;
  }

  /**
   * 分页返回 canonical 系列及其季、集、任务和 RSS 数量。
   * @param input - 页码、页大小和可选标题/资料编号关键词。
   * @returns 系列卡片分页数据。
   */
  async page(input: MediaGovernanceSeriesPageQueryDto) {
    const pageNo = input.pageNo ?? 1;
    const pageSize = input.pageSize ?? 20;
    const repository = this.dataSource.getRepository(
      MediaGovernanceSeriesEntity,
    );
    const query = repository
      .createQueryBuilder('series')
      .orderBy('series.update_time', 'DESC')
      .skip((pageNo - 1) * pageSize)
      .take(pageSize);
    const keyword = input.keyword?.trim();
    if (keyword) {
      query.andWhere(
        '(series.title LIKE :keyword OR series.canonical_provider_id LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }
    const [series, total] = await query.getManyAndCount();
    const items = [];
    for (const item of series) {
      items.push(await this.projectSeriesCard(item));
    }
    return { items, total };
  }

  /**
   * 按 Work 类型查询可用于创建 Series 或新增 Work 的官方身份候选。
   *
   * @param input - 已校验的关键词和目标 Work 类型。
   * @returns Bangumi/TMDB 候选及各资料源状态。
   */
  async identityCandidates(
    input: MediaGovernanceCatalogIdentitySearchQueryDto,
  ) {
    return searchMediaGovernanceCatalogIdentityCandidates(
      input.keyword,
      input.workType,
    );
  }

  /**
   * 重新核验主身份，并在同一事务创建 Series、主 Work 与两级 canonical 引用。
   *
   * @param input - 用户选择的主 Work 类型和资料身份。
   * @returns 新 Series 的完整 Work-aware 详情。
   */
  async createSeries(input: MediaGovernanceSeriesCreateDto) {
    const identity = await this.verifyWorkIdentity(input);
    const releaseYear = identity.releaseYear;
    if (releaseYear === null) {
      throwVbenError('主作品身份缺少首播或上映年份', HttpStatus.CONFLICT);
    }
    const canonicalNamespace = workIdentityNamespace(
      identity.provider,
      input.workType,
    );
    const seriesId = await this.dataSource.transaction(async (manager) => {
      const seriesRepository = manager.getRepository(
        MediaGovernanceSeriesEntity,
      );
      const workRepository = manager.getRepository(MediaGovernanceWorkEntity);
      const existingSeries = await seriesRepository.findOneBy({
        canonicalNamespace,
        canonicalProvider: identity.provider,
        canonicalProviderId: identity.providerId,
      });
      if (existingSeries) {
        throwVbenError('该主身份已经建立 Series', HttpStatus.CONFLICT);
      }
      const existingWork = await workRepository.findOneBy({
        canonicalNamespace,
        canonicalProvider: identity.provider,
        canonicalProviderId: identity.providerId,
      });
      if (existingWork) {
        throwVbenError('该作品身份已经属于其他 Series', HttpStatus.CONFLICT);
      }
      const id = `media-series-${randomUUID()}`;
      const workId = `media-work-${randomUUID()}`;
      const work = workRepository.create({
        canonicalNamespace,
        canonicalProvider: identity.provider,
        canonicalProviderId: identity.providerId,
        id: workId,
        originalTitle: identity.originalTitle,
        releaseYear,
        revision: 1,
        seriesId: id,
        status: 'active',
        title: identity.title,
        workType: input.workType,
      });
      await workRepository.save(work);
      const series = seriesRepository.create({
        canonicalNamespace,
        canonicalProvider: identity.provider,
        canonicalProviderId: identity.providerId,
        id,
        mediaType: input.workType,
        originalTitle: identity.originalTitle,
        primaryWorkId: workId,
        releaseYear,
        revision: 1,
        status: 'active',
        title: identity.title,
      });
      await seriesRepository.save(series);
      await this.saveWorkReference(manager, work, identity, 'canonical');
      return id;
    });
    const detail = await this.detail(seriesId);
    await this.publishCatalogChanged(seriesId, [], 'created').catch(
      () => undefined,
    );
    return detail;
  }

  /**
   * 在事务锁内删除仅含 Work 与资料引用的 Series 空壳，任何季、集、Task、绑定或 RSS 事实都会失败关闭。
   *
   * @param seriesId - 待删除的 canonical Series 标识。
   * @param expectedRevision - 调用方读取到的 Series revision，用于拒绝过期删除。
   * @returns 被删除 Series 的稳定身份与递增 revision。
   */
  async deleteEmptySeries(seriesId: string, expectedRevision: number) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throwVbenError('Series revision 无效', HttpStatus.BAD_REQUEST);
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const seriesRows = (await manager.query(
        `
          SELECT id, revision
          FROM media_governance_series
          WHERE id = ?
          FOR UPDATE
        `,
        [seriesId],
      )) as Array<{ id: string; revision: number }>;
      if (seriesRows.length === 0) {
        throwVbenError('canonical Series 不存在', HttpStatus.NOT_FOUND);
      }
      const series = seriesRows[0];
      if (Number(series.revision) !== expectedRevision) {
        throwVbenError('Series 已更新，请刷新后重试', HttpStatus.CONFLICT);
      }

      const works = (await manager.query(
        `
          SELECT id
          FROM media_governance_work
          WHERE series_id = ?
          FOR UPDATE
        `,
        [seriesId],
      )) as Array<{ id: string }>;
      const workIds = works.map((work) => work.id);
      const directTasks = (await manager.query(
        `
          SELECT id
          FROM media_governance_task
          WHERE series_id = ?
          FOR UPDATE
        `,
        [seriesId],
      )) as Array<{ id: string }>;
      let workTasks: Array<{ id: string }> = [];
      let workReferences: Array<{ id: string }> = [];
      let workSeasons: Array<{ id: string }> = [];
      if (workIds.length > 0) {
        const placeholders = workIds.map(() => '?').join(', ');
        workTasks = (await manager.query(
          `
            SELECT id
            FROM media_governance_task
            WHERE work_id IN (${placeholders})
            FOR UPDATE
          `,
          workIds,
        )) as Array<{ id: string }>;
        workReferences = (await manager.query(
          `
            SELECT id
            FROM media_governance_work_external_ref
            WHERE work_id IN (${placeholders})
            FOR UPDATE
          `,
          workIds,
        )) as Array<{ id: string }>;
        workSeasons = (await manager.query(
          `
            SELECT id
            FROM media_governance_season
            WHERE work_id IN (${placeholders})
            FOR UPDATE
          `,
          workIds,
        )) as Array<{ id: string }>;
      }
      const seriesReferences = (await manager.query(
        `
          SELECT id
          FROM media_governance_series_external_ref
          WHERE series_id = ?
          FOR UPDATE
        `,
        [seriesId],
      )) as Array<{ id: string }>;
      const seasons = (await manager.query(
        `
          SELECT id
          FROM media_governance_season
          WHERE series_id = ?
          FOR UPDATE
        `,
        [seriesId],
      )) as Array<{ id: string }>;
      const episodes = (await manager.query(
        `
          SELECT id
          FROM media_governance_episode
          WHERE series_id = ?
          FOR UPDATE
        `,
        [seriesId],
      )) as Array<{ id: string }>;
      const bindings = (await manager.query(
        `
          SELECT id
          FROM media_governance_task_episode_binding
          WHERE series_id = ?
          FOR UPDATE
        `,
        [seriesId],
      )) as Array<{ id: string }>;
      const subscriptions = (await manager.query(
        `
          SELECT id
          FROM media_governance_rss_subscription
          WHERE series_id = ?
          FOR UPDATE
        `,
        [seriesId],
      )) as Array<{ id: string }>;

      const blockers: string[] = [];
      if (directTasks.length > 0 || workTasks.length > 0) {
        blockers.push('Task');
      }
      if (
        seasons.length > 0 ||
        workSeasons.length > 0 ||
        episodes.length > 0 ||
        bindings.length > 0
      ) {
        blockers.push('Season/Episode');
      }
      if (subscriptions.length > 0) blockers.push('RSS');
      if (blockers.length > 0) {
        throwVbenError(
          `Series 不是空壳，仍有关联 ${blockers.join('、')}`,
          HttpStatus.CONFLICT,
        );
      }

      if (workReferences.length > 0) {
        await manager.query(
          `DELETE FROM media_governance_work_external_ref WHERE id IN (${workReferences.map(() => '?').join(', ')})`,
          workReferences.map((reference) => reference.id),
        );
      }
      if (seriesReferences.length > 0) {
        await manager.query(
          `DELETE FROM media_governance_series_external_ref WHERE id IN (${seriesReferences.map(() => '?').join(', ')})`,
          seriesReferences.map((reference) => reference.id),
        );
      }
      if (workIds.length > 0) {
        await manager.query(
          `DELETE FROM media_governance_work WHERE id IN (${workIds.map(() => '?').join(', ')})`,
          workIds,
        );
      }
      await manager.query(
        'DELETE FROM media_governance_series WHERE id = ? AND revision = ?',
        [seriesId, expectedRevision],
      );
      return {
        deleted: true as const,
        revision: expectedRevision + 1,
        seriesId,
      };
    });
    this.publishCatalogDeleted(result.seriesId, result.revision);
    return result;
  }

  /**
   * 在既有 Series 下创建一个独立已核验 Work，并绑定精确同身份的遗留 Task。
   *
   * @param seriesId - 作品族 Series 标识。
   * @param input - 新 Work 类型与官方资料身份。
   * @returns 新增后的完整 Series 详情。
   */
  async createWork(seriesId: string, input: MediaGovernanceWorkCreateDto) {
    await this.requireSeries(seriesId);
    const identity = await this.verifyWorkIdentity(input);
    const releaseYear = identity.releaseYear;
    if (releaseYear === null) {
      throwVbenError('作品身份缺少首播或上映年份', HttpStatus.CONFLICT);
    }
    const canonicalNamespace = workIdentityNamespace(
      identity.provider,
      input.workType,
    );
    const work = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(MediaGovernanceWorkEntity);
      const existing = await repository.findOneBy({
        canonicalNamespace,
        canonicalProvider: identity.provider,
        canonicalProviderId: identity.providerId,
      });
      if (existing) {
        if (
          existing.seriesId !== seriesId ||
          existing.workType !== input.workType
        ) {
          throwVbenError('该作品身份已经属于一个 Series', HttpStatus.CONFLICT);
        }
        await this.saveWorkReference(manager, existing, identity, 'canonical');
        return existing;
      }
      const created = repository.create({
        canonicalNamespace,
        canonicalProvider: identity.provider,
        canonicalProviderId: identity.providerId,
        id: `media-work-${randomUUID()}`,
        originalTitle: identity.originalTitle,
        releaseYear,
        revision: 1,
        seriesId,
        status: 'active',
        title: identity.title,
        workType: input.workType,
      });
      await repository.save(created);
      await this.saveWorkReference(manager, created, identity, 'canonical');
      return created;
    });
    await this.bindExactLegacyTasksToWork(work);
    await this.publishCatalogChanged(seriesId, [], 'updated').catch(
      () => undefined,
    );
    return this.detail(seriesId);
  }

  /**
   * 在 episodic TV Work 下创建连续 Season/Episode，独立作品固定拒绝伪季。
   *
   * @param seriesId - Work 所属 Series 标识。
   * @param workId - 目标 TV Work 标识。
   * @param input - 季号、连续集范围、标题和年份。
   * @returns 创建后的完整 Series 详情。
   */
  async createSeason(
    seriesId: string,
    workId: string,
    input: MediaGovernanceSeriesSeasonFactDto,
  ) {
    const work = await this.requireWork(seriesId, workId);
    if (work.workType !== 'tv') {
      throwVbenError('电影或剧场版 Work 不能创建 Season', HttpStatus.CONFLICT);
    }
    await this.dataSource.transaction(async (manager) => {
      const seasonRepository = manager.getRepository(
        MediaGovernanceSeasonEntity,
      );
      const existing = await seasonRepository.findOneBy({
        seasonNumber: input.seasonNumber,
        workId,
      });
      if (existing) {
        throwVbenError('当前 Work 已存在相同季号', HttpStatus.CONFLICT);
      }
      const episodeStart = input.episodeStart ?? 1;
      const season = seasonRepository.create({
        episodeCount: input.episodeCount,
        episodeStart,
        id: `media-season-${randomUUID()}`,
        releaseYear: input.releaseYear ?? null,
        seasonNumber: input.seasonNumber,
        seriesId,
        status: 'known',
        title: input.title.trim(),
        workId,
      });
      await seasonRepository.save(season);
      const episodeRepository = manager.getRepository(
        MediaGovernanceEpisodeEntity,
      );
      const episodes = [];
      for (
        let episodeNumber = episodeStart;
        episodeNumber < episodeStart + input.episodeCount;
        episodeNumber += 1
      ) {
        episodes.push(
          episodeRepository.create({
            episodeNumber,
            id: `media-episode-${randomUUID()}`,
            seasonId: season.id,
            seasonNumber: season.seasonNumber,
            seriesId,
            status: 'known',
            title: null,
          }),
        );
      }
      await episodeRepository.save(episodes);
    });
    await this.publishCatalogChanged(seriesId, [], 'updated').catch(
      () => undefined,
    );
    return this.detail(seriesId);
  }

  /**
   * 从既有 Work 派生不可变身份快照并创建一次 source-intake 执行 Task。
   *
   * @param seriesId - Task 所属 Series 标识。
   * @param workId - Task 所属 Work 标识。
   * @param input - TV Work 的可选既有季号集合。
   * @returns 新建的 Work-scoped Task。
   */
  async createWorkTask(
    seriesId: string,
    workId: string,
    input: MediaGovernanceWorkTaskCreateDto,
  ) {
    const work = await this.requireWork(seriesId, workId);
    const seasonNumbers = [...new Set(input.seasonNumbers ?? [])].sort(
      (left, right) => left - right,
    );
    if (work.workType === 'tv' && seasonNumbers.length === 0) {
      throwVbenError('TV Work 必须选择至少一季', HttpStatus.BAD_REQUEST);
    }
    if (work.workType !== 'tv' && seasonNumbers.length > 0) {
      throwVbenError('独立 Work 不能声明 Season', HttpStatus.BAD_REQUEST);
    }
    if (seasonNumbers.length > 0) {
      const seasons = await this.dataSource
        .getRepository(MediaGovernanceSeasonEntity)
        .findBy({ seasonNumber: In(seasonNumbers), workId });
      if (seasons.length !== seasonNumbers.length) {
        throwVbenError('Task 选择了不存在的 Work Season', HttpStatus.CONFLICT);
      }
    }
    const createTask = () =>
      this.mediaTasks.create({
        mediaType: work.workType as MediaGovernanceMediaType,
        metadataIdentity: this.workMetadataIdentity(work),
        operationKind: 'source-intake',
        providerRef: {
          provider: work.canonicalProvider as MediaGovernanceProvider,
          providerId: work.canonicalProviderId,
        },
        releaseYear: work.releaseYear,
        seasonNumbers: seasonNumbers.map((season) => seasonToken(season)),
        seriesId,
        titleHint: work.title,
        workId,
      });
    let task: MediaGovernanceTask;
    if (work.workType === 'tv') {
      task = await createTask();
    } else {
      task = await this.createMovieWorkTaskWithSlotLock(
        seriesId,
        work,
        createTask,
      );
    }
    await this.publishCatalogChanged(seriesId, [task.id], 'updated').catch(
      () => undefined,
    );
    return task;
  }

  /**
   * 锁定非 TV Work 并拒绝第二个未闭环 Task，使一个闭环规范版本最多对应一个在途升级候选。
   * @param seriesId - 当前 Work 必须所属的 Series 标识。
   * @param work - 已完成外层身份核验的电影或剧场版 Work。
   * @param createTask - 在 Work 行锁持有期间创建唯一候选 Task 的回调。
   * @returns 首个 Task 或唯一升级候选 Task。
   * @throws 当 Work 身份漂移、已有未闭环候选或闭环规范 Task 不唯一时拒绝创建。
   */
  private async createMovieWorkTaskWithSlotLock<T extends { id: string }>(
    seriesId: string,
    work: MediaGovernanceWorkEntity,
    createTask: () => Promise<T>,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const lockedWork = await manager
        .getRepository(MediaGovernanceWorkEntity)
        .findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id: work.id },
        });
      if (
        !lockedWork ||
        lockedWork.seriesId !== seriesId ||
        lockedWork.workType !== work.workType ||
        lockedWork.workType === 'tv'
      ) {
        throwVbenError('Work 身份已变化，请刷新后重试', HttpStatus.CONFLICT);
      }
      const existingTasks = await manager
        .getRepository(MediaGovernanceTaskEntity)
        .find({ where: { workId: work.id } });
      const openTasks = existingTasks.filter(
        (candidate) => candidate.closedAt === null,
      );
      const closedTasks = existingTasks.filter(
        (candidate) => candidate.closedAt !== null,
      );
      if (openTasks.length > 0) {
        throwVbenError(
          '当前 Work 已有未闭环 Task，请先完成或清理后再升级',
          HttpStatus.CONFLICT,
        );
      }
      if (closedTasks.length > 1) {
        throwVbenError(
          '当前 Work 存在多个历史规范 Task，需先完成变体恢复',
          HttpStatus.CONFLICT,
        );
      }
      return createTask();
    });
  }

  /**
   * 从已核验 Work 提取可直接密封的 TMDB 二级元数据身份，其他资料源继续由飞牛唯一身份发现。
   * @param work - 已通过 Series/Work 创建门禁并保存 canonical 身份的作品。
   * @returns TMDB Work 对应的二级身份；非 TMDB Work 返回 `null`。
   */
  private workMetadataIdentity(
    work: MediaGovernanceWorkEntity,
  ): MediaGovernanceTask['metadataIdentity'] {
    if (work.canonicalProvider !== 'tmdb') return null;
    return {
      provider: 'tmdb',
      providerId: work.canonicalProviderId,
      providerTitle: work.title,
      releaseYear: work.releaseYear,
    };
  }

  /**
   * 只读核对全部历史任务的系列归类状态，并为可安全归类项返回现有 reconcile 所需的精确季集范围。
   * @returns 覆盖全部历史任务的分类计数、确定性原因与可归类目标。
   */
  async historyClassification() {
    const tasks = this.readHistoricalTasks();
    const scope = await this.loadHistoricalClassificationScope();
    const items = tasks.map((task) => this.classifyHistoricalTask(task, scope));
    let classifiable = 0;
    let classified = 0;
    let notApplicable = 0;
    let pending = 0;
    for (const item of items) {
      if (item.status === 'classifiable') classifiable += 1;
      if (item.status === 'classified') classified += 1;
      if (item.status === 'not-applicable') notApplicable += 1;
      if (item.status === 'pending') pending += 1;
    }
    return {
      items,
      summary: {
        classifiable,
        classified,
        notApplicable,
        pending,
        total: items.length,
      },
    };
  }

  /**
   * 返回系列、外部资料引用、季摘要、任务覆盖和 RSS 订阅的完整事实投影。
   * @param seriesId - canonical 系列标识。
   * @returns 系列详情。
   */
  async detail(seriesId: string) {
    const series = await this.requireSeries(seriesId);
    const seasonRepository = this.dataSource.getRepository(
      MediaGovernanceSeasonEntity,
    );
    const referenceRepository = this.dataSource.getRepository(
      MediaGovernanceSeriesExternalRefEntity,
    );
    const bindingRepository = this.dataSource.getRepository(
      MediaGovernanceTaskEpisodeBindingEntity,
    );
    const episodeRepository = this.dataSource.getRepository(
      MediaGovernanceEpisodeEntity,
    );
    const subscriptionRepository = this.dataSource.getRepository(
      MediaGovernanceRssSubscriptionEntity,
    );
    const workRepository = this.dataSource.getRepository(
      MediaGovernanceWorkEntity,
    );
    const workReferenceRepository = this.dataSource.getRepository(
      MediaGovernanceWorkExternalRefEntity,
    );
    const [
      works,
      workReferences,
      seasons,
      references,
      bindings,
      subscriptions,
    ] = await Promise.all([
      workRepository.find({
        order: { createTime: 'ASC' },
        where: { seriesId },
      }),
      workReferenceRepository.find({ order: { provider: 'ASC' } }),
      seasonRepository.find({
        order: { seasonNumber: 'ASC' },
        where: { seriesId },
      }),
      referenceRepository.find({
        order: { provider: 'ASC', providerId: 'ASC' },
        where: { seriesId },
      }),
      bindingRepository.find({
        order: { taskId: 'ASC' },
        where: { seriesId },
      }),
      subscriptionRepository.find({
        order: { createTime: 'DESC' },
        where: { seriesId },
      }),
    ]);
    const seriesWorkIds = new Set(works.map((work) => work.id));
    const scopedWorkReferences = workReferences.filter((reference) =>
      seriesWorkIds.has(reference.workId),
    );
    const scopedTasks = this.readHistoricalTasks().filter(
      (task) => task.seriesId === seriesId,
    );
    const episodeIds = bindings.map((binding) => binding.episodeId);
    const episodes = new Map<string, MediaGovernanceEpisodeEntity>();
    if (episodeIds.length > 0) {
      const rows = await episodeRepository.findBy({ id: In(episodeIds) });
      for (const episode of rows) episodes.set(episode.id, episode);
    }
    const taskGroups = new Map<
      string,
      {
        bindingRole: string;
        episodesBySeason: Map<number, number[]>;
        operationKind: MediaGovernanceTask['operationKind'];
        taskId: string;
        workId: null | string;
      }
    >();
    for (const task of scopedTasks) {
      taskGroups.set(task.id, {
        bindingRole: 'work-execution',
        episodesBySeason: new Map<number, number[]>(),
        operationKind: task.operationKind,
        taskId: task.id,
        workId: task.workId,
      });
    }
    for (const binding of bindings) {
      const episode = episodes.get(binding.episodeId);
      if (!episode) continue;
      let group = taskGroups.get(binding.taskId);
      if (!group) {
        group = {
          bindingRole: binding.bindingRole,
          episodesBySeason: new Map<number, number[]>(),
          operationKind: null,
          taskId: binding.taskId,
          workId: null,
        };
        taskGroups.set(binding.taskId, group);
      }
      if (!group.workId) {
        const season = seasons.find((item) => item.id === episode.seasonId);
        group.workId = season?.workId ?? null;
      }
      const values = group.episodesBySeason.get(episode.seasonNumber) ?? [];
      values.push(episode.episodeNumber);
      group.episodesBySeason.set(episode.seasonNumber, values);
    }
    const taskBindings = [...taskGroups.values()].map((group) => ({
      bindingRole: group.bindingRole,
      operationKind: group.operationKind,
      seasons: [...group.episodesBySeason.entries()]
        .sort(([left], [right]) => left - right)
        .map(([seasonNumber, values]) => ({
          episodeRanges: compressEpisodeRanges(values),
          seasonNumber,
        })),
      taskId: group.taskId,
      workId: group.workId,
    }));
    const seasonCards = [];
    for (const season of seasons) {
      seasonCards.push(await this.projectSeasonCard(season));
    }
    const seasonNumbers = new Map(
      seasons.map((season) => [season.id, season.seasonNumber]),
    );
    const rssSubscriptions = subscriptions.map((subscription) => {
      const seasonNumber = seasonNumbers.get(subscription.seasonId);
      if (seasonNumber === undefined) {
        throwVbenError('RSS 订阅季身份已失效', HttpStatus.CONFLICT);
      }
      return { ...subscription, seasonNumber };
    });
    const workCards = works.map((work) => {
      const workSeasons = seasonCards.filter(
        (season) => season.workId === work.id,
      );
      const workTasks = scopedTasks.filter((task) => task.workId === work.id);
      return {
        ...work,
        isPrimary: series.primaryWorkId === work.id,
        references: scopedWorkReferences.filter(
          (reference) => reference.workId === work.id,
        ),
        seasonCount: workSeasons.length,
        seasons: workSeasons,
        taskCount: workTasks.length,
      };
    });
    return {
      references,
      rssSubscriptions,
      seasons: seasonCards,
      series,
      taskBindings,
      works: workCards,
    };
  }

  /**
   * 分页返回一季的 canonical Episode，并附带每集当前 Task/来源绑定。
   * @param seriesId - canonical 系列标识。
   * @param workId - Season 所属 Work 标识。
   * @param seasonNumber - canonical 季号。
   * @param input - 集列表分页参数。
   * @returns 集分页。
   */
  async episodePage(
    seriesId: string,
    workId: string,
    seasonNumber: number,
    input: MediaGovernanceEpisodePageQueryDto,
  ) {
    const season = await this.requireSeason(seriesId, workId, seasonNumber);
    const pageNo = input.pageNo ?? 1;
    const pageSize = input.pageSize ?? 50;
    const episodeRepository = this.dataSource.getRepository(
      MediaGovernanceEpisodeEntity,
    );
    const [episodes, total] = await episodeRepository.findAndCount({
      order: { episodeNumber: 'ASC' },
      skip: (pageNo - 1) * pageSize,
      take: pageSize,
      where: { seasonId: season.id },
    });
    const bindings = await this.dataSource
      .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
      .findBy({ episodeId: In(episodes.map((episode) => episode.id)) });
    const bindingsByEpisode = new Map<
      string,
      MediaGovernanceTaskEpisodeBindingEntity[]
    >();
    for (const binding of bindings) {
      const values = bindingsByEpisode.get(binding.episodeId) ?? [];
      values.push(binding);
      bindingsByEpisode.set(binding.episodeId, values);
    }
    return {
      items: episodes.map((episode) => ({
        ...episode,
        bindings: bindingsByEpisode.get(episode.id) ?? [],
      })),
      total,
    };
  }

  /**
   * 先核对每个 Task 的元数据主身份，再在一个事务内替换系列真相、完整季集和 Task 集范围。
   * @param input - canonical 身份、季事实、外部引用和任务覆盖范围。
   * @returns 写入后的系列详情。
   */
  async reconcile(input: MediaGovernanceSeriesReconcileDto) {
    this.assertReconcileInput(input);
    const existingSeries = await this.dataSource
      .getRepository(MediaGovernanceSeriesEntity)
      .findOneBy({
        canonicalNamespace: workIdentityNamespace(
          input.canonicalProviderRef.provider,
          'tv',
        ),
        canonicalProvider: input.canonicalProviderRef.provider,
        canonicalProviderId: input.canonicalProviderRef.providerId.trim(),
      });
    const acceptedTaskIdentities = new Set([
      historicalIdentityKey(
        input.canonicalProviderRef.provider,
        input.canonicalProviderRef.providerId,
      ),
      ...(input.externalRefs ?? []).map((reference) =>
        historicalIdentityKey(
          reference.providerRef.provider,
          reference.providerRef.providerId,
        ),
      ),
    ]);
    const taskIds = [
      ...new Set((input.taskBindings ?? []).map((item) => item.taskId)),
    ];
    for (const taskId of taskIds) {
      const task = this.mediaTasks.detail(taskId);
      const metadataIdentity = task.metadataIdentity;
      if (
        task.mediaType !== 'tv' ||
        task.metadataStatus !== 'verified' ||
        !metadataIdentity ||
        !acceptedTaskIdentities.has(
          historicalIdentityKey(
            metadataIdentity.provider,
            metadataIdentity.providerId,
          ),
        )
      ) {
        throwVbenError(
          `任务 ${taskId} 的元数据身份与 canonical Series 不一致`,
          HttpStatus.CONFLICT,
        );
      }
    }
    const seriesId = await this.dataSource.transaction(async (manager) => {
      const series = await this.upsertSeries(manager, input);
      await this.upsertSeriesReferences(manager, series, input);
      const work = await this.ensurePrimaryWork(manager, series, input);
      const seasons = await this.upsertSeasons(manager, series, work, input);
      await this.replaceTaskBindings(manager, series, seasons, input);
      return series.id;
    });
    const detail = await this.detail(seriesId);
    let changeType: 'created' | 'updated' = 'created';
    if (existingSeries) changeType = 'updated';
    await this.publishCatalogChanged(seriesId, taskIds, changeType).catch(
      () => undefined,
    );
    return detail;
  }

  /**
   * 在一季内创建一个执行 Task，并按集写入最多十六条独立主媒体磁链来源。
   * @param seriesId - canonical 系列标识。
   * @param workId - Season 所属 Work 标识。
   * @param seasonNumber - canonical 季号。
   * @param input - 统一内容类型、发布组和按集磁链。
   * @returns 新 Task、来源与集绑定。
   */
  async createMagnetBatch(
    seriesId: string,
    workId: string,
    seasonNumber: number,
    input: MediaGovernanceMagnetBatchCreateDto,
  ) {
    return this.createMagnetBatchWithRole(
      seriesId,
      workId,
      seasonNumber,
      input,
      'pending-source',
    );
  }

  /**
   * 按用户搜索框文本并行返回 Bangumi 与 TMDB 的 TV 身份候选。
   *
   * @param input - 已通过 DTO 边界校验的身份搜索关键词。
   * @returns 有界身份候选及资料源独立可用状态。
   */
  async rssIdentityCandidates(input: MediaGovernanceRssIdentitySearchQueryDto) {
    return searchMediaGovernanceRssIdentityCandidates(input.keyword);
  }

  /**
   * 重新核验用户选择的身份，并在当前 Series/Season 上下文中按发布组聚合固定来源。
   *
   * @param seriesId - 当前 canonical Series 标识。
   * @param workId - 当前 canonical Work 标识。
   * @param seasonNumber - 当前 canonical Season 号。
   * @param input - 用户明确选择的资料源、编号和可选年份。
   * @returns 跨站去重的发布组、订阅入口与逐源状态。
   */
  async discoverRssSources(
    seriesId: string,
    workId: string,
    seasonNumber: number,
    input: MediaGovernanceRssDiscoverySearchDto,
  ) {
    const work = await this.requireWork(seriesId, workId);
    await this.requireSeason(seriesId, workId, seasonNumber);
    let releaseYear: null | number = work.releaseYear;
    if (input.releaseYear !== undefined) releaseYear = input.releaseYear;
    try {
      return await discoverMediaGovernanceRssSources({
        identity: {
          provider: input.provider,
          providerId: input.providerId,
          releaseYear,
        },
        originalTitle: work.originalTitle,
        releaseYear: work.releaseYear,
        seasonNumber,
        seriesTitle: work.title,
      });
    } catch {
      throwVbenError('所选资料身份无法重新核验', HttpStatus.CONFLICT);
    }
  }

  /**
   * 为系列的一季创建 RSS 订阅，并密封过滤与集号解析正则。
   * @param seriesId - canonical 系列标识。
   * @param workId - Season 所属 Work 标识。
   * @param seasonNumber - canonical 季号。
   * @param input - 订阅地址、过滤、内容类型与轮询周期。
   * @returns 新订阅。
   */
  async createRssSubscription(
    seriesId: string,
    workId: string,
    seasonNumber: number,
    input: MediaGovernanceRssSubscriptionCreateDto,
  ) {
    const work = await this.requireWork(seriesId, workId);
    const season = await this.requireSeason(seriesId, workId, seasonNumber);
    this.assertRssUrl(input.feedUrl);
    this.assertPattern(input.includePattern);
    this.assertPattern(input.episodePattern);
    const identity = await this.verifyRssSubscriptionIdentity(
      work,
      season,
      input.identity,
    );
    const normalizedUrl = new URL(input.feedUrl).href;
    const feedUrlSha256 = createHash('sha256')
      .update(normalizedUrl)
      .digest('hex');
    const saved = await this.dataSource.transaction(async (manager) => {
      let referenceRole: 'canonical' | 'catalog-evidence' = 'catalog-evidence';
      if (
        identity.provider === work.canonicalProvider &&
        identity.providerId === work.canonicalProviderId
      ) {
        referenceRole = 'canonical';
      }
      await this.saveWorkReference(manager, work, identity, referenceRole);
      await this.saveSeriesReference(
        manager,
        seriesId,
        identity,
        referenceRole,
      );
      const repository = manager.getRepository(
        MediaGovernanceRssSubscriptionEntity,
      );
      const duplicate = await repository.findOneBy({
        feedUrlSha256,
        seriesId,
      });
      if (duplicate && duplicate.seasonId !== season.id) {
        throwVbenError('该 RSS 地址已绑定系列的其他季', HttpStatus.CONFLICT);
      }
      if (duplicate) {
        const identityChanged =
          duplicate.identityProvider !== identity.provider ||
          duplicate.identityProviderId !== identity.providerId ||
          duplicate.identityTitle !== identity.title ||
          duplicate.identityReleaseYear !== identity.releaseYear;
        if (!identityChanged) return duplicate;
        duplicate.identityProvider = identity.provider;
        duplicate.identityProviderId = identity.providerId;
        duplicate.identityTitle = identity.title;
        duplicate.identityReleaseYear = identity.releaseYear;
        duplicate.revision += 1;
        return repository.save(duplicate);
      }
      const now = new Date();
      const subscription = repository.create({
        contentKind: input.contentKind,
        enabled: true,
        episodePattern: input.episodePattern?.trim() || null,
        feedUrl: normalizedUrl,
        feedUrlSha256,
        id: `media-rss-subscription-${randomUUID()}`,
        identityProvider: identity.provider,
        identityProviderId: identity.providerId,
        identityReleaseYear: identity.releaseYear,
        identityTitle: identity.title,
        includePattern: input.includePattern?.trim() || null,
        lastError: null,
        lastPolledAt: null,
        name: input.name.trim(),
        nextPollAt: toKtDateTime(now),
        pollIntervalMinutes: input.pollIntervalMinutes ?? 15,
        releaseGroup: input.releaseGroup?.trim() || null,
        revision: 1,
        seasonId: season.id,
        seriesId,
        status: 'idle',
      });
      return repository.save(subscription);
    });
    await this.publishCatalogChanged(seriesId, [], 'updated').catch(
      () => undefined,
    );
    return saved;
  }

  /**
   * 在旧错误 Task 已清理后，把订阅和可重试条目整体迁入一个已核验 Work/Season。
   *
   * @param seriesId - 目标 Work 所属 Series。
   * @param workId - 目标 TV Work。
   * @param seasonNumber - 目标连续 Episode 范围。
   * @param subscriptionId - 需要纠正上下文的订阅。
   * @param input - 客户端读取的当前订阅 revision。
   * @returns 已更新上下文并安排重新轮询的订阅。
   */
  async rebindRssSubscription(
    seriesId: string,
    workId: string,
    seasonNumber: number,
    subscriptionId: string,
    input: MediaGovernanceRssSubscriptionRebindDto,
  ) {
    await this.requireWork(seriesId, workId);
    const season = await this.requireSeason(seriesId, workId, seasonNumber);
    const subscription = await this.requireSubscription(subscriptionId);
    if (subscription.seriesId !== seriesId) {
      throwVbenError('RSS 订阅不属于目标 Series', HttpStatus.CONFLICT);
    }
    if (subscription.revision !== input.expectedRevision) {
      throwVbenError(
        `订阅版本已变化，当前版本为 ${subscription.revision}`,
        HttpStatus.CONFLICT,
      );
    }
    if (subscription.status === 'polling') {
      throwVbenError('RSS 订阅正在轮询，不能迁移上下文', HttpStatus.CONFLICT);
    }
    const itemRepository = this.dataSource.getRepository(
      MediaGovernanceRssItemEntity,
    );
    const items = await itemRepository.find({ where: { subscriptionId } });
    const taskIds = new Set(
      items
        .map((item) => item.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
    );
    const existingTaskIds = new Set(
      this.readHistoricalTasks().map((task) => task.id),
    );
    if ([...taskIds].some((taskId) => existingTaskIds.has(taskId))) {
      throwVbenError(
        'RSS 订阅仍有关联 Task，请先清理错误入队任务',
        HttpStatus.CONFLICT,
      );
    }
    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        MediaGovernanceRssSubscriptionEntity,
      );
      const current = await repository.findOneBy({ id: subscriptionId });
      if (!current || current.revision !== input.expectedRevision) {
        throwVbenError('RSS 订阅版本已变化', HttpStatus.CONFLICT);
      }
      current.seasonId = season.id;
      current.revision += 1;
      current.lastError = null;
      current.nextPollAt = null;
      current.status = 'disabled';
      if (current.enabled) {
        current.nextPollAt = toKtDateTime(new Date());
        current.status = 'idle';
      }
      const currentItems = await manager
        .getRepository(MediaGovernanceRssItemEntity)
        .find({ where: { subscriptionId } });
      for (const item of currentItems) {
        item.sourceId = null;
        item.state = 'discovered';
        item.stateReason = 'RSS 上下文已纠正，等待重新入队';
        item.taskId = null;
      }
      if (currentItems.length > 0) {
        await manager
          .getRepository(MediaGovernanceRssItemEntity)
          .save(currentItems);
      }
      return repository.save(current);
    });
    await this.publishCatalogChanged(seriesId, [], 'updated').catch(
      () => undefined,
    );
    return saved;
  }

  /**
   * 把误建 Work 下的 RSS 订阅、未密封 Task、来源季号和 Episode 绑定原子迁回既有 Season，并清理空 Work。
   *
   * @param seriesId - 源 Work 与目标 Work 共同所属的 Series。
   * @param workId - 正确目标 Work。
   * @param seasonNumber - 正确目标 Season 号。
   * @param subscriptionId - 需要保留历史条目与来源的 RSS 订阅。
   * @param input - 源 Work、订阅 revision、精确 Task revision 和已核验 RSS 身份。
   * @returns 已迁移 Task、订阅、目标目录和被清理 Work 的精确标识。
   */
  async repairRssSubscriptionContext(
    seriesId: string,
    workId: string,
    seasonNumber: number,
    subscriptionId: string,
    input: MediaGovernanceRssContextRepairDto,
  ) {
    const targetWork = await this.requireWork(seriesId, workId);
    const targetSeason = await this.requireSeason(
      seriesId,
      workId,
      seasonNumber,
    );
    const identity = await this.verifyRssSubscriptionIdentity(
      targetWork,
      targetSeason,
      input.identity,
    );
    const expectedTaskRevisions = new Map(
      input.tasks.map((task) => [task.taskId, task.expectedRevision]),
    );
    if (expectedTaskRevisions.size !== input.tasks.length) {
      throwVbenError('RSS 上下文修复 Task 不能重复', HttpStatus.BAD_REQUEST);
    }
    const targetSeasonToken = seasonToken(seasonNumber);
    const result = await this.dataSource.transaction(async (manager) => {
      const subscriptionRepository = manager.getRepository(
        MediaGovernanceRssSubscriptionEntity,
      );
      const seasonRepository = manager.getRepository(
        MediaGovernanceSeasonEntity,
      );
      const workRepository = manager.getRepository(MediaGovernanceWorkEntity);
      const taskRepository = manager.getRepository(MediaGovernanceTaskEntity);
      const unitRepository = manager.getRepository(MediaGovernanceUnitEntity);
      const sourceRepository = manager.getRepository(
        MediaGovernanceSourceEntity,
      );
      const episodeRepository = manager.getRepository(
        MediaGovernanceEpisodeEntity,
      );
      const bindingRepository = manager.getRepository(
        MediaGovernanceTaskEpisodeBindingEntity,
      );
      const referenceRepository = manager.getRepository(
        MediaGovernanceWorkExternalRefEntity,
      );

      const subscription = await subscriptionRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: subscriptionId },
      });
      if (!subscription || subscription.seriesId !== seriesId) {
        throwVbenError('RSS 订阅不属于目标 Series', HttpStatus.CONFLICT);
      }
      if (subscription.revision !== input.expectedRevision) {
        throwVbenError(
          `订阅版本已变化，当前版本为 ${subscription.revision}`,
          HttpStatus.CONFLICT,
        );
      }
      if (subscription.status === 'polling') {
        throwVbenError('RSS 订阅正在轮询，不能修复上下文', HttpStatus.CONFLICT);
      }
      const sourceSeason = await seasonRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: subscription.seasonId },
      });
      if (
        !sourceSeason ||
        sourceSeason.seriesId !== seriesId ||
        sourceSeason.workId !== input.sourceWorkId ||
        sourceSeason.id === targetSeason.id
      ) {
        throwVbenError('RSS 源 Work/Season 身份已变化', HttpStatus.CONFLICT);
      }
      const sourceWork = await workRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: input.sourceWorkId, seriesId },
      });
      const series = await manager
        .getRepository(MediaGovernanceSeriesEntity)
        .findOneBy({ id: seriesId });
      if (
        !sourceWork ||
        !series ||
        sourceWork.id === targetWork.id ||
        series.primaryWorkId === sourceWork.id
      ) {
        throwVbenError('RSS 源 Work 不能合并', HttpStatus.CONFLICT);
      }
      const sourceSeasons = await seasonRepository.findBy({
        workId: sourceWork.id,
      });
      if (
        sourceSeasons.length !== 1 ||
        sourceSeasons[0].id !== sourceSeason.id
      ) {
        throwVbenError('RSS 源 Work 仍包含其他 Season', HttpStatus.CONFLICT);
      }

      const items = await manager
        .getRepository(MediaGovernanceRssItemEntity)
        .find({ where: { subscriptionId } });
      const linkedTaskIds = [
        ...new Set(
          items
            .map((item) => item.taskId)
            .filter((taskId): taskId is string => Boolean(taskId)),
        ),
      ].sort();
      const expectedTaskIds = [...expectedTaskRevisions.keys()].sort();
      if (
        linkedTaskIds.length !== expectedTaskIds.length ||
        linkedTaskIds.some((taskId, index) => taskId !== expectedTaskIds[index])
      ) {
        throwVbenError('RSS 关联 Task 清单已变化', HttpStatus.CONFLICT);
      }
      const sourceWorkTasks = await taskRepository.findBy({
        workId: sourceWork.id,
      });
      if (
        sourceWorkTasks.length !== linkedTaskIds.length ||
        sourceWorkTasks.some((task) => !expectedTaskRevisions.has(task.id))
      ) {
        throwVbenError('RSS 源 Work 仍包含其他 Task', HttpStatus.CONFLICT);
      }
      const tasks: MediaGovernanceTaskEntity[] = [];
      for (const taskId of linkedTaskIds) {
        const task = await taskRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id: taskId },
        });
        const expectedRevision = expectedTaskRevisions.get(taskId);
        if (!task) {
          throwVbenError(
            `RSS Task ${taskId} 不满足无损上下文修复门禁`,
            HttpStatus.CONFLICT,
          );
        }
        const contextMismatch =
          task.revision !== expectedRevision ||
          task.seriesId !== seriesId ||
          task.workId !== sourceWork.id ||
          task.operationKind !== 'rss-intake-auto';
        const executionUnsafe =
          task.activeRunId !== null ||
          !['blocked', 'draft'].includes(task.runState) ||
          !['download', 'intake'].includes(task.stage) ||
          task.closedAt !== null;
        const artifactsSealed =
          task.payloadSeal !== null ||
          task.sealedPlan !== null ||
          task.sealedPlanSha256 !== null ||
          task.metadataIdentity !== null;
        if (contextMismatch || executionUnsafe || artifactsSealed) {
          throwVbenError(
            `RSS Task ${taskId} 不满足无损上下文修复门禁`,
            HttpStatus.CONFLICT,
          );
        }
        tasks.push(task);
      }

      const sourceEpisodes = await episodeRepository.findBy({
        seasonId: sourceSeason.id,
      });
      const sourceEpisodeById = new Map(
        sourceEpisodes.map((episode) => [episode.id, episode]),
      );
      const episodeNumbers = sourceEpisodes.map(
        (episode) => episode.episodeNumber,
      );
      const targetEpisodes = await episodeRepository.findBy({
        episodeNumber: In(episodeNumbers),
        seasonId: targetSeason.id,
      });
      const targetEpisodeByNumber = new Map(
        targetEpisodes.map((episode) => [episode.episodeNumber, episode]),
      );
      if (
        sourceEpisodes.length === 0 ||
        targetEpisodes.length !== sourceEpisodes.length
      ) {
        throwVbenError('目标 Season Episode 范围不完整', HttpStatus.CONFLICT);
      }
      const bindings = await bindingRepository.findBy({
        taskId: In(linkedTaskIds),
      });
      if (
        bindings.length !== sourceEpisodes.length ||
        bindings.some(
          (binding) =>
            binding.seasonId !== sourceSeason.id ||
            !sourceEpisodeById.has(binding.episodeId),
        )
      ) {
        throwVbenError('RSS Task Episode 绑定不完整', HttpStatus.CONFLICT);
      }
      const occupiedTargetBindings = await bindingRepository.findBy({
        episodeId: In(targetEpisodes.map((episode) => episode.id)),
      });
      if (occupiedTargetBindings.length > 0) {
        throwVbenError('目标 Episode 已有其他 Task 绑定', HttpStatus.CONFLICT);
      }

      for (const task of tasks) {
        const units = await unitRepository.findBy({ taskId: task.id });
        const sources = await sourceRepository.findBy({ taskId: task.id });
        if (units.length !== 1 || sources.length === 0) {
          throwVbenError(
            'RSS Task Unit/Source 结构不完整',
            HttpStatus.CONFLICT,
          );
        }
        const unit = units[0];
        const expectedEpisodes = unit.expectedEpisodeNumbers.map((value) =>
          Number(value),
        );
        if (
          !unit.seasonNumber ||
          expectedEpisodes.some(
            (episodeNumber) => !targetEpisodeByNumber.has(episodeNumber),
          ) ||
          sources.some(
            (source) =>
              source.seasonNumbers.length !== 1 ||
              source.seasonNumbers[0] !== unit.seasonNumber,
          )
        ) {
          throwVbenError('RSS Task 季集快照不匹配', HttpStatus.CONFLICT);
        }
        unit.seasonNumber = targetSeasonToken;
        for (const source of sources) {
          source.seasonNumbers = [targetSeasonToken];
        }
        task.workId = targetWork.id;
        task.inputSnapshotSha256 = rssContextTaskInputSnapshot(
          task,
          targetWork.id,
          targetSeasonToken,
        );
        task.revision += 1;
        await taskRepository.save(task);
        await unitRepository.save(unit);
        await sourceRepository.save(sources);
      }

      for (const binding of bindings) {
        const sourceEpisode = sourceEpisodeById.get(binding.episodeId)!;
        const targetEpisode = targetEpisodeByNumber.get(
          sourceEpisode.episodeNumber,
        )!;
        targetEpisode.status = sourceEpisode.status;
        binding.episodeId = targetEpisode.id;
        binding.seasonId = targetSeason.id;
      }
      await episodeRepository.save(targetEpisodes);
      await bindingRepository.save(bindings);

      subscription.seasonId = targetSeason.id;
      subscription.identityProvider = identity.provider;
      subscription.identityProviderId = identity.providerId;
      subscription.identityReleaseYear = identity.releaseYear;
      subscription.identityTitle = identity.title;
      subscription.lastError = null;
      subscription.revision += 1;
      await subscriptionRepository.save(subscription);

      const sourceReferences = await referenceRepository.findBy({
        workId: sourceWork.id,
      });
      const selectedReference = sourceReferences.find(
        (reference) =>
          reference.provider === identity.provider &&
          reference.providerId === identity.providerId,
      );
      if (!selectedReference) {
        throwVbenError('RSS 源 Work 缺少所选身份引用', HttpStatus.CONFLICT);
      }
      for (const reference of sourceReferences) {
        const targetReference = await referenceRepository.findOneBy({
          provider: reference.provider,
          providerId: reference.providerId,
          providerNamespace: reference.providerNamespace,
          workId: targetWork.id,
        });
        if (targetReference) {
          await referenceRepository.delete({ id: reference.id });
          continue;
        }
        reference.workId = targetWork.id;
        reference.referenceRole = 'catalog-evidence';
        await referenceRepository.save(reference);
      }
      await this.saveSeriesReference(
        manager,
        seriesId,
        identity,
        'catalog-evidence',
      );

      targetWork.revision += 1;
      await workRepository.save(targetWork);
      await episodeRepository.delete({ seasonId: sourceSeason.id });
      await seasonRepository.delete({ id: sourceSeason.id });
      await workRepository.delete({ id: sourceWork.id });

      return {
        migratedTaskIds: linkedTaskIds,
        removedSeasonId: sourceSeason.id,
        removedWorkId: sourceWork.id,
        subscription,
        targetSeasonId: targetSeason.id,
        targetWorkId: targetWork.id,
      };
    });
    await this.mediaTasks.reloadCatalogRepairedTasks(result.migratedTaskIds);
    await this.publishCatalogChanged(
      seriesId,
      result.migratedTaskIds,
      'updated',
    ).catch(() => undefined);
    return {
      ...result,
      detail: await this.detail(seriesId),
    };
  }

  /**
   * 根据当前 Work/Season 重新请求官方详情，防止客户端自由文本成为资料引用证据。
   *
   * @param work - 订阅所属 canonical Work。
   * @param season - 订阅所属 canonical Season。
   * @param input - 用户明确选择的资料来源、编号和可选年份。
   * @returns 经过 Bangumi 或 TMDB 官方详情核验的身份。
   */
  private async verifyRssSubscriptionIdentity(
    work: MediaGovernanceWorkEntity,
    season: MediaGovernanceSeasonEntity,
    input: MediaGovernanceRssIdentitySelectionDto,
  ): Promise<MediaGovernanceRssIdentityCandidate> {
    let identity: MediaGovernanceRssIdentityCandidate;
    try {
      identity = await verifyMediaGovernanceRssIdentity({
        identity: {
          provider: input.provider,
          providerId: input.providerId,
          releaseYear: input.releaseYear ?? null,
        },
        originalTitle: work.originalTitle,
        releaseYear: work.releaseYear,
        seasonNumber: season.seasonNumber,
        seriesTitle: work.title,
      });
    } catch {
      throwVbenError('所选 RSS 资料身份无法重新核验', HttpStatus.CONFLICT);
    }
    return identity;
  }

  /**
   * 只接受 Work canonical 身份或已显式登记的外部引用，拒绝订阅创建顺手把另一部作品并入当前 Work。
   *
   * @param work - 订阅路径中已经选定的 Work。
   * @param identity - 官方详情重新核验后的 RSS 作品身份。
   */
  private async assertRssIdentityBelongsToWork(
    work: MediaGovernanceWorkEntity,
    identity: Pick<
      MediaGovernanceRssIdentityCandidate,
      'provider' | 'providerId'
    >,
  ): Promise<void> {
    if (
      identity.provider === work.canonicalProvider &&
      identity.providerId === work.canonicalProviderId
    ) {
      return;
    }
    const providerNamespace = workIdentityNamespace(
      identity.provider,
      work.workType as MediaGovernanceMediaType,
    );
    const reference = await this.dataSource
      .getRepository(MediaGovernanceWorkExternalRefEntity)
      .findOneBy({
        provider: identity.provider,
        providerId: identity.providerId,
        providerNamespace,
        workId: work.id,
      });
    if (!reference) {
      throwVbenError(
        '所选 RSS 身份不属于当前 Work，请先在 Series 下添加对应作品',
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * 从订阅持久化字段恢复后续 RSS Task 的精确资料身份，拒绝回退成 Work 主身份。
   * @param subscription - 已通过 Series/Season 所有权校验的订阅。
   * @returns 用于创建 Task 身份快照的 provider、标题和年份。
   */
  private rssTaskIdentity(
    subscription: MediaGovernanceRssSubscriptionEntity,
  ): RssTaskIdentity {
    if (
      !['bangumi', 'tmdb'].includes(subscription.identityProvider) ||
      !subscription.identityProviderId?.trim() ||
      !subscription.identityTitle?.trim()
    ) {
      throwVbenError('RSS 订阅缺少已核验资料身份', HttpStatus.CONFLICT);
    }
    return {
      provider: subscription.identityProvider as 'bangumi' | 'tmdb',
      providerId: subscription.identityProviderId,
      releaseYear: subscription.identityReleaseYear,
      title: subscription.identityTitle,
    };
  }

  /**
   * 按 revision 启停 RSS 订阅，并在启用时安排立即轮询。
   * @param subscriptionId - RSS 订阅标识。
   * @param input - 期望 revision 与目标启用状态。
   * @returns 更新后的订阅。
   */
  async setRssSubscriptionState(
    subscriptionId: string,
    input: MediaGovernanceRssSubscriptionStateDto,
  ) {
    const repository = this.dataSource.getRepository(
      MediaGovernanceRssSubscriptionEntity,
    );
    const subscription = await this.requireSubscription(subscriptionId);
    if (subscription.revision !== input.expectedRevision) {
      throwVbenError(
        `订阅版本已变化，当前版本为 ${subscription.revision}`,
        HttpStatus.CONFLICT,
      );
    }
    subscription.enabled = input.enabled;
    subscription.revision += 1;
    subscription.status = 'disabled';
    subscription.nextPollAt = null;
    if (input.enabled) {
      subscription.status = 'idle';
      subscription.nextPollAt = toKtDateTime(new Date());
    }
    const saved = await repository.save(subscription);
    await this.publishCatalogChanged(
      subscription.seriesId,
      [],
      'updated',
    ).catch(() => undefined);
    return saved;
  }

  /**
   * 立即拉取一个 RSS 订阅，去重条目并把新集按十六条一组创建批量 Task。
   * @param subscriptionId - RSS 订阅标识。
   * @returns 拉取、忽略和创建数量。
   */
  async pollRssSubscription(subscriptionId: string) {
    const subscription = await this.requireSubscription(subscriptionId);
    return this.pollSubscription(subscription, true);
  }

  /**
   * 分页返回订阅历史条目及其解析、忽略或 Task 入队状态。
   * @param subscriptionId - RSS 订阅标识。
   * @param input - 通用页码与页大小参数。
   * @returns RSS 条目分页。
   */
  async rssItemPage(
    subscriptionId: string,
    input: MediaGovernanceEpisodePageQueryDto,
  ) {
    await this.requireSubscription(subscriptionId);
    const pageNo = input.pageNo ?? 1;
    const pageSize = input.pageSize ?? 50;
    const [items, total] = await this.dataSource
      .getRepository(MediaGovernanceRssItemEntity)
      .findAndCount({
        order: { createTime: 'DESC' },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        where: { subscriptionId },
      });
    return { items, total };
  }

  /**
   * 通过任务服务的权威运行态投影分页读取全部任务，并克隆快照隔离后续分类计算。
   * @returns 按任务标识稳定排序的完整运行态快照。
   */
  private readHistoricalTasks(): MediaGovernanceTask[] {
    const tasks: MediaGovernanceTask[] = [];
    const pageSize = 100;
    let pageNo = 1;
    let total = 0;
    do {
      const page = this.mediaTasks.page({ pageNo, pageSize });
      total = page.total;
      tasks.push(...page.items.map((task) => structuredClone(task)));
      if (page.items.length === 0) break;
      pageNo += 1;
    } while (tasks.length < total);
    return tasks.sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * 只对完整任务事件中的已验证 TV 身份排队目录同步，进度补丁和草稿状态保持零目录写入。
   *
   * @param event - 已在任务状态仓提交并广播的任务变更事件。
   */
  private handleTaskChanged(event: MediaGovernanceTaskChangedData) {
    if (event.patchMode !== 'full') return;
    if (!event.task || event.task.metadataStatus !== 'verified') return;
    this.queueCatalogSynchronization(event.taskId);
  }

  /**
   * 按 Task ID 串行自动归类，同一任务的连续终态不会并发改写 Series revision 或绑定。
   *
   * @param taskId - 要进入自动目录同步队列的媒体任务标识。
   * @returns 当前任务本轮同步完成后的 Promise。
   */
  private queueCatalogSynchronization(taskId: string): Promise<void> {
    const previous =
      this.catalogSynchronizationQueue.get(taskId) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        await this.synchronizeVerifiedTask(taskId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.catalogSynchronizationQueue.get(taskId) === queued) {
          this.catalogSynchronizationQueue.delete(taskId);
        }
      });
    this.catalogSynchronizationQueue.set(taskId, queued);
    return queued;
  }

  /**
   * 在资料身份、来源清单与季集映射全部验证后，把一个普通 TV Task 幂等同步到唯一系列目录。
   *
   * @param taskId - 要读取权威快照并同步的媒体任务标识。
   * @returns 同步、待证据或不适用状态，以及是否产生目录变更。
   */
  async synchronizeVerifiedTask(
    taskId: string,
  ): Promise<MediaGovernanceCatalogSynchronizationResult> {
    const task = structuredClone(this.mediaTasks.detail(taskId));
    if (task.mediaType !== 'tv') {
      if (task.seriesId && task.workId) {
        return {
          changed: false,
          reasonCode: 'catalog-work-binding-existing',
          reasonLabel: '独立 Work Task 已绑定唯一 Series/Work',
          seriesId: task.seriesId,
          status: 'synchronized',
          taskId,
        };
      }
      return {
        changed: false,
        reasonCode: 'pending-series-membership',
        reasonLabel: '电影或剧场版 Task 尚未显式归入 Series Work',
        seriesId: null,
        status: 'pending',
        taskId,
      };
    }
    if (task.metadataStatus !== 'verified' || !task.metadataIdentity) {
      return {
        changed: false,
        reasonCode: 'metadata-identity-unverified',
        reasonLabel: '任务资料身份尚未完成核实',
        seriesId: null,
        status: 'pending',
        taskId,
      };
    }
    const evidence = collectTaskSeasonEvidence(task, true);
    if (evidence.ok === false) {
      return {
        changed: false,
        reasonCode: evidence.reasonCode,
        reasonLabel: evidence.reasonLabel,
        seriesId: null,
        status: 'pending',
        taskId,
      };
    }
    if (task.seriesId && task.workId) {
      return this.synchronizeWorkBoundTask(task, evidence.seasons);
    }
    if (task.seriesId || task.workId) {
      return {
        changed: false,
        reasonCode: 'catalog-work-context-incomplete',
        reasonLabel: 'Task 的 Series/Work 上下文不完整',
        seriesId: task.seriesId,
        status: 'pending',
        taskId,
      };
    }
    const scope = await this.loadHistoricalClassificationScope();
    const bindings = scope.bindingsByTask.get(task.id) ?? [];
    if (bindings.length > 0) {
      const classified = this.classifyBoundHistoricalTask(
        task,
        this.readHistoricalIdentity(task),
        bindings,
        scope,
      );
      if (classified.status !== 'classified' || !classified.target) {
        return {
          changed: false,
          reasonCode: classified.reasonCode,
          reasonLabel: classified.reasonLabel,
          seriesId: classified.target?.seriesId ?? null,
          status: 'pending',
          taskId,
        };
      }
      const changed = await this.refreshBoundTaskEpisodeStatuses(
        task,
        bindings,
      );
      if (changed) {
        await this.publishCatalogChanged(
          classified.target.seriesId,
          [task.id],
          'updated',
        );
      }
      return {
        changed,
        reasonCode: 'catalog-binding-existing',
        reasonLabel: '任务已经存在唯一且一致的 canonical Episode 绑定',
        seriesId: classified.target.seriesId,
        status: 'synchronized',
        taskId,
      };
    }
    return {
      changed: false,
      reasonCode: 'catalog-work-binding-required',
      reasonLabel: 'Task 只能绑定既有 Series Work，禁止从 Task 自动创建目录',
      seriesId: task.seriesId,
      status: 'pending',
      taskId,
    };
  }

  /**
   * 把 Work-bound TV Task 的已验证季集映射写入既有 Episode，绝不创建或猜测 Series/Work。
   * @param task - 已携带完整 Series/Work 身份且通过元数据核验的 Task。
   * @param evidence - Task Unit 与来源文件映射交叉确认后的季集集合。
   * @returns 新增或复用 Work Episode 绑定后的同步结果。
   */
  private async synchronizeWorkBoundTask(
    task: MediaGovernanceTask,
    evidence: TaskSeasonEvidence[],
  ): Promise<MediaGovernanceCatalogSynchronizationResult> {
    const seriesId = task.seriesId!;
    const workId = task.workId!;
    const work = await this.dataSource
      .getRepository(MediaGovernanceWorkEntity)
      .findOneBy({ id: workId, seriesId });
    if (!work || work.workType !== 'tv') {
      return {
        changed: false,
        reasonCode: 'catalog-work-context-invalid',
        reasonLabel: 'Task 指向的 TV Work 不存在或类型不匹配',
        seriesId,
        status: 'pending',
        taskId: task.id,
      };
    }
    const seasonNumbers = evidence.map((item) => item.seasonNumber);
    const seasons = await this.dataSource
      .getRepository(MediaGovernanceSeasonEntity)
      .findBy({ seasonNumber: In(seasonNumbers), seriesId, workId });
    if (seasons.length !== seasonNumbers.length) {
      return {
        changed: false,
        reasonCode: 'catalog-work-season-missing',
        reasonLabel: 'Task 声明的 Season 未在目标 Work 中建立',
        seriesId,
        status: 'pending',
        taskId: task.id,
      };
    }
    const seasonsByNumber = new Map(
      seasons.map((season) => [season.seasonNumber, season]),
    );
    const episodeNumbers = evidence.flatMap((item) => item.episodeNumbers);
    const episodes = await this.dataSource
      .getRepository(MediaGovernanceEpisodeEntity)
      .findBy({
        episodeNumber: In(episodeNumbers),
        seasonId: In(seasons.map((season) => season.id)),
      });
    const episodesByIdentity = new Map(
      episodes.map((episode) => [
        `${episode.seasonId}:${episode.episodeNumber}`,
        episode,
      ]),
    );
    const targetEpisodes: MediaGovernanceEpisodeEntity[] = [];
    for (const seasonEvidence of evidence) {
      const season = seasonsByNumber.get(seasonEvidence.seasonNumber)!;
      for (const episodeNumber of seasonEvidence.episodeNumbers) {
        const episode = episodesByIdentity.get(`${season.id}:${episodeNumber}`);
        if (!episode) {
          return {
            changed: false,
            reasonCode: 'catalog-work-episode-missing',
            reasonLabel: 'Task 集号在目标 Work Season 中不存在',
            seriesId,
            status: 'pending',
            taskId: task.id,
          };
        }
        targetEpisodes.push(episode);
      }
    }
    const bindingRepository = this.dataSource.getRepository(
      MediaGovernanceTaskEpisodeBindingEntity,
    );
    const existingBindings = await bindingRepository.findBy({
      episodeId: In(targetEpisodes.map((episode) => episode.id)),
    });
    if (existingBindings.some((binding) => binding.taskId !== task.id)) {
      return {
        changed: false,
        reasonCode: 'catalog-work-episode-already-bound',
        reasonLabel: '目标 Work Episode 已由其他 Task 占用',
        seriesId,
        status: 'pending',
        taskId: task.id,
      };
    }
    const boundEpisodeIds = new Set(
      existingBindings.map((binding) => binding.episodeId),
    );
    const createdBindings: MediaGovernanceTaskEpisodeBindingEntity[] = [];
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        MediaGovernanceTaskEpisodeBindingEntity,
      );
      for (const episode of targetEpisodes) {
        if (boundEpisodeIds.has(episode.id)) continue;
        createdBindings.push(
          repository.create({
            bindingRole: 'work-execution',
            episodeId: episode.id,
            id: `media-task-episode-${randomUUID()}`,
            seasonId: episode.seasonId,
            seriesId,
            sourceId: null,
            taskId: task.id,
          }),
        );
      }
      if (createdBindings.length > 0) {
        await repository.save(createdBindings);
      }
    });
    const bindings = [...existingBindings, ...createdBindings];
    const statusChanged = await this.refreshBoundTaskEpisodeStatuses(
      task,
      bindings,
    );
    const changed = createdBindings.length > 0 || statusChanged;
    if (changed) {
      await this.publishCatalogChanged(seriesId, [task.id], 'updated');
    }
    let reasonCode = 'catalog-work-binding-existing';
    let reasonLabel = 'Task 已存在完整 Work Episode 绑定';
    if (createdBindings.length > 0) {
      reasonCode = 'catalog-work-binding-created';
      reasonLabel = 'Task 已绑定到既有 Work Episode';
    }
    return {
      changed,
      reasonCode,
      reasonLabel,
      seriesId,
      status: 'synchronized',
      taskId: task.id,
    };
  }

  /**
   * 一次读取目录分类所需全部 Series、引用、Season、Episode 和 Task Binding 索引。
   *
   * @returns 可供历史分类与自动同步共享的不可变索引。
   */
  private async loadHistoricalClassificationScope(): Promise<HistoricalClassificationScope> {
    const [series, references, seasons, episodes, bindings] = await Promise.all(
      [
        this.dataSource
          .getRepository(MediaGovernanceSeriesEntity)
          .find({ order: { id: 'ASC' } }),
        this.dataSource
          .getRepository(MediaGovernanceSeriesExternalRefEntity)
          .find({ order: { id: 'ASC' } }),
        this.dataSource
          .getRepository(MediaGovernanceSeasonEntity)
          .find({ order: { id: 'ASC' } }),
        this.dataSource
          .getRepository(MediaGovernanceEpisodeEntity)
          .find({ order: { id: 'ASC' } }),
        this.dataSource
          .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
          .find({ order: { id: 'ASC' } }),
      ],
    );
    const seriesById = new Map(series.map((item) => [item.id, item]));
    const identityTargets = new Map<string, HistoricalIdentityTarget[]>();
    for (const item of series) {
      const key = historicalIdentityKey(
        item.canonicalProvider,
        item.canonicalProviderId,
      );
      const values = identityTargets.get(key) ?? [];
      values.push({ matchRole: 'canonical', series: item });
      identityTargets.set(key, values);
    }
    for (const reference of references) {
      const targetSeries = seriesById.get(reference.seriesId);
      if (!targetSeries) continue;
      const key = historicalIdentityKey(
        reference.provider,
        reference.providerId,
      );
      const values = identityTargets.get(key) ?? [];
      if (!values.some((value) => value.series.id === targetSeries.id)) {
        values.push({ matchRole: 'external-ref', series: targetSeries });
      }
      identityTargets.set(key, values);
    }
    const bindingsByTask = new Map<
      string,
      MediaGovernanceTaskEpisodeBindingEntity[]
    >();
    for (const binding of bindings) {
      const values = bindingsByTask.get(binding.taskId) ?? [];
      values.push(binding);
      bindingsByTask.set(binding.taskId, values);
    }
    const seasonsByIdentity = new Map<string, MediaGovernanceSeasonEntity>();
    for (const season of seasons) {
      seasonsByIdentity.set(`${season.workId}:${season.seasonNumber}`, season);
    }
    const seasonsById = new Map(seasons.map((season) => [season.id, season]));
    const episodesById = new Map(episodes.map((item) => [item.id, item]));
    const canonicalEpisodes = new Set(
      episodes.map((episode) => `${episode.seasonId}:${episode.episodeNumber}`),
    );
    return {
      bindingsByTask,
      canonicalEpisodes,
      episodesById,
      identityTargets,
      seasonsById,
      seasonsByIdentity,
      seriesById,
    };
  }

  /**
   * 根据 Task 当前阶段更新已有绑定 Episode 状态，不替换来源角色或 sourceId。
   *
   * @param task - 已经存在唯一目录绑定的任务快照。
   * @param bindings - 当前任务的全部 Episode 绑定。
   * @returns 至少一个 Episode 状态发生变化时返回 true。
   */
  private async refreshBoundTaskEpisodeStatuses(
    task: MediaGovernanceTask,
    bindings: MediaGovernanceTaskEpisodeBindingEntity[],
  ): Promise<boolean> {
    let desiredStatus = 'queued';
    if (task.stage === 'closed' && task.runState === 'succeeded') {
      desiredStatus = 'completed';
    } else if (task.stage === 'download' && task.runState === 'running') {
      desiredStatus = 'downloading';
    }
    let changed = false;
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(MediaGovernanceEpisodeEntity);
      const episodes = await repository.findBy({
        id: In(bindings.map((binding) => binding.episodeId)),
      });
      const changedEpisodes = [];
      for (const episode of episodes) {
        if (episode.status === desiredStatus) continue;
        episode.status = desiredStatus;
        changedEpisodes.push(episode);
      }
      if (changedEpisodes.length === 0) return;
      await repository.save(changedEpisodes);
      changed = true;
    });
    return changed;
  }

  /**
   * 读取最新系列卡片并在目录事务完成后发布可重放 catalog-changed 事件。
   *
   * @param seriesId - 已提交变更的 Series 标识。
   * @param taskIds - 触发本次目录变化的 Task 集合。
   * @param changeType - 新建 Series 或更新既有目录的语义。
   */
  private async publishCatalogChanged(
    seriesId: string,
    taskIds: string[],
    changeType: 'created' | 'updated',
  ) {
    if (!this.eventStream) return;
    const series = await this.requireSeries(seriesId);
    const card = await this.projectSeriesCard(series);
    let taskId: null | string = null;
    if (taskIds.length === 1) taskId = taskIds[0];
    this.eventStream.publishCatalogChanged({
      changeType,
      revision: card.revision,
      series: card,
      seriesId,
      taskId,
      taskIds: [...taskIds],
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * 广播已提交的 Series 删除墓碑，让列表原位移除卡片并让详情页退出失效身份。
   *
   * @param seriesId - 已删除的 canonical Series 标识。
   * @param revision - 删除事务递增后的事件 revision。
   */
  private publishCatalogDeleted(seriesId: string, revision: number) {
    this.eventStream?.publishCatalogChanged({
      changeType: 'deleted',
      revision,
      series: null,
      seriesId,
      taskId: null,
      taskIds: [],
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * 按已存在目录绑定或精确资料身份判断单个历史任务，任何季集歧义都失败关闭为待处理。
   * @param task - 仅读取的历史任务持久化快照。
   * @param scope - 当前目录、季集、来源映射与绑定索引。
   * @returns 单个任务的稳定分类结果。
   */
  private classifyHistoricalTask(
    task: MediaGovernanceTask,
    scope: HistoricalClassificationScope,
  ): HistoricalClassificationItem {
    const identity = this.readHistoricalIdentity(task);
    const bindings = scope.bindingsByTask.get(task.id) ?? [];
    if (task.mediaType === 'movie' || task.mediaType === 'theatrical') {
      if (task.seriesId && task.workId) {
        return {
          existingBindingCount: bindings.length,
          mediaType: task.mediaType,
          metadataIdentity: identity,
          reasonCode: 'catalog-work-binding-existing',
          reasonLabel: '独立作品 Task 已绑定唯一 Series Work',
          status: 'classified',
          target: null,
          taskId: task.id,
          title: task.titleHint,
        };
      }
      return {
        existingBindingCount: bindings.length,
        mediaType: task.mediaType,
        metadataIdentity: identity,
        reasonCode: 'pending-series-membership',
        reasonLabel: '电影或剧场版 Task 尚未显式归入 Series Work',
        status: 'pending',
        target: null,
        taskId: task.id,
        title: task.titleHint,
      };
    }
    if (task.mediaType !== 'tv') {
      return this.pendingHistoricalTask(
        task,
        identity,
        bindings.length,
        'media-type-unsupported',
        '任务媒体类型不受系列资料库支持',
      );
    }
    if (bindings.length > 0) {
      return this.classifyBoundHistoricalTask(task, identity, bindings, scope);
    }
    if (!identity) {
      return this.pendingHistoricalTask(
        task,
        null,
        0,
        'metadata-identity-missing',
        '任务缺少已核实的资料身份',
      );
    }
    if (task.metadataStatus !== 'verified') {
      return this.pendingHistoricalTask(
        task,
        identity,
        0,
        'metadata-identity-unverified',
        '任务资料身份尚未完成核实',
      );
    }
    const identityTargets =
      scope.identityTargets.get(
        historicalIdentityKey(identity.provider, identity.providerId),
      ) ?? [];
    if (identityTargets.length === 0) {
      return this.pendingHistoricalTask(
        task,
        identity,
        0,
        'canonical-series-not-found',
        '精确资料身份尚未建立 canonical Series',
      );
    }
    if (identityTargets.length !== 1) {
      return this.pendingHistoricalTask(
        task,
        identity,
        0,
        'canonical-identity-conflict',
        '精确资料身份同时指向多个 Series',
      );
    }
    const identityTarget = identityTargets[0];
    const evidence = this.buildHistoricalSeasonEvidence(
      task,
      identityTarget.series,
      scope,
    );
    if (evidence.ok === false) {
      return this.pendingHistoricalTask(
        task,
        identity,
        0,
        evidence.reasonCode,
        evidence.reasonLabel,
        this.projectHistoricalTarget(identityTarget, [], new Set<string>()),
      );
    }
    return {
      existingBindingCount: 0,
      mediaType: task.mediaType,
      metadataIdentity: identity,
      reasonCode: 'catalog-binding-missing',
      reasonLabel: '资料身份与季集证据完整，将自动同步或可显式 reconcile',
      status: 'classifiable',
      target: this.projectHistoricalTarget(
        identityTarget,
        evidence.seasons,
        new Set<string>(),
      ),
      taskId: task.id,
      title: task.titleHint,
    };
  }

  /**
   * 验证既有目录绑定只指向一个 Series 且不违背任务资料身份，并把绑定本身作为已归类事实。
   * @param task - 当前历史任务快照。
   * @param identity - 任务可选精确资料身份。
   * @param bindings - 当前任务已有 Episode 绑定。
   * @param scope - 当前目录索引。
   * @returns 已归类结果或确定性冲突结果。
   */
  private classifyBoundHistoricalTask(
    task: MediaGovernanceTask,
    identity: HistoricalIdentity | null,
    bindings: MediaGovernanceTaskEpisodeBindingEntity[],
    scope: HistoricalClassificationScope,
  ): HistoricalClassificationItem {
    const seriesIds = new Set(bindings.map((binding) => binding.seriesId));
    if (seriesIds.size !== 1) {
      return this.pendingHistoricalTask(
        task,
        identity,
        bindings.length,
        'existing-binding-series-conflict',
        '既有目录绑定跨越多个 Series',
      );
    }
    const seriesId = [...seriesIds][0];
    const targetSeries = scope.seriesById.get(seriesId);
    if (!targetSeries) {
      return this.pendingHistoricalTask(
        task,
        identity,
        bindings.length,
        'existing-binding-series-missing',
        '既有目录绑定指向不存在的 Series',
      );
    }
    let matchRole: HistoricalClassificationTarget['matchRole'] =
      'catalog-binding';
    if (identity) {
      const identityTargets =
        scope.identityTargets.get(
          historicalIdentityKey(identity.provider, identity.providerId),
        ) ?? [];
      if (
        identityTargets.length !== 1 ||
        identityTargets[0].series.id !== targetSeries.id
      ) {
        return this.pendingHistoricalTask(
          task,
          identity,
          bindings.length,
          'existing-binding-identity-conflict',
          '既有目录绑定与任务精确资料身份不一致',
        );
      }
      matchRole = identityTargets[0].matchRole;
    }
    const episodesBySeason = new Map<number, Set<number>>();
    const existingEpisodeKeys = new Set<string>();
    const seasonsByNumber = new Map<number, MediaGovernanceSeasonEntity>();
    const workIds = new Set<string>();
    for (const binding of bindings) {
      const episode = scope.episodesById.get(binding.episodeId);
      if (
        !episode ||
        binding.seasonId !== episode.seasonId ||
        binding.seriesId !== episode.seriesId ||
        episode.seriesId !== targetSeries.id
      ) {
        return this.pendingHistoricalTask(
          task,
          identity,
          bindings.length,
          'existing-binding-episode-conflict',
          '既有目录绑定与 canonical Episode 身份不一致',
        );
      }
      const season = scope.seasonsById.get(episode.seasonId);
      if (!season || season.id !== episode.seasonId) {
        return this.pendingHistoricalTask(
          task,
          identity,
          bindings.length,
          'existing-binding-season-conflict',
          '既有目录绑定与 canonical Season 身份不一致',
        );
      }
      if (task.workId && season.workId !== task.workId) {
        return this.pendingHistoricalTask(
          task,
          identity,
          bindings.length,
          'existing-binding-work-conflict',
          '既有目录绑定与 Task Work 身份不一致',
        );
      }
      workIds.add(season.workId);
      if (workIds.size > 1) {
        return this.pendingHistoricalTask(
          task,
          identity,
          bindings.length,
          'existing-binding-work-conflict',
          '既有目录绑定跨越多个 Work',
        );
      }
      const existingSeason = seasonsByNumber.get(episode.seasonNumber);
      if (existingSeason && existingSeason.id !== season.id) {
        return this.pendingHistoricalTask(
          task,
          identity,
          bindings.length,
          'existing-binding-season-conflict',
          '同一季号的既有目录绑定指向不同 Work Season',
        );
      }
      seasonsByNumber.set(episode.seasonNumber, season);
      const values = episodesBySeason.get(episode.seasonNumber) ?? new Set();
      values.add(episode.episodeNumber);
      episodesBySeason.set(episode.seasonNumber, values);
      existingEpisodeKeys.add(
        `${episode.seasonNumber}:${episode.episodeNumber}`,
      );
    }
    const seasonEvidence = [...episodesBySeason.entries()]
      .sort(([left], [right]) => left - right)
      .map(([seasonNumber, episodeNumbers]) => ({
        episodeNumbers: [...episodeNumbers].sort((left, right) => left - right),
        season: seasonsByNumber.get(seasonNumber)!,
      }));
    return {
      existingBindingCount: bindings.length,
      mediaType: task.mediaType,
      metadataIdentity: identity,
      reasonCode: 'catalog-binding-existing',
      reasonLabel: '任务已经存在唯一且一致的 canonical Episode 绑定',
      status: 'classified',
      target: this.projectHistoricalTarget(
        { matchRole, series: targetSeries },
        seasonEvidence,
        existingEpisodeKeys,
      ),
      taskId: task.id,
      title: task.titleHint,
    };
  }

  /**
   * 从 Task Unit 声明与来源文件映射交叉提取唯一季集集合，并逐集核对 canonical 目录。
   * @param task - 待核对的未归类 TV 任务。
   * @param series - 精确身份命中的既有 Series。
   * @param scope - 单元、来源、季和 Episode 索引。
   * @returns 唯一季集证据，或第一条稳定失败原因。
   */
  private buildHistoricalSeasonEvidence(
    task: MediaGovernanceTask,
    series: MediaGovernanceSeriesEntity,
    scope: HistoricalClassificationScope,
  ): HistoricalEvidenceResult {
    const taskEvidence = collectTaskSeasonEvidence(task, false);
    if (taskEvidence.ok === false) return taskEvidence;
    const seasonEvidence: HistoricalSeasonEvidence[] = [];
    for (const evidence of taskEvidence.seasons) {
      const season = scope.seasonsByIdentity.get(
        `${series.primaryWorkId}:${evidence.seasonNumber}`,
      );
      if (!season) {
        return {
          ok: false,
          reasonCode: 'canonical-season-missing',
          reasonLabel: '任务季号在目标 Series 中不存在',
        };
      }
      for (const episodeNumber of evidence.episodeNumbers) {
        const canonicalEpisodeStart = season.episodeStart ?? 1;
        const canonicalEpisodeEnd =
          canonicalEpisodeStart + season.episodeCount - 1;
        if (
          episodeNumber < canonicalEpisodeStart ||
          episodeNumber > canonicalEpisodeEnd
        ) {
          return {
            ok: false,
            reasonCode: 'canonical-episode-out-of-range',
            reasonLabel: '任务集号超出目标 canonical Season 范围',
          };
        }
        if (!scope.canonicalEpisodes.has(`${season.id}:${episodeNumber}`)) {
          return {
            ok: false,
            reasonCode: 'canonical-episode-missing',
            reasonLabel: '任务集号对应的 canonical Episode 不存在',
          };
        }
      }
      seasonEvidence.push({
        episodeNumbers: evidence.episodeNumbers,
        season,
      });
    }
    return { ok: true, seasons: seasonEvidence };
  }

  /**
   * 把精确命中的 Series 和任务季集证据投影为可直接转换为 reconcile 范围的只读目标。
   * @param identityTarget - 精确命中的 canonical 或外部资料身份。
   * @param seasons - 已核对存在的任务季集证据。
   * @param existingEpisodeKeys - 已经存在目录绑定的季集键。
   * @returns 含连续集范围与覆盖计数的目标投影。
   */
  private projectHistoricalTarget(
    identityTarget: {
      matchRole: HistoricalClassificationTarget['matchRole'];
      series: MediaGovernanceSeriesEntity;
    },
    seasons: HistoricalSeasonEvidence[],
    existingEpisodeKeys: Set<string>,
  ): HistoricalClassificationTarget {
    const seasonTargets = seasons.map((item) => {
      let existingBindingCount = 0;
      for (const episodeNumber of item.episodeNumbers) {
        if (
          existingEpisodeKeys.has(
            `${item.season.seasonNumber}:${episodeNumber}`,
          )
        ) {
          existingBindingCount += 1;
        }
      }
      return {
        canonicalEpisodeCount: item.season.episodeCount,
        canonicalEpisodeStart: item.season.episodeStart ?? 1,
        episodeCount: item.episodeNumbers.length,
        episodeRanges: compressEpisodeRanges(item.episodeNumbers),
        existingBindingCount,
        missingBindingCount: item.episodeNumbers.length - existingBindingCount,
        seasonNumber: item.season.seasonNumber,
      };
    });
    return {
      canonicalProvider: identityTarget.series.canonicalProvider,
      canonicalProviderId: identityTarget.series.canonicalProviderId,
      matchRole: identityTarget.matchRole,
      releaseYear: identityTarget.series.releaseYear,
      seasons: seasonTargets,
      seriesId: identityTarget.series.id,
      title: identityTarget.series.title,
    };
  }

  /**
   * 读取任务内已经持久化的精确资料身份，缺字段或空编号时按无身份处理。
   * @param task - 仅读取的历史任务实体。
   * @returns 规范化资料身份或 `null`。
   */
  private readHistoricalIdentity(
    task: MediaGovernanceTask,
  ): HistoricalIdentity | null {
    const identity = task.metadataIdentity;
    if (!identity) return null;
    if (
      typeof identity.provider !== 'string' ||
      typeof identity.providerId !== 'string'
    ) {
      return null;
    }
    const provider = identity.provider.trim();
    const providerId = identity.providerId.trim();
    if (!provider || !providerId) return null;
    return { provider, providerId };
  }

  /**
   * 创建不改变任务和目录的待处理投影，并保留已解析出的目标供管理员核对。
   * @param task - 当前历史任务实体。
   * @param identity - 已解析资料身份或 `null`。
   * @param existingBindingCount - 当前目录绑定数量。
   * @param reasonCode - 稳定机器原因码。
   * @param reasonLabel - 管理端可读原因。
   * @param target - 可选已解析 Series 目标。
   * @returns 待处理分类项。
   */
  private pendingHistoricalTask(
    task: MediaGovernanceTask,
    identity: HistoricalIdentity | null,
    existingBindingCount: number,
    reasonCode: string,
    reasonLabel: string,
    target: HistoricalClassificationTarget | null = null,
  ): HistoricalClassificationItem {
    return {
      existingBindingCount,
      mediaType: task.mediaType,
      metadataIdentity: identity,
      reasonCode,
      reasonLabel,
      status: 'pending',
      target,
      taskId: task.id,
      title: task.titleHint,
    };
  }

  /**
   * 并行聚合系列的按季覆盖、独立任务、已绑定集和 RSS 数量，供卡片直接呈现治理密度。
   * @param series - canonical 系列实体。
   * @returns 含按季覆盖率与独立任务数的系列卡片投影。
   */
  private async projectSeriesCard(series: MediaGovernanceSeriesEntity) {
    const [works, seasons, episodeCount, bindings, rssCount, rssTotalCount] =
      await Promise.all([
        this.dataSource
          .getRepository(MediaGovernanceWorkEntity)
          .findBy({ seriesId: series.id }),
        this.dataSource.getRepository(MediaGovernanceSeasonEntity).find({
          order: { seasonNumber: 'ASC' },
          where: { seriesId: series.id },
        }),
        this.dataSource
          .getRepository(MediaGovernanceEpisodeEntity)
          .countBy({ seriesId: series.id }),
        this.dataSource
          .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
          .findBy({ seriesId: series.id }),
        this.dataSource
          .getRepository(MediaGovernanceRssSubscriptionEntity)
          .countBy({ enabled: true, seriesId: series.id }),
        this.dataSource
          .getRepository(MediaGovernanceRssSubscriptionEntity)
          .countBy({ seriesId: series.id }),
      ]);
    const seasonSummaries = await Promise.all(
      seasons.map((season) => this.projectSeasonCard(season)),
    );
    const boundEpisodeCount = new Set(
      bindings.map((binding) => binding.episodeId),
    ).size;
    const taskIds = new Set(bindings.map((binding) => binding.taskId));
    for (const task of this.readHistoricalTasks()) {
      if (task.seriesId === series.id) taskIds.add(task.id);
    }
    const taskCount = taskIds.size;
    let coveragePercent = 0;
    if (episodeCount > 0) {
      coveragePercent = Number(
        ((boundEpisodeCount / episodeCount) * 100).toFixed(1),
      );
    }
    return {
      ...series,
      bindingCount: bindings.length,
      boundEpisodeCount,
      coveragePercent,
      episodeCount,
      rssCount,
      rssTotalCount,
      seasonCount: seasons.length,
      seasonSummaries,
      taskCount,
      workCount: works.length,
    };
  }

  /**
   * 按 Episode 状态分组并计算独立任务、唯一绑定集与覆盖率，形成不依赖历史 Task 季号的季摘要。
   * @param season - canonical 季实体。
   * @returns 含独立任务数、唯一绑定集与覆盖率的季卡片投影。
   */
  private async projectSeasonCard(season: MediaGovernanceSeasonEntity) {
    const episodeRepository = this.dataSource.getRepository(
      MediaGovernanceEpisodeEntity,
    );
    const episodes = await episodeRepository.findBy({ seasonId: season.id });
    const statusCounts: Record<string, number> = {};
    for (const episode of episodes) {
      statusCounts[episode.status] = (statusCounts[episode.status] ?? 0) + 1;
    }
    const bindings = await this.dataSource
      .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
      .findBy({ seasonId: season.id });
    const boundEpisodeCount = new Set(
      bindings.map((binding) => binding.episodeId),
    ).size;
    const taskCount = new Set(bindings.map((binding) => binding.taskId)).size;
    let coveragePercent = 0;
    if (season.episodeCount > 0) {
      coveragePercent = Number(
        ((boundEpisodeCount / season.episodeCount) * 100).toFixed(1),
      );
    }
    return {
      ...season,
      bindingCount: bindings.length,
      boundEpisodeCount,
      coveragePercent,
      statusCounts,
      taskCount,
    };
  }

  /**
   * 校验系列纠正中季号、范围、外部引用和 Task 绑定均唯一且完整。
   * @param input - 待写入的系列事实。
   */
  private assertReconcileInput(input: MediaGovernanceSeriesReconcileDto) {
    const seasons = new Map(
      input.seasons.map((season) => [season.seasonNumber, season]),
    );
    if (seasons.size !== input.seasons.length) {
      throwVbenError('canonical 季号不能重复', HttpStatus.BAD_REQUEST);
    }
    for (const season of input.seasons) {
      const episodeStart = season.episodeStart ?? 1;
      const episodeEnd = episodeStart + season.episodeCount - 1;
      if (episodeEnd > 2000) {
        throwVbenError(
          'canonical 季集号范围不能超过 2000',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const referenceKeys = new Set<string>();
    const canonicalKey = `${input.canonicalProviderRef.provider}:${input.canonicalProviderRef.providerId.trim()}`;
    for (const reference of input.externalRefs ?? []) {
      const key = `${reference.providerRef.provider}:${reference.providerRef.providerId.trim()}`;
      if (key === canonicalKey || referenceKeys.has(key)) {
        throwVbenError('外部资料引用不能重复', HttpStatus.BAD_REQUEST);
      }
      referenceKeys.add(key);
    }
    const boundIdentities = new Set<string>();
    for (const binding of input.taskBindings ?? []) {
      const season = seasons.get(binding.seasonNumber);
      let episodeStart = 1;
      let episodeEnd = 0;
      if (season) {
        episodeStart = season.episodeStart ?? 1;
        episodeEnd = episodeStart + season.episodeCount - 1;
      }
      if (
        !season ||
        binding.episodeStart > binding.episodeEnd ||
        binding.episodeStart < episodeStart ||
        binding.episodeEnd > episodeEnd
      ) {
        throwVbenError('Task 集范围超出 canonical 季', HttpStatus.BAD_REQUEST);
      }
      for (
        let episode = binding.episodeStart;
        episode <= binding.episodeEnd;
        episode += 1
      ) {
        const key = `${binding.taskId}:${binding.seasonNumber}:${episode}`;
        if (boundIdentities.has(key)) {
          throwVbenError('Task 集范围不能重叠', HttpStatus.BAD_REQUEST);
        }
        boundIdentities.add(key);
      }
    }
  }

  /**
   * 以资料源与编号二元组复用主记录；命中时只提升 revision 并覆盖已核实标题和年份。
   * @param manager - 当前 TypeORM 事务管理器。
   * @param input - canonical 系列事实。
   * @returns 持久化系列实体。
   */
  private async upsertSeries(
    manager: EntityManager,
    input: MediaGovernanceSeriesReconcileDto,
  ) {
    const repository = manager.getRepository(MediaGovernanceSeriesEntity);
    const canonicalProvider = input.canonicalProviderRef.provider;
    const canonicalProviderId = input.canonicalProviderRef.providerId.trim();
    const canonicalNamespace = workIdentityNamespace(canonicalProvider, 'tv');
    let series = await repository.findOneBy({
      canonicalNamespace,
      canonicalProvider,
      canonicalProviderId,
    });
    if (!series) {
      series = repository.create({
        canonicalNamespace,
        canonicalProvider,
        canonicalProviderId,
        id: `media-series-${randomUUID()}`,
        mediaType: 'tv',
        originalTitle: input.originalTitle?.trim() || null,
        primaryWorkId: `media-work-${randomUUID()}`,
        releaseYear: input.releaseYear,
        revision: 1,
        status: 'active',
        title: input.title.trim(),
      });
    } else {
      series.title = input.title.trim();
      series.originalTitle = input.originalTitle?.trim() || null;
      series.releaseYear = input.releaseYear;
      series.revision += 1;
      series.status = 'active';
    }
    return repository.save(series);
  }

  /**
   * 把主资料引用和分篇证据写入同一全局唯一索引，并拒绝把一个外部编号挂到另一系列。
   * @param manager - 当前 TypeORM 事务管理器。
   * @param series - 已持久化 canonical Series。
   * @param input - canonical 与外部引用输入。
   */
  private async upsertSeriesReferences(
    manager: EntityManager,
    series: MediaGovernanceSeriesEntity,
    input: MediaGovernanceSeriesReconcileDto,
  ) {
    const values = [
      {
        providerRef: input.canonicalProviderRef,
        referenceRole: 'canonical',
        releaseYear: input.releaseYear,
        title: input.title,
      },
      ...(input.externalRefs ?? []).map((reference) => ({
        ...reference,
        referenceRole: 'catalog-evidence',
      })),
    ];
    const repository = manager.getRepository(
      MediaGovernanceSeriesExternalRefEntity,
    );
    for (const value of values) {
      const provider = value.providerRef.provider;
      const providerId = value.providerRef.providerId.trim();
      let reference = await repository.findOneBy({ provider, providerId });
      if (reference && reference.seriesId !== series.id) {
        throwVbenError('外部资料编号已绑定其他系列', HttpStatus.CONFLICT);
      }
      if (!reference) {
        reference = repository.create({
          id: `media-series-ref-${randomUUID()}`,
          provider,
          providerId,
          referenceRole: value.referenceRole,
          releaseYear: value.releaseYear ?? null,
          seriesId: series.id,
          title: value.title?.trim() || null,
        });
      } else {
        reference.referenceRole = value.referenceRole;
        reference.releaseYear = value.releaseYear ?? null;
        reference.title = value.title?.trim() || null;
      }
      await repository.save(reference);
    }
  }

  /**
   * 为 legacy reconcile 幂等补齐主 TV Work，避免迁移工具再产生无 Work 的 Series。
   *
   * @param manager - 当前 TypeORM 事务管理器。
   * @param series - 已持久化 Series。
   * @param input - legacy canonical 身份与展示事实。
   * @returns 与 Series 主身份一致的 TV Work。
   */
  private async ensurePrimaryWork(
    manager: EntityManager,
    series: MediaGovernanceSeriesEntity,
    input: MediaGovernanceSeriesReconcileDto,
  ) {
    const repository = manager.getRepository(MediaGovernanceWorkEntity);
    const canonicalNamespace = workIdentityNamespace(
      input.canonicalProviderRef.provider,
      'tv',
    );
    let work = await repository.findOneBy({
      canonicalNamespace,
      canonicalProvider: input.canonicalProviderRef.provider,
      canonicalProviderId: input.canonicalProviderRef.providerId.trim(),
    });
    if (work && work.seriesId !== series.id) {
      throwVbenError('主作品身份已绑定其他 Series', HttpStatus.CONFLICT);
    }
    if (!work) {
      work = repository.create({
        canonicalNamespace,
        canonicalProvider: input.canonicalProviderRef.provider,
        canonicalProviderId: input.canonicalProviderRef.providerId.trim(),
        id: series.primaryWorkId,
        originalTitle: input.originalTitle?.trim() || null,
        releaseYear: input.releaseYear,
        revision: 1,
        seriesId: series.id,
        status: 'active',
        title: input.title.trim(),
        workType: 'tv',
      });
      await repository.save(work);
    }
    if (series.primaryWorkId !== work.id) {
      series.primaryWorkId = work.id;
      await manager.getRepository(MediaGovernanceSeriesEntity).save(series);
    }
    const referenceRepository = manager.getRepository(
      MediaGovernanceWorkExternalRefEntity,
    );
    let reference = await referenceRepository.findOneBy({
      provider: work.canonicalProvider,
      providerId: work.canonicalProviderId,
      providerNamespace: work.canonicalNamespace,
    });
    if (!reference) {
      reference = referenceRepository.create({
        id: `media-work-ref-${randomUUID()}`,
        provider: work.canonicalProvider,
        providerId: work.canonicalProviderId,
        providerNamespace: work.canonicalNamespace,
        referenceRole: 'canonical',
        releaseYear: work.releaseYear,
        title: work.title,
        workId: work.id,
      });
      await referenceRepository.save(reference);
    }
    return work;
  }

  /**
   * 将每季收敛为 episodeStart 起始的连续区间；变更时只删除未绑定的越界集并保留稳定 ID。
   * @param manager - 当前 TypeORM 事务管理器。
   * @param series - 已持久化的系列主实体。
   * @param work - Season 必须归属且参与季号唯一键的目标 TV Work。
   * @param input - 季事实集合。
   * @returns 以季号索引的季与 Episode 集合。
   */
  private async upsertSeasons(
    manager: EntityManager,
    series: MediaGovernanceSeriesEntity,
    work: MediaGovernanceWorkEntity,
    input: MediaGovernanceSeriesReconcileDto,
  ) {
    const seasonRepository = manager.getRepository(MediaGovernanceSeasonEntity);
    const episodeRepository = manager.getRepository(
      MediaGovernanceEpisodeEntity,
    );
    const result = new Map<
      number,
      {
        episodes: Map<number, MediaGovernanceEpisodeEntity>;
        season: MediaGovernanceSeasonEntity;
      }
    >();
    for (const inputSeason of input.seasons) {
      const episodeStart = inputSeason.episodeStart ?? 1;
      const episodeEnd = episodeStart + inputSeason.episodeCount - 1;
      let season = await seasonRepository.findOneBy({
        seasonNumber: inputSeason.seasonNumber,
        workId: work.id,
      });
      if (!season) {
        season = await seasonRepository.findOneBy({
          seasonNumber: inputSeason.seasonNumber,
          seriesId: series.id,
          workId: null,
        });
      }
      if (!season) {
        season = seasonRepository.create({
          episodeCount: inputSeason.episodeCount,
          episodeStart,
          id: `media-season-${randomUUID()}`,
          releaseYear: inputSeason.releaseYear ?? null,
          seasonNumber: inputSeason.seasonNumber,
          seriesId: series.id,
          status: 'known',
          title: inputSeason.title.trim(),
          workId: work.id,
        });
      } else {
        season.title = inputSeason.title.trim();
        season.releaseYear = inputSeason.releaseYear ?? null;
        season.episodeCount = inputSeason.episodeCount;
        season.episodeStart = episodeStart;
        season.workId = work.id;
      }
      season = await seasonRepository.save(season);
      const existing = await episodeRepository.findBy({ seasonId: season.id });
      const episodes = new Map(
        existing.map((episode) => [episode.episodeNumber, episode]),
      );
      const obsolete = existing.filter(
        (episode) =>
          episode.episodeNumber < episodeStart ||
          episode.episodeNumber > episodeEnd,
      );
      if (obsolete.length > 0) {
        const obsoleteIds = obsolete.map((episode) => episode.id);
        const boundObsoleteCount = await manager
          .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
          .countBy({ episodeId: In(obsoleteIds) });
        if (boundObsoleteCount > 0) {
          throwVbenError(
            '缩减季集数前必须先纠正超范围 Task 绑定',
            HttpStatus.CONFLICT,
          );
        }
        await episodeRepository.delete({ id: In(obsoleteIds) });
        for (const episode of obsolete) {
          episodes.delete(episode.episodeNumber);
        }
      }
      const additions = [];
      for (
        let episodeNumber = episodeStart;
        episodeNumber <= episodeEnd;
        episodeNumber += 1
      ) {
        if (episodes.has(episodeNumber)) continue;
        additions.push(
          episodeRepository.create({
            episodeNumber,
            id: `media-episode-${randomUUID()}`,
            seasonId: season.id,
            seasonNumber: season.seasonNumber,
            seriesId: series.id,
            status: 'known',
            title: null,
          }),
        );
      }
      if (additions.length > 0) {
        const saved = await episodeRepository.save(additions);
        for (const episode of saved) {
          episodes.set(episode.episodeNumber, episode);
        }
      }
      result.set(season.seasonNumber, { episodes, season });
    }
    return result;
  }

  /**
   * 以输入范围替换涉及 Task 的旧目录绑定，并按 Task 终态更新 Episode 状态。
   * @param manager - 当前 TypeORM 事务管理器。
   * @param series - 已持久化的系列主实体。
   * @param seasons - 以季号索引的季与 Episode。
   * @param input - Task 集范围。
   */
  private async replaceTaskBindings(
    manager: EntityManager,
    series: MediaGovernanceSeriesEntity,
    seasons: Map<
      number,
      {
        episodes: Map<number, MediaGovernanceEpisodeEntity>;
        season: MediaGovernanceSeasonEntity;
      }
    >,
    input: MediaGovernanceSeriesReconcileDto,
  ) {
    const bindingRepository = manager.getRepository(
      MediaGovernanceTaskEpisodeBindingEntity,
    );
    const episodeRepository = manager.getRepository(
      MediaGovernanceEpisodeEntity,
    );
    const taskIds = [
      ...new Set((input.taskBindings ?? []).map((binding) => binding.taskId)),
    ];
    if (taskIds.length > 0)
      await bindingRepository.delete({ taskId: In(taskIds) });
    for (const binding of input.taskBindings ?? []) {
      const task = this.mediaTasks.detail(binding.taskId);
      const seasonScope = seasons.get(binding.seasonNumber)!;
      let episodeStatus = 'queued';
      if (task.stage === 'closed' && task.runState === 'succeeded') {
        episodeStatus = 'completed';
      } else if (task.stage === 'download' && task.runState === 'running') {
        episodeStatus = 'downloading';
      }
      const rows = [];
      for (
        let episodeNumber = binding.episodeStart;
        episodeNumber <= binding.episodeEnd;
        episodeNumber += 1
      ) {
        const episode = seasonScope.episodes.get(episodeNumber)!;
        episode.status = episodeStatus;
        rows.push(
          bindingRepository.create({
            bindingRole: 'execution-history',
            episodeId: episode.id,
            id: `media-task-episode-${randomUUID()}`,
            seasonId: seasonScope.season.id,
            seriesId: series.id,
            sourceId: null,
            taskId: binding.taskId,
          }),
        );
      }
      await episodeRepository.save(
        [...seasonScope.episodes.values()].filter(
          (episode) =>
            episode.episodeNumber >= binding.episodeStart &&
            episode.episodeNumber <= binding.episodeEnd,
        ),
      );
      await bindingRepository.save(rows);
    }
  }

  /**
   * 创建批量磁链 Task 并按来源顺序绑定 canonical Episode。
   * @param seriesId - canonical 系列标识。
   * @param workId - Season 所属 Work 标识。
   * @param seasonNumber - canonical 季号。
   * @param input - 批量磁链输入。
   * @param bindingRole - 手动或 RSS 创建的绑定角色。
   * @param taskIdentity - RSS 订阅持久化的精确资料身份；手动磁链不传。
   * @param torrentDescriptors - 与 RSS 条目同序的原始 torrent 描述符；普通磁链批次不传。
   * @returns 新 Task、来源与集绑定。
   */
  private async createMagnetBatchWithRole(
    seriesId: string,
    workId: string,
    seasonNumber: number,
    input: MediaGovernanceMagnetBatchCreateDto,
    bindingRole: 'pending-rss' | 'pending-source',
    taskIdentity?: RssTaskIdentity,
    torrentDescriptors: Array<Buffer | null> = [],
  ) {
    const work = await this.requireWork(seriesId, workId);
    const season = await this.requireSeason(seriesId, workId, seasonNumber);
    const episodeNumbers = input.items.map((item) => item.episodeNumber);
    if (new Set(episodeNumbers).size !== episodeNumbers.length) {
      throwVbenError('批量磁链集号不能重复', HttpStatus.BAD_REQUEST);
    }
    const canonicalEpisodeStart = season.episodeStart ?? 1;
    const canonicalEpisodeEnd = canonicalEpisodeStart + season.episodeCount - 1;
    if (
      episodeNumbers.some(
        (episodeNumber) =>
          episodeNumber < canonicalEpisodeStart ||
          episodeNumber > canonicalEpisodeEnd,
      )
    ) {
      throwVbenError('批量磁链集号超出 canonical 季', HttpStatus.BAD_REQUEST);
    }
    const infoHashes = input.items.map((item) =>
      mediaGovernanceMagnetInfoHash(item.magnetUri),
    );
    if (new Set(infoHashes).size !== infoHashes.length) {
      throwVbenError('批量磁链 BTIH 不能重复', HttpStatus.BAD_REQUEST);
    }
    const episodeRepository = this.dataSource.getRepository(
      MediaGovernanceEpisodeEntity,
    );
    const episodes = await episodeRepository.findBy({
      episodeNumber: In(episodeNumbers),
      seasonId: season.id,
    });
    if (episodes.length !== episodeNumbers.length) {
      throwVbenError('canonical Episode 不完整', HttpStatus.CONFLICT);
    }
    const existingBindings = await this.dataSource
      .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
      .findBy({ episodeId: In(episodes.map((episode) => episode.id)) });
    if (existingBindings.length > 0) {
      throwVbenError('所选集已有 Task 绑定，不能重复入队', HttpStatus.CONFLICT);
    }
    let operationKind: 'magnet-batch' | 'rss-intake-auto' = 'magnet-batch';
    if (bindingRole === 'pending-rss') operationKind = 'rss-intake-auto';
    let taskProvider = work.canonicalProvider as MediaGovernanceProvider;
    let taskProviderId = work.canonicalProviderId;
    let taskReleaseYear: null | number = work.releaseYear;
    let taskTitle = work.title;
    if (bindingRole === 'pending-rss') {
      if (!taskIdentity) {
        throwVbenError('RSS Task 缺少订阅资料身份', HttpStatus.CONFLICT);
      }
      await this.assertRssIdentityBelongsToWork(work, taskIdentity);
      taskProvider = taskIdentity.provider;
      taskProviderId = taskIdentity.providerId;
      taskReleaseYear = taskIdentity.releaseYear;
      taskTitle = taskIdentity.title;
    }
    const task = await this.mediaTasks.create({
      mediaType: 'tv',
      metadataIdentity: this.workMetadataIdentity(work),
      operationKind,
      providerRef: {
        provider: taskProvider,
        providerId: taskProviderId,
      },
      releaseYear: taskReleaseYear,
      seasonNumbers: [seasonToken(seasonNumber)],
      seriesId,
      titleHint: taskTitle,
      workId,
    });
    const sources = [];
    for (let index = 0; index < input.items.length; index += 1) {
      const item = input.items[index];
      const torrentDescriptor = torrentDescriptors[index];
      let source;
      if (torrentDescriptor) {
        source = await this.mediaTasks.addTorrentSource(
          task.id,
          {
            contentKind: input.contentKind,
            expectedRevision: task.revision,
            releaseGroup: input.releaseGroup,
            seasonNumbers: [seasonToken(seasonNumber)],
            sourceRole: 'primary_media',
          },
          { buffer: torrentDescriptor, size: torrentDescriptor.length },
        );
      } else {
        source = await this.mediaTasks.addMagnetSource(task.id, {
          contentKind: input.contentKind,
          expectedRevision: task.revision,
          magnetUri: item.magnetUri,
          releaseGroup: input.releaseGroup,
          seasonNumbers: [seasonToken(seasonNumber)],
          sourceRole: 'primary_media',
        });
      }
      sources.push(source);
    }
    const episodeByNumber = new Map(
      episodes.map((episode) => [episode.episodeNumber, episode]),
    );
    const bindings = await this.dataSource.transaction(async (manager) => {
      const bindingRepository = manager.getRepository(
        MediaGovernanceTaskEpisodeBindingEntity,
      );
      const managedEpisodes = manager.getRepository(
        MediaGovernanceEpisodeEntity,
      );
      const rows = [];
      for (let index = 0; index < input.items.length; index += 1) {
        const item = input.items[index];
        const source = sources[index];
        const episode = episodeByNumber.get(item.episodeNumber)!;
        episode.status = 'queued';
        rows.push(
          bindingRepository.create({
            bindingRole,
            episodeId: episode.id,
            id: `media-task-episode-${randomUUID()}`,
            seasonId: season.id,
            seriesId,
            sourceId: source.id,
            taskId: task.id,
          }),
        );
      }
      await managedEpisodes.save([...episodeByNumber.values()]);
      return bindingRepository.save(rows);
    });
    const result = {
      bindings,
      sources,
      task: this.mediaTasks.detail(task.id),
    };
    await this.publishCatalogChanged(seriesId, [task.id], 'updated').catch(
      () => undefined,
    );
    return result;
  }

  /**
   * 校验 RSS 地址只使用无内嵌凭据的 HTTP(S)，同时保留内网订阅能力。
   * @param value - 管理员提交的 RSS 地址。
   */
  private assertRssUrl(value: string) {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throwVbenError(
        'RSS 地址必须是无内嵌凭据的 HTTP(S)',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * 预编译可选管理员正则，避免无效订阅进入后台轮询。
   * @param value - 可选包含或集号正则。
   */
  private assertPattern(value: string | undefined) {
    if (!value?.trim()) return;
    try {
      new RegExp(value.trim(), 'iu');
    } catch {
      throwVbenError('RSS 正则表达式无效', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * 返回存在的 canonical 系列，不存在时抛出 404。
   * @param seriesId - 系列标识。
   * @returns 系列实体。
   */
  private async requireSeries(seriesId: string) {
    const series = await this.dataSource
      .getRepository(MediaGovernanceSeriesEntity)
      .findOneBy({ id: seriesId });
    if (!series)
      throwVbenError('canonical Series 不存在', HttpStatus.NOT_FOUND);
    return series;
  }

  /**
   * 要求 Work 存在且确实属于路径中的 Series，阻止跨 Series 复用操作上下文。
   *
   * @param seriesId - 路径声明的 Series 标识。
   * @param workId - 路径声明的 Work 标识。
   * @returns 所有权匹配的 Work。
   */
  private async requireWork(seriesId: string, workId: string) {
    const work = await this.dataSource
      .getRepository(MediaGovernanceWorkEntity)
      .findOneBy({ id: workId, seriesId });
    if (!work) throwVbenError('Series Work 不存在', HttpStatus.NOT_FOUND);
    return work;
  }

  /**
   * 通过固定资料源详情重新核验 Series/Work 创建身份，客户端标题不会进入事实层。
   *
   * @param input - Work 类型与用户明确选择的资料身份。
   * @returns 官方核验后的标题、原名、年份和 provider 证据。
   */
  private async verifyWorkIdentity(
    input: MediaGovernanceSeriesCreateDto | MediaGovernanceWorkCreateDto,
  ): Promise<MediaGovernanceRssIdentityCandidate> {
    try {
      return await verifyMediaGovernanceCatalogIdentity({
        identity: {
          provider: input.identity.provider,
          providerId: input.identity.providerId,
          releaseYear: input.identity.releaseYear ?? null,
        },
        mediaType: input.workType,
        originalTitle: null,
        releaseYear: input.identity.releaseYear ?? new Date().getFullYear(),
        seasonNumber: 0,
        seriesTitle: '',
      });
    } catch {
      throwVbenError('所选作品身份无法重新核验', HttpStatus.CONFLICT);
    }
  }

  /**
   * 保存 Work canonical 或 evidence 引用，并拒绝 namespaced 身份跨 Work 复用。
   *
   * @param manager - Series/Work 创建事务管理器。
   * @param work - 引用所属 Work。
   * @param identity - 官方核验身份。
   * @param referenceRole - canonical 或 catalog-evidence 角色。
   */
  private async saveWorkReference(
    manager: EntityManager,
    work: MediaGovernanceWorkEntity,
    identity: MediaGovernanceRssIdentityCandidate,
    referenceRole: 'canonical' | 'catalog-evidence',
  ): Promise<void> {
    const repository = manager.getRepository(
      MediaGovernanceWorkExternalRefEntity,
    );
    const providerNamespace = workIdentityNamespace(
      identity.provider,
      work.workType as MediaGovernanceMediaType,
    );
    const existing = await repository.findOneBy({
      provider: identity.provider,
      providerId: identity.providerId,
      providerNamespace,
    });
    if (existing && existing.workId !== work.id) {
      throwVbenError('作品资料身份已绑定其他 Work', HttpStatus.CONFLICT);
    }
    let reference = existing;
    if (!reference) {
      reference = repository.create({
        id: `media-work-ref-${randomUUID()}`,
        provider: identity.provider,
        providerId: identity.providerId,
        providerNamespace,
        referenceRole,
        releaseYear: identity.releaseYear,
        title: identity.title,
        workId: work.id,
      });
    } else {
      reference.referenceRole = referenceRole;
      reference.releaseYear = identity.releaseYear;
      reference.title = identity.title;
    }
    await repository.save(reference);
  }

  /**
   * 把 RSS 明确选择且已重新核验的身份同步为 Series 资料证据，并保留既有 canonical 角色。
   * @param manager - 创建订阅或修复上下文的同一事务管理器。
   * @param seriesId - 资料引用所属 Series。
   * @param identity - 已从资料源重新读取的精确身份。
   * @param referenceRole - canonical 或 catalog-evidence 角色。
   */
  private async saveSeriesReference(
    manager: EntityManager,
    seriesId: string,
    identity: MediaGovernanceRssIdentityCandidate,
    referenceRole: 'canonical' | 'catalog-evidence',
  ): Promise<void> {
    const repository = manager.getRepository(
      MediaGovernanceSeriesExternalRefEntity,
    );
    let reference = await repository.findOneBy({
      provider: identity.provider,
      providerId: identity.providerId,
    });
    if (reference && reference.seriesId !== seriesId) {
      throwVbenError('资料身份已绑定其他 Series', HttpStatus.CONFLICT);
    }
    if (!reference) {
      reference = repository.create({
        id: `media-series-ref-${randomUUID()}`,
        provider: identity.provider,
        providerId: identity.providerId,
        referenceRole,
        releaseYear: identity.releaseYear,
        seriesId,
        title: identity.title,
      });
    } else {
      if (reference.referenceRole !== 'canonical') {
        reference.referenceRole = referenceRole;
      }
      reference.releaseYear = identity.releaseYear;
      reference.title = identity.title;
    }
    await repository.save(reference);
  }

  /**
   * 在操作者显式创建 Work 后，只把 exact verified identity 相同的遗留 Task 绑定到该 Work。
   *
   * @param work - 已由官方身份创建的目标 Work。
   */
  private async bindExactLegacyTasksToWork(
    work: MediaGovernanceWorkEntity,
  ): Promise<void> {
    for (const task of this.readHistoricalTasks()) {
      if (
        task.workId ||
        !sameWorkMediaKind(
          task.mediaType,
          work.workType as MediaGovernanceMediaType,
        )
      ) {
        continue;
      }
      const identities = [task.providerRef, task.metadataIdentity].filter(
        (identity): identity is NonNullable<typeof identity> =>
          Boolean(identity),
      );
      const exact = identities.some(
        (identity) =>
          identity.provider === work.canonicalProvider &&
          identity.providerId === work.canonicalProviderId,
      );
      if (!exact) continue;
      await this.mediaTasks.bindWorkContext(task.id, {
        operationKind: 'legacy-pipeline',
        seriesId: work.seriesId,
        workId: work.id,
      });
    }
  }

  /**
   * 返回指定 Work 内存在的 canonical 季，不存在时抛出 404。
   * @param seriesId - 系列标识。
   * @param workId - Work 标识。
   * @param seasonNumber - canonical 季号。
   * @returns 季实体。
   */
  private async requireSeason(
    seriesId: string,
    workId: string,
    seasonNumber: number,
  ) {
    const season = await this.dataSource
      .getRepository(MediaGovernanceSeasonEntity)
      .findOneBy({ seasonNumber, seriesId, workId });
    if (!season)
      throwVbenError('Work canonical Season 不存在', HttpStatus.NOT_FOUND);
    return season;
  }

  /**
   * 从迁移兼容的 Season 投影读取非空 Work 身份，缺失时阻断 RSS 入队。
   * @param season - RSS 订阅精确绑定的 Season。
   * @returns Season 所属 Work 标识。
   */
  private requireSeasonWorkId(season: MediaGovernanceSeasonEntity) {
    if (!season.workId) {
      throwVbenError('RSS Season 尚未绑定 Work', HttpStatus.CONFLICT);
    }
    return season.workId;
  }

  /**
   * 返回存在的 RSS 订阅，不存在时抛出 404。
   * @param subscriptionId - 订阅标识。
   * @returns RSS 订阅实体。
   */
  private async requireSubscription(subscriptionId: string) {
    const subscription = await this.dataSource
      .getRepository(MediaGovernanceRssSubscriptionEntity)
      .findOneBy({ id: subscriptionId });
    if (!subscription) throwVbenError('RSS 订阅不存在', HttpStatus.NOT_FOUND);
    return subscription;
  }

  /**
   * 拉取有界 RSS 正文并拒绝非成功响应和超大载荷。
   * @param feedUrl - 已校验订阅地址。
   * @returns RSS XML 文本。
   * @throws 网络失败、HTTP 非成功或响应声明/实际超过两 MiB 时抛出。
   */
  private async fetchFeed(feedUrl: string) {
    const response = await fetch(feedUrl, {
      headers: {
        accept:
          'application/atom+xml, application/rss+xml, application/xml, text/xml',
        'user-agent': 'KT-Media-Governance-RSS/1.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`media-rss-http-${response.status}`);
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > RSS_MAX_BYTES) {
      throw new Error('media-rss-response-too-large');
    }
    if (!response.body) throw new Error('media-rss-response-body-missing');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > RSS_MAX_BYTES) {
        await reader.cancel();
        throw new Error('media-rss-response-too-large');
      }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * 查询到期订阅并串行触发，避免后台轮询争抢同一 Series 集范围。
   */
  private async pollDueSubscriptions() {
    if (!this.dataSource.isInitialized) return;
    const repository = this.dataSource.getRepository(
      MediaGovernanceRssSubscriptionEntity,
    );
    const now = toKtDateTime(new Date());
    if (!now) return;
    const due = await repository.find({
      order: { nextPollAt: 'ASC' },
      take: 5,
      where: [
        { enabled: true, nextPollAt: LessThanOrEqual(now) },
        { enabled: true, nextPollAt: null },
      ],
    });
    for (const subscription of due) {
      await this.pollSubscription(subscription, false).catch(() => undefined);
    }
  }

  /**
   * 处理一次订阅拉取、条目去重、集号映射和批量 Task 创建，并更新下次轮询时间。
   * @param subscription - 当前订阅实体。
   * @param manual - 是否由管理员手动触发。
   * @returns 本轮发现、忽略、排队和创建 Task 数量。
   * @throws 同进程轮询重入，或手动轮询的 optimistic revision 抢占失败时抛出。
   */
  private async pollSubscription(
    subscription: MediaGovernanceRssSubscriptionEntity,
    manual: boolean,
  ) {
    if (this.pollingSubscriptions.has(subscription.id)) {
      throwVbenError('RSS 订阅正在轮询', HttpStatus.CONFLICT);
    }
    if (!manual && !subscription.enabled) {
      return { createdTasks: 0, discovered: 0, ignored: 0, queued: 0 };
    }
    this.pollingSubscriptions.add(subscription.id);
    const subscriptionRepository = this.dataSource.getRepository(
      MediaGovernanceRssSubscriptionEntity,
    );
    const claimNextPollAt = toKtDateTime(
      Date.now() + subscription.pollIntervalMinutes * 60_000,
    );
    const claimed = await subscriptionRepository.update(
      { id: subscription.id, revision: subscription.revision },
      {
        lastError: null,
        nextPollAt: claimNextPollAt,
        revision: subscription.revision + 1,
        status: 'polling',
      },
    );
    if (claimed.affected !== 1) {
      this.pollingSubscriptions.delete(subscription.id);
      if (manual) {
        throwVbenError('RSS 订阅状态已变化', HttpStatus.CONFLICT);
      }
      return { createdTasks: 0, discovered: 0, ignored: 0, queued: 0 };
    }
    subscription.revision += 1;
    subscription.status = 'polling';
    subscription.lastError = null;
    subscription.nextPollAt = claimNextPollAt;
    try {
      const xml = await this.fetchFeed(subscription.feedUrl);
      const entries = parseMediaGovernanceRss(xml);
      const result = await this.persistRssEntries(subscription, entries);
      const now = new Date();
      subscription.lastPolledAt = toKtDateTime(now);
      subscription.nextPollAt = toKtDateTime(
        now.getTime() + subscription.pollIntervalMinutes * 60_000,
      );
      subscription.status = 'idle';
      subscription.lastError = null;
      subscription.revision += 1;
      await subscriptionRepository.save(subscription);
      return result;
    } catch (error) {
      const now = new Date();
      subscription.lastPolledAt = toKtDateTime(now);
      subscription.nextPollAt = toKtDateTime(
        now.getTime() + subscription.pollIntervalMinutes * 60_000,
      );
      subscription.status = 'error';
      subscription.lastError = boundedError(error);
      subscription.revision += 1;
      await subscriptionRepository.save(subscription);
      if (manual) throw error;
      return { createdTasks: 0, discovered: 0, ignored: 0, queued: 0 };
    } finally {
      this.pollingSubscriptions.delete(subscription.id);
    }
  }

  /**
   * 持久化新 RSS 条目，并把未绑定的有效集按十六条切分为批量 Task。
   * @param subscription - 当前 RSS 订阅。
   * @param entries - 标准化 RSS 条目。
   * @returns 本轮数量摘要。
   */
  private async persistRssEntries(
    subscription: MediaGovernanceRssSubscriptionEntity,
    entries: MediaGovernanceRssEntry[],
  ) {
    const season = await this.dataSource
      .getRepository(MediaGovernanceSeasonEntity)
      .findOneByOrFail({ id: subscription.seasonId });
    const taskIdentity = this.rssTaskIdentity(subscription);
    const itemRepository = this.dataSource.getRepository(
      MediaGovernanceRssItemEntity,
    );
    const candidates: Array<{
      entity: MediaGovernanceRssItemEntity;
      magnetUri: string;
      torrentDescriptor: Buffer | null;
    }> = [];
    const descriptorUpgrades: Array<{
      descriptor: Buffer;
      sourceId: string;
      taskId: string;
    }> = [];
    let ignored = 0;
    let discovered = 0;
    for (const entry of entries) {
      let infoHash: null | string = null;
      let magnetUri: null | string = null;
      let torrentDescriptor: Buffer | null = null;
      if (entry.magnetUri) {
        try {
          magnetUri = normalizeMediaGovernanceMagnetUri(entry.magnetUri);
          infoHash = mediaGovernanceMagnetInfoHash(magnetUri);
        } catch {
          magnetUri = null;
          infoHash = null;
        }
      }
      const itemKeySha256 = createHash('sha256')
        .update(
          [
            entry.guid ?? '',
            infoHash ?? '',
            entry.title,
            entry.publishedAt?.toISOString() ?? '',
          ].join('\n'),
        )
        .digest('hex');
      const duplicate = await itemRepository.findOneBy({
        itemKeySha256,
        subscriptionId: subscription.id,
      });
      if (
        duplicate &&
        (duplicate.taskId ||
          duplicate.sourceId ||
          !RSS_RETRYABLE_ITEM_STATES.has(duplicate.state))
      ) {
        const upgrade = await this.resolveExistingRssTorrentUpgrade(
          duplicate,
          entry,
        );
        if (upgrade) descriptorUpgrades.push(upgrade);
        continue;
      }
      discovered += 1;
      let episodeNumber: null | number = null;
      if (
        mediaGovernanceRssTitleIncluded(
          entry.title,
          subscription.includePattern,
        )
      ) {
        episodeNumber = parseMediaGovernanceEpisodeNumber(
          entry.title,
          subscription.episodePattern,
        );
      }
      let publishedAt = null;
      if (entry.publishedAt) {
        publishedAt = toKtDateTime(entry.publishedAt);
      }
      let entity = duplicate;
      if (!entity) {
        entity = itemRepository.create({
          episodeNumber,
          guid: entry.guid,
          id: `media-rss-item-${randomUUID()}`,
          infoHash,
          itemKeySha256,
          publishedAt,
          sourceId: null,
          state: 'discovered',
          stateReason: null,
          subscriptionId: subscription.id,
          taskId: null,
          title: entry.title,
        });
      } else {
        entity.episodeNumber = episodeNumber;
        entity.guid = entry.guid;
        entity.infoHash = infoHash;
        entity.publishedAt = publishedAt;
        entity.sourceId = null;
        entity.state = 'discovered';
        entity.stateReason = null;
        entity.taskId = null;
        entity.title = entry.title;
      }
      const canonicalEpisodeStart = season.episodeStart ?? 1;
      const canonicalEpisodeEnd =
        canonicalEpisodeStart + season.episodeCount - 1;
      if (
        !episodeNumber ||
        episodeNumber < canonicalEpisodeStart ||
        episodeNumber > canonicalEpisodeEnd
      ) {
        entity.state = 'ignored';
        entity.stateReason = '条目未命中过滤或 canonical 集号合同';
        ignored += 1;
        await itemRepository.save(entity);
        continue;
      }
      const episode = await this.dataSource
        .getRepository(MediaGovernanceEpisodeEntity)
        .findOneBy({ episodeNumber, seasonId: season.id });
      if (!episode) {
        entity.state = 'ignored';
        entity.stateReason = 'canonical Episode 不存在';
        ignored += 1;
        await itemRepository.save(entity);
        continue;
      }
      const binding = await this.dataSource
        .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
        .findOneBy({ episodeId: episode.id });
      if (binding) {
        entity.state = 'ignored';
        entity.stateReason = 'canonical Episode 已有 Task 绑定';
        ignored += 1;
        await itemRepository.save(entity);
        continue;
      }
      if (!magnetUri && entry.torrentUrl) {
        try {
          const resolved = await this.resolveRssTorrentSource(entry.torrentUrl);
          magnetUri = resolved.magnetUri;
          torrentDescriptor = resolved.descriptor;
          infoHash = mediaGovernanceMagnetInfoHash(magnetUri);
          entity.infoHash = infoHash;
        } catch {
          magnetUri = null;
        }
      }
      if (!magnetUri) {
        entity.state = 'ignored';
        entity.stateReason = '条目缺少可验证的磁链或固定 torrent 描述符';
        ignored += 1;
        await itemRepository.save(entity);
        continue;
      }
      await itemRepository.save(entity);
      candidates.push({ entity, magnetUri, torrentDescriptor });
    }
    const descriptorUpgradesByTask = new Map<
      string,
      Array<{ descriptor: Buffer; sourceId: string }>
    >();
    for (const upgrade of descriptorUpgrades) {
      const taskUpgrades = descriptorUpgradesByTask.get(upgrade.taskId) ?? [];
      taskUpgrades.push({
        descriptor: upgrade.descriptor,
        sourceId: upgrade.sourceId,
      });
      descriptorUpgradesByTask.set(upgrade.taskId, taskUpgrades);
    }
    for (const [taskId, taskUpgrades] of descriptorUpgradesByTask) {
      await this.mediaTasks.upgradeRssTorrentDescriptors(taskId, taskUpgrades);
    }
    let createdTasks = 0;
    let queued = 0;
    for (let offset = 0; offset < candidates.length; offset += 16) {
      const chunk = candidates.slice(offset, offset + 16);
      try {
        const batch = await this.createMagnetBatchWithRole(
          subscription.seriesId,
          this.requireSeasonWorkId(season),
          season.seasonNumber,
          {
            contentKind:
              subscription.contentKind as MediaGovernanceMagnetBatchCreateDto['contentKind'],
            items: chunk.map((candidate) => ({
              episodeNumber: candidate.entity.episodeNumber!,
              magnetUri: candidate.magnetUri,
            })),
            releaseGroup: subscription.releaseGroup ?? undefined,
          },
          'pending-rss',
          taskIdentity,
          chunk.map((candidate) => candidate.torrentDescriptor),
        );
        createdTasks += 1;
        for (let index = 0; index < chunk.length; index += 1) {
          const candidate = chunk[index];
          candidate.entity.sourceId = batch.sources[index].id;
          candidate.entity.state = 'queued';
          candidate.entity.stateReason = null;
          candidate.entity.taskId = batch.task.id;
          queued += 1;
        }
        await itemRepository.save(chunk.map((candidate) => candidate.entity));
      } catch (error) {
        for (const candidate of chunk) {
          candidate.entity.state = 'failed';
          candidate.entity.stateReason = boundedError(error);
        }
        await itemRepository.save(chunk.map((candidate) => candidate.entity));
      }
    }
    return { createdTasks, discovered, ignored, queued };
  }

  /**
   * 为已经入队但仍只保存裸磁链的 RSS 来源解析同一 Feed 描述符，留待按 Task 原子批量升级。
   * @param item - 已绑定 Task 与来源的 RSS 条目。
   * @param entry - 当前 Feed 中与条目键一致的权威条目。
   * @returns 通过 Task、来源和 BTIH 核对的升级输入；无需升级时返回 `null`。
   * @throws 当 Feed 的 torrent BTIH 与既有来源身份不一致时抛出。
   */
  private async resolveExistingRssTorrentUpgrade(
    item: MediaGovernanceRssItemEntity,
    entry: MediaGovernanceRssEntry,
  ) {
    if (!item.taskId || !item.sourceId || !entry.torrentUrl) return null;
    const expectedInfoHash = item.infoHash;
    if (!expectedInfoHash) return null;
    if (
      !this.mediaTasks.requiresRssTorrentDescriptorUpgrade(
        item.taskId,
        item.sourceId,
        expectedInfoHash,
      )
    ) {
      return null;
    }
    const resolved = await this.resolveRssTorrentSource(entry.torrentUrl);
    if (resolved.infoHash !== expectedInfoHash) {
      throw new Error('media-rss-torrent-infohash-mismatch');
    }
    return {
      descriptor: resolved.descriptor,
      sourceId: item.sourceId,
      taskId: item.taskId,
    };
  }

  /**
   * 从固定来源的 HTTPS torrent enclosure 读取并校验原始描述符，同时给出由真实 `info` 重算的 BTIH。
   * @param torrentUrl - RSS 条目给出的 torrent 描述符地址。
   * @returns 原始描述符、重算的 BTIH 与规范磁链。
   * @throws 主机、重定向、响应大小或描述符身份不符合固定合同时抛出。
   */
  private async resolveRssTorrentSource(torrentUrl: string) {
    const requestedUrl = new URL(torrentUrl);
    if (
      requestedUrl.protocol !== 'https:' ||
      !RSS_TORRENT_HOSTS.has(requestedUrl.hostname) ||
      !/\.torrent$/iu.test(requestedUrl.pathname)
    ) {
      throw new Error('media-rss-torrent-url-rejected');
    }
    const response = await fetch(requestedUrl, {
      headers: { accept: 'application/x-bittorrent' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok || !response.url) {
      throw new Error('media-rss-torrent-response-invalid');
    }
    const finalUrl = new URL(response.url);
    if (
      finalUrl.protocol !== 'https:' ||
      !RSS_TORRENT_HOSTS.has(finalUrl.hostname)
    ) {
      throw new Error('media-rss-torrent-redirect-rejected');
    }
    const descriptor = await this.readBoundedRssTorrent(response);
    const parsed = parseTorrentDescriptor(descriptor);
    return {
      descriptor,
      infoHash: parsed.infoHash,
      magnetUri: `magnet:?xt=urn:btih:${parsed.infoHash}`,
    };
  }

  /**
   * 流式读取 torrent 响应并在超过二 MiB 前取消，避免无 Content-Length 响应绕过边界。
   *
   * @param response - 已通过固定主机和状态校验的 torrent 响应。
   * @returns 不超过二 MiB 的完整描述符字节。
   * @throws 当声明长度或流式正文越过二 MiB，或响应缺少正文时抛出稳定边界错误。
   */
  private async readBoundedRssTorrent(response: Response): Promise<Buffer> {
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > RSS_TORRENT_MAX_BYTES) {
      throw new Error('media-rss-torrent-response-too-large');
    }
    if (!response.body) throw new Error('media-rss-torrent-body-missing');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > RSS_TORRENT_MAX_BYTES) {
        await reader.cancel();
        throw new Error('media-rss-torrent-response-too-large');
      }
      chunks.push(part.value);
    }
    if (total === 0) throw new Error('media-rss-torrent-body-empty');
    return Buffer.concat(chunks);
  }
}
