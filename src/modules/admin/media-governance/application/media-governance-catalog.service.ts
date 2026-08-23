import { createHash, randomUUID } from 'node:crypto';
import {
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { throwVbenError, toKtDateTime } from '@/common';
import type {
  MediaGovernanceEpisodePageQueryDto,
  MediaGovernanceMagnetBatchCreateDto,
  MediaGovernanceRssSubscriptionCreateDto,
  MediaGovernanceRssSubscriptionStateDto,
  MediaGovernanceSeriesPageQueryDto,
  MediaGovernanceSeriesReconcileDto,
} from '@/modules/admin/media-governance/contract/media-governance-catalog.dto';
import {
  MediaGovernanceEpisodeEntity,
  MediaGovernanceRssItemEntity,
  MediaGovernanceRssSubscriptionEntity,
  MediaGovernanceSeasonEntity,
  MediaGovernanceSeriesEntity,
  MediaGovernanceSeriesExternalRefEntity,
  MediaGovernanceTaskEpisodeBindingEntity,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';
import {
  mediaGovernanceMagnetInfoHash,
  mediaGovernanceRssTitleIncluded,
  parseMediaGovernanceEpisodeNumber,
  parseMediaGovernanceRss,
  type MediaGovernanceRssEntry,
} from '@/modules/admin/media-governance/infrastructure/integration/media-governance-rss-parser';
import { MediaGovernanceService } from './media-governance.service';

const RSS_POLL_TICK_MS = 60_000;
const RSS_MAX_BYTES = 2 * 1024 * 1024;

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
 * 把零开始的季号格式化为现有媒体治理任务使用的两位季令牌。
 * @param seasonNumber - 0–99 的 canonical 季号。
 * @returns `S00`–`S99` 季令牌。
 */
function seasonToken(seasonNumber: number): string {
  return `S${String(seasonNumber).padStart(2, '0')}`;
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
  implements OnModuleDestroy, OnModuleInit
{
  private readonly pollingSubscriptions = new Set<string>();
  private rssTimer: null | NodeJS.Timeout = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mediaTasks: MediaGovernanceService,
  ) {}

  onModuleInit() {
    this.rssTimer = setInterval(() => {
      void this.pollDueSubscriptions();
    }, RSS_POLL_TICK_MS);
    this.rssTimer.unref?.();
  }

  onModuleDestroy() {
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
    const [seasons, references, bindings, subscriptions] = await Promise.all([
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
        taskId: string;
      }
    >();
    for (const binding of bindings) {
      const episode = episodes.get(binding.episodeId);
      if (!episode) continue;
      let group = taskGroups.get(binding.taskId);
      if (!group) {
        group = {
          bindingRole: binding.bindingRole,
          episodesBySeason: new Map<number, number[]>(),
          taskId: binding.taskId,
        };
        taskGroups.set(binding.taskId, group);
      }
      const values = group.episodesBySeason.get(episode.seasonNumber) ?? [];
      values.push(episode.episodeNumber);
      group.episodesBySeason.set(episode.seasonNumber, values);
    }
    const taskBindings = [...taskGroups.values()].map((group) => ({
      bindingRole: group.bindingRole,
      seasons: [...group.episodesBySeason.entries()]
        .sort(([left], [right]) => left - right)
        .map(([seasonNumber, values]) => ({
          episodeRanges: compressEpisodeRanges(values),
          seasonNumber,
        })),
      taskId: group.taskId,
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
    return {
      references,
      rssSubscriptions,
      seasons: seasonCards,
      series,
      taskBindings,
    };
  }

  /**
   * 分页返回一季的 canonical Episode，并附带每集当前 Task/来源绑定。
   * @param seriesId - canonical 系列标识。
   * @param seasonNumber - canonical 季号。
   * @param input - 集列表分页参数。
   * @returns 集分页。
   */
  async episodePage(
    seriesId: string,
    seasonNumber: number,
    input: MediaGovernanceEpisodePageQueryDto,
  ) {
    const season = await this.requireSeason(seriesId, seasonNumber);
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
    const taskIds = [
      ...new Set((input.taskBindings ?? []).map((item) => item.taskId)),
    ];
    for (const taskId of taskIds) {
      const task = this.mediaTasks.detail(taskId);
      const metadataIdentity = task.metadataIdentity;
      if (
        task.mediaType !== 'tv' ||
        metadataIdentity?.provider !== input.canonicalProviderRef.provider ||
        metadataIdentity.providerId !==
          input.canonicalProviderRef.providerId.trim()
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
      const seasons = await this.upsertSeasons(manager, series, input);
      await this.replaceTaskBindings(manager, series, seasons, input);
      return series.id;
    });
    return this.detail(seriesId);
  }

  /**
   * 在一季内创建一个执行 Task，并按集写入最多十六条独立主媒体磁链来源。
   * @param seriesId - canonical 系列标识。
   * @param seasonNumber - canonical 季号。
   * @param input - 统一内容类型、发布组和按集磁链。
   * @returns 新 Task、来源与集绑定。
   */
  async createMagnetBatch(
    seriesId: string,
    seasonNumber: number,
    input: MediaGovernanceMagnetBatchCreateDto,
  ) {
    return this.createMagnetBatchWithRole(
      seriesId,
      seasonNumber,
      input,
      'pending-source',
    );
  }

  /**
   * 为系列的一季创建 RSS 订阅，并密封过滤与集号解析正则。
   * @param seriesId - canonical 系列标识。
   * @param seasonNumber - canonical 季号。
   * @param input - 订阅地址、过滤、内容类型与轮询周期。
   * @returns 新订阅。
   */
  async createRssSubscription(
    seriesId: string,
    seasonNumber: number,
    input: MediaGovernanceRssSubscriptionCreateDto,
  ) {
    const season = await this.requireSeason(seriesId, seasonNumber);
    this.assertRssUrl(input.feedUrl);
    this.assertPattern(input.includePattern);
    this.assertPattern(input.episodePattern);
    const repository = this.dataSource.getRepository(
      MediaGovernanceRssSubscriptionEntity,
    );
    const normalizedUrl = new URL(input.feedUrl).href;
    const feedUrlSha256 = createHash('sha256')
      .update(normalizedUrl)
      .digest('hex');
    const duplicate = await repository.findOneBy({ feedUrlSha256, seriesId });
    if (duplicate) {
      throwVbenError('该系列已经存在相同 RSS 地址', HttpStatus.CONFLICT);
    }
    const now = new Date();
    const subscription = repository.create({
      contentKind: input.contentKind,
      enabled: true,
      episodePattern: input.episodePattern?.trim() || null,
      feedUrl: normalizedUrl,
      feedUrlSha256,
      id: `media-rss-subscription-${randomUUID()}`,
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
    return repository.save(subscription);
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
   * 并行聚合系列的季、集、Task 绑定和启用订阅数量，避免卡片把 Task 数误当作品层级。
   * @param series - canonical 系列实体。
   * @returns 系列卡片投影。
   */
  private async projectSeriesCard(series: MediaGovernanceSeriesEntity) {
    const [seasonCount, episodeCount, bindingCount, rssCount] =
      await Promise.all([
        this.dataSource
          .getRepository(MediaGovernanceSeasonEntity)
          .countBy({ seriesId: series.id }),
        this.dataSource
          .getRepository(MediaGovernanceEpisodeEntity)
          .countBy({ seriesId: series.id }),
        this.dataSource
          .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
          .countBy({ seriesId: series.id }),
        this.dataSource
          .getRepository(MediaGovernanceRssSubscriptionEntity)
          .countBy({ enabled: true, seriesId: series.id }),
      ]);
    return {
      ...series,
      bindingCount,
      episodeCount,
      rssCount,
      seasonCount,
    };
  }

  /**
   * 按 Episode 状态分组并叠加 Task 绑定数，形成不依赖历史 Task 季号的季摘要。
   * @param season - canonical 季实体。
   * @returns 季卡片投影。
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
    const bindingCount = await this.dataSource
      .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
      .countBy({ seasonId: season.id });
    return { ...season, bindingCount, statusCounts };
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
      if (
        !season ||
        binding.episodeStart > binding.episodeEnd ||
        binding.episodeEnd > season.episodeCount
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
    let series = await repository.findOneBy({
      canonicalProvider,
      canonicalProviderId,
    });
    if (!series) {
      series = repository.create({
        canonicalProvider,
        canonicalProviderId,
        id: `media-series-${randomUUID()}`,
        mediaType: 'tv',
        originalTitle: input.originalTitle?.trim() || null,
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
   * 将每季收敛为 1..episodeCount；扩展时补集，缩减时只删除未绑定的越界集并保留稳定 ID。
   * @param manager - 当前 TypeORM 事务管理器。
   * @param series - 已持久化的系列主实体。
   * @param input - 季事实集合。
   * @returns 以季号索引的季与 Episode 集合。
   */
  private async upsertSeasons(
    manager: EntityManager,
    series: MediaGovernanceSeriesEntity,
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
      let season = await seasonRepository.findOneBy({
        seasonNumber: inputSeason.seasonNumber,
        seriesId: series.id,
      });
      if (!season) {
        season = seasonRepository.create({
          episodeCount: inputSeason.episodeCount,
          id: `media-season-${randomUUID()}`,
          releaseYear: inputSeason.releaseYear ?? null,
          seasonNumber: inputSeason.seasonNumber,
          seriesId: series.id,
          status: 'known',
          title: inputSeason.title.trim(),
        });
      } else {
        season.title = inputSeason.title.trim();
        season.releaseYear = inputSeason.releaseYear ?? null;
        season.episodeCount = inputSeason.episodeCount;
      }
      season = await seasonRepository.save(season);
      const existing = await episodeRepository.findBy({ seasonId: season.id });
      const episodes = new Map(
        existing.map((episode) => [episode.episodeNumber, episode]),
      );
      const obsolete = existing.filter(
        (episode) => episode.episodeNumber > inputSeason.episodeCount,
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
        let episodeNumber = 1;
        episodeNumber <= inputSeason.episodeCount;
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
   * @param seasonNumber - canonical 季号。
   * @param input - 批量磁链输入。
   * @param bindingRole - 手动或 RSS 创建的绑定角色。
   * @returns 新 Task、来源与集绑定。
   */
  private async createMagnetBatchWithRole(
    seriesId: string,
    seasonNumber: number,
    input: MediaGovernanceMagnetBatchCreateDto,
    bindingRole: 'pending-rss' | 'pending-source',
  ) {
    const series = await this.requireSeries(seriesId);
    const season = await this.requireSeason(seriesId, seasonNumber);
    const episodeNumbers = input.items.map((item) => item.episodeNumber);
    if (new Set(episodeNumbers).size !== episodeNumbers.length) {
      throwVbenError('批量磁链集号不能重复', HttpStatus.BAD_REQUEST);
    }
    if (
      episodeNumbers.some(
        (episodeNumber) =>
          episodeNumber < 1 || episodeNumber > season.episodeCount,
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
    const task = await this.mediaTasks.create({
      mediaType: 'tv',
      providerRef: {
        provider: series.canonicalProvider as 'bangumi' | 'tmdb' | 'tvdb',
        providerId: series.canonicalProviderId,
      },
      releaseYear: series.releaseYear,
      seasonNumbers: [seasonToken(seasonNumber)],
      titleHint: series.title,
    });
    const sources = [];
    for (const item of input.items) {
      const source = await this.mediaTasks.addMagnetSource(task.id, {
        contentKind: input.contentKind,
        expectedRevision: task.revision,
        magnetUri: item.magnetUri,
        releaseGroup: input.releaseGroup,
        seasonNumbers: [seasonToken(seasonNumber)],
        sourceRole: 'primary_media',
      });
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
    return { bindings, sources, task: this.mediaTasks.detail(task.id) };
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
   * 返回系列内存在的 canonical 季，不存在时抛出 404。
   * @param seriesId - 系列标识。
   * @param seasonNumber - canonical 季号。
   * @returns 季实体。
   */
  private async requireSeason(seriesId: string, seasonNumber: number) {
    const season = await this.dataSource
      .getRepository(MediaGovernanceSeasonEntity)
      .findOneBy({ seasonNumber, seriesId });
    if (!season)
      throwVbenError('canonical Season 不存在', HttpStatus.NOT_FOUND);
    return season;
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
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > RSS_MAX_BYTES) {
      throw new Error('media-rss-response-too-large');
    }
    return buffer.toString('utf8');
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
    const itemRepository = this.dataSource.getRepository(
      MediaGovernanceRssItemEntity,
    );
    const candidates: Array<{
      entity: MediaGovernanceRssItemEntity;
      magnetUri: string;
    }> = [];
    let ignored = 0;
    let discovered = 0;
    for (const entry of entries) {
      let infoHash: null | string = null;
      if (entry.magnetUri) {
        try {
          infoHash = mediaGovernanceMagnetInfoHash(entry.magnetUri);
        } catch {
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
      if (duplicate) continue;
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
      const entity = itemRepository.create({
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
      if (
        !entry.magnetUri ||
        !episodeNumber ||
        episodeNumber > season.episodeCount
      ) {
        entity.state = 'ignored';
        entity.stateReason = '条目未命中过滤、集号或磁链合同';
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
      await itemRepository.save(entity);
      candidates.push({ entity, magnetUri: entry.magnetUri });
    }
    let createdTasks = 0;
    let queued = 0;
    for (let offset = 0; offset < candidates.length; offset += 16) {
      const chunk = candidates.slice(offset, offset + 16);
      try {
        const batch = await this.createMagnetBatchWithRole(
          subscription.seriesId,
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
}
