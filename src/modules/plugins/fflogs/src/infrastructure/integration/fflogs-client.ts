import type {
  FflogsCharacterEncounterRankingsResponse,
  FflogsCharacterSummaryResponse,
  FflogsEncounterFightCandidate,
  FflogsEncounterLookup,
  FflogsGraphqlResponse,
  FflogsHttpMethod,
  FflogsLocalizationMaps,
  FflogsParseMetric,
  FflogsRankingItem,
  FflogsRecentReport,
  FflogsReportFight,
  FflogsReportFightMetricsResponse,
  FflogsTokenResponse,
  FflogsCharacterSummaryInput,
  FflogsCharacterSummaryResult,
  FflogsEncounterLogItem,
} from '../../domain/fflogs.types';
import type { FflogsKnownWorldResolver } from '../../application/fflogs-input-parser';
import { resolveFflogsConfig } from '../../config/fflogs-config';
import { FflogsOAuthTokenCache } from '../storage/oauth-token-cache';
import {
  buildFf14MarketCatalog,
  buildFf14MarketCatalogFromTree,
  isFf14LocationName,
  PLUGIN_FF14_MARKET_DICT_CODES,
  splitFf14WorldPath,
  type Ff14DictItem,
} from '../../../../ff14-market/src/domain/ff14-worlds';

const FFLOGS_LOCALIZATION_DICT_CODES = {
  job: 'FFLOGS_JOB_LABEL',
  metric: 'FFLOGS_METRIC_LABEL',
  role: 'FFLOGS_ROLE_LABEL',
  serverRegion: 'FFLOGS_SERVER_REGION_LABEL',
};

type FflogsEncounterCatalogItem = {
  displayName: string;
  encounterId: number;
  keys: string[];
  zoneId?: number;
  zoneName?: string;
};

export type FflogsPluginHost = {
  getConfig: <T = string>(key: string) => T | undefined;
  getDictByKey?: (
    dictCode: string,
  ) => Promise<Array<{ label?: string; value?: string }>>;
  getDictItemsByKey?: (dictCode: string) => Promise<Ff14DictItem[]>;
  relationTree?: (input: { dictCode: string }) => Promise<Ff14DictItem[]>;
  requestJson: <T>(options: {
    body?: string;
    context: string;
    failureMessage: (statusCode: number) => string;
    headers?: Record<string, string>;
    invalidJsonMessage: string;
    method?: FflogsHttpMethod;
    timeoutMessage: string;
    timeoutMs: number;
    url: URL;
  }) => Promise<T>;
  resolveKnownWorld?: (
    value: string,
  ) => Promise<null | { serverSlug?: string }>;
};

export class FflogsClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private encounterCatalogCache?: {
    entries: FflogsEncounterCatalogItem[];
    expiresAt: number;
  };
  private readonly graphqlUrl: string;
  private readonly tokenUrl: string;
  private readonly tokenCache = new FflogsOAuthTokenCache();
  private readonly webBaseUrl: string;

  constructor(private readonly host: FflogsPluginHost) {
    const config = resolveFflogsConfig(host);
    this.webBaseUrl = config.webBaseUrl;
    this.graphqlUrl = config.graphqlUrl;
    this.tokenUrl = config.tokenUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  /**
   * 校验当前运行态是否满足健康状态约束，并拒绝不合法输入；从 `getAccessToken` 读取健康状态。
   * @returns 满足健康状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async checkHealth() {
    await this.getAccessToken();
    return true;
  }

  /**
   * 按`params`读取角色摘要；当 `encounterInput` 成立时返回 `this.getCharacterEncounterLogs({ ...params,…`。
   * @param params - 用于角色摘要的领域对象，包含 `characterName`、`character`、`serverSlug`、`server` 字段。
   * @returns 包含 `allStarText`、`characterId`、`characterName`、`rankings`、`replyText` 字段的角色摘要。
   * @throws 当 `!characterName` 成立时拒绝当前输入并抛出 `Error`；当 `!serverSlug` 成立时拒绝当前输入并抛出 `Error`；当 `!serverRegion` 成立时拒绝当前输入并抛出 `Error`；当 `!character` 成立时拒绝当前输入并抛出 `Error`。
   */
  async getCharacterSummary(
    params: FflogsCharacterSummaryInput,
  ): Promise<FflogsCharacterSummaryResult> {
    const characterName = `${
      params.characterName || params.character || ''
    }`.trim();
    const serverSlug = `${
      params.serverSlug || params.server || this.getDefaultServer()
    }`.trim();
    const serverRegion = `${
      params.serverRegion || this.getDefaultServerRegion()
    }`.trim();

    if (!characterName) throw new Error('请提供 FFLogs 角色名');
    if (!serverSlug) throw new Error('请提供 FFLogs 服务器名');
    if (!serverRegion)
      throw new Error('请提供 FFLogs 服务器地区，如 CN/JP/NA/EU');

    const encounterInput = this.normalizeEncounterInput(params);
    if (encounterInput) {
      return this.getCharacterEncounterLogs({
        ...params,
        characterName,
        encounter: encounterInput,
        serverRegion,
        serverSlug,
      });
    }

    const variables = {
      characterName,
      className: this.normalizeOptionalString(params.className),
      difficulty: this.toOptionalNumber(params.difficulty),
      metric: this.normalizeMetric(params.metric),
      partition: this.toOptionalNumber(params.partition),
      role: this.normalizeRole(params.role),
      serverRegion: serverRegion.toUpperCase(),
      serverSlug,
      size: this.toOptionalNumber(params.size),
      specName: this.normalizeOptionalString(params.specName),
      timeframe: this.normalizeTimeframe(params.timeframe),
      zoneID: this.toOptionalNumber(params.zoneId),
    };

    const data = await this.requestGraphql<FflogsCharacterSummaryResponse>(
      `query FflogsCharacterSummary(
        $characterName: String!
        $serverSlug: String!
        $serverRegion: String!
        $zoneID: Int
        $difficulty: Int
        $metric: CharacterPageRankingMetricType
        $partition: Int
        $size: Int
        $specName: String
        $className: String
        $role: RoleType
        $timeframe: RankingTimeframeType
      ) {
        characterData {
          character(
            name: $characterName
            serverSlug: $serverSlug
            serverRegion: $serverRegion
          ) {
            id
            lodestoneID
            name
            server {
              name
              slug
            }
            zoneRankings(
              zoneID: $zoneID
              difficulty: $difficulty
              metric: $metric
              partition: $partition
              size: $size
              specName: $specName
              className: $className
              role: $role
              timeframe: $timeframe
            )
          }
        }
      }`,
      variables,
    );

    const character = data.characterData?.character;
    if (!character) {
      throw new Error(
        `未找到 FFLogs 角色：${characterName} / ${serverRegion} / ${serverSlug}`,
      );
    }

    const rankingsPayload = this.normalizeJsonPayload(character.zoneRankings);
    const rankings = this.pickRankings(rankingsPayload).slice(0, 5);
    const allStarText = this.pickAllStarText(rankingsPayload);
    const serverName = character.server?.name || serverSlug;
    const url = this.buildCharacterUrl(
      serverRegion,
      character.server?.slug || serverSlug,
      character.name || characterName,
    );
    const localizationMaps = await this.getLocalizationMaps();

    return {
      allStarText,
      characterId: character.id,
      characterName: character.name || characterName,
      rankings,
      replyText: this.buildReplyText({
        allStarText,
        characterId: character.id,
        characterName: character.name || characterName,
        metric: variables.metric || 'dps',
        rankings,
        localizationMaps,
        serverName,
        serverRegion,
        url,
      }),
      serverName,
      serverRegion,
      url,
    };
  }

  /**
   * 根据`candidates`构造Known世界服解析器。
   * @param candidates - 决定是否启用“candidates”分支的布尔选项。
   * @returns Known世界服解析器；无法解析或未命中时为 `null`。
   */
  async buildKnownWorldResolver(
    candidates: string[],
  ): Promise<FflogsKnownWorldResolver> {
    const resolved = new Map<string, null | { serverSlug?: string }>();
    await Promise.all(
      candidates.map(async (candidate) => {
        const key = `${candidate || ''}`.trim();
        if (!key || resolved.has(key)) return;
        resolved.set(key, await this.resolveKnownWorld(key));
      }),
    );
    return (value: string) => resolved.get(value) || null;
  }

  /**
   * 从`value`解析已知的大区；当 `this.host.resolveKnownWorld` 成立时返回 `this.host.resolveKnownWorld(value)`。
   * @param value - 参与已知的大区比较、格式化或输出的候选值。
   * @returns 包含 `serverSlug` 字段的已知的大区；无法解析或未命中时为 `null`。
   */
  async resolveKnownWorld(value: string) {
    if (this.host.resolveKnownWorld) {
      return this.host.resolveKnownWorld(value);
    }

    const catalog = await this.loadFf14MarketCatalog();
    if (!isFf14LocationName(catalog, value)) return null;
    const worldPath = splitFf14WorldPath(value);
    return {
      serverSlug: worldPath.world || value,
    };
  }

  /**
   * 按`params`读取角色战斗记录日志集合；从 `getDefaultServer` 读取角色战斗记录日志集合。
   * @param params - 用于角色战斗记录日志集合的领域对象，包含 `characterName`、`character`、`serverSlug`、`server` 字段。
   * @returns 包含 `characterId`、`characterName`、`encounterName`、`encounterSuggestions`、`logs` 字段的角色战斗记录日志集合。
   * @throws 当 `!encounterInput` 成立时拒绝当前输入并抛出 `Error`；当 `!character` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async getCharacterEncounterLogs(
    params: FflogsCharacterSummaryInput,
  ): Promise<FflogsCharacterSummaryResult> {
    const characterName = `${
      params.characterName || params.character || ''
    }`.trim();
    const serverSlug = `${
      params.serverSlug || params.server || this.getDefaultServer()
    }`.trim();
    const serverRegion = `${
      params.serverRegion || this.getDefaultServerRegion()
    }`.trim();
    const encounterInput = this.normalizeEncounterInput(params);
    if (!encounterInput) throw new Error('请提供 FFLogs 高难任务名');

    const limit = this.toLimitedPositiveNumber(params.limit, 10, 1, 10);
    const reportsLimit = this.toLimitedPositiveNumber(
      params.reportsLimit,
      Math.max(limit * 5, 20),
      1,
      50,
    );
    const encounterLookup = await this.resolveEncounterLookup(encounterInput);
    const variables = {
      characterName,
      reportsLimit,
      serverRegion: serverRegion.toUpperCase(),
      serverSlug,
    };

    const data = await this.requestGraphql<FflogsCharacterSummaryResponse>(
      `query FflogsCharacterEncounterReports(
        $characterName: String!
        $serverSlug: String!
        $serverRegion: String!
        $reportsLimit: Int
      ) {
        characterData {
          character(
            name: $characterName
            serverSlug: $serverSlug
            serverRegion: $serverRegion
          ) {
            id
            lodestoneID
            name
            server {
              name
              slug
            }
            zoneRankings(metric: dps)
            recentReports(limit: $reportsLimit) {
              data {
                code
                title
                startTime
                endTime
                zone {
                  id
                  name
                }
                fights(translate: true) {
                  id
                  name
                  encounterID
                  difficulty
                  kill
                  startTime
                  endTime
                }
              }
            }
          }
        }
      }`,
      variables,
    );

    const character = data.characterData?.character;
    if (!character) {
      throw new Error(
        `未找到 FFLogs 角色：${characterName} / ${serverRegion} / ${serverSlug}`,
      );
    }

    const localizationMaps = await this.getLocalizationMaps();
    const serverName = character.server?.name || serverSlug;
    const url = this.buildCharacterUrl(
      serverRegion,
      character.server?.slug || serverSlug,
      character.name || characterName,
    );
    const replyUrl = this.buildCharacterEncounterUrl(
      url,
      encounterLookup,
      params.partition,
    );
    const difficulty = this.toOptionalNumber(params.difficulty);
    const encounterNameById = this.buildRankingEncounterNameById(
      character.zoneRankings,
    );
    const candidates = this.pickEncounterFightCandidates(
      character.recentReports?.data || [],
      encounterLookup,
      difficulty,
      encounterNameById,
    );
    const metricCandidates = candidates.slice(0, Math.min(limit * 3, 30));
    const encounterName = this.pickText(
      encounterLookup.displayName,
      candidates[0]?.fight?.name,
    );
    const encounterSuggestions = (() => {
      if (candidates.length) {
        return [];
      }
      return this.pickRecentEncounterSuggestions(
          character.recentReports?.data || [],
          encounterNameById,
        );
    })();
    const rankingSuggestions = (() => {
      if (candidates.length) {
        return [];
      }
      return this.pickRankingEncounterSuggestions(character.zoneRankings);
    })();

    const rankingLogs = await (async () => {
        if (encounterLookup.encounterId !== undefined) {
          return await this.getEncounterRankingLogs({
            characterName: character.name || characterName,
            encounterLookup,
            limit,
            partition: params.partition,
            serverRegion,
            serverSlug: character.server?.slug || serverSlug,
            timeframe: params.timeframe,
          });
        }
        return [];
      })();
    const fallbackLogs = await (async () => {
      if (rankingLogs.length) {
        return [];
      }
      return (
          await Promise.all(
            metricCandidates.map((candidate) =>
              this.getEncounterFightLog({
                candidate,
                characterId: character.id,
                characterName: character.name || characterName,
                encounterNameById,
                encounterLookup,
                localizationMaps,
                serverName,
                serverRegion,
                serverSlug: character.server?.slug || serverSlug,
              }),
            ),
          )
        )
          .filter(Boolean)
          .slice(0, limit);
    })();
    const logs = (() => {
      if (rankingLogs.length) {
        return rankingLogs;
      }
      return fallbackLogs;
    })();

    return {
      characterId: character.id,
      characterName: character.name || characterName,
      encounterName,
      encounterSuggestions,
      logs,
      rankingSuggestions,
      rankings: [],
      replyText: this.buildEncounterLogsReplyText({
        characterId: character.id,
        characterName: character.name || characterName,
        encounterName,
        encounterSuggestions,
        logs,
        localizationMaps,
        rankingSuggestions,
        serverName,
        serverRegion,
        url: replyUrl,
      }),
      serverName,
      serverRegion,
      url: replyUrl,
    };
  }

  /**
   * 通过 `toOptionalNumber` 收敛领域表示。
   * @param params - 用于战斗记录排名数据日志集合的领域对象，包含 `encounterLookup`、`characterName`、`partition`、`serverRegion` 字段。
   * @returns 战斗记录排名数据日志集合。
   */
  private async getEncounterRankingLogs(params: {
    characterName: string;
    encounterLookup: FflogsEncounterLookup;
    limit: number;
    partition?: number | string;
    serverRegion: string;
    serverSlug: string;
    timeframe?: string;
  }) {
    if (params.encounterLookup.encounterId === undefined) return [];
    const data =
      await this.requestGraphql<FflogsCharacterEncounterRankingsResponse>(
        `query FflogsCharacterEncounterRankings(
          $characterName: String!
          $serverSlug: String!
          $serverRegion: String!
          $encounterID: Int!
          $partition: Int
          $timeframe: RankingTimeframeType
        ) {
          characterData {
            character(
              name: $characterName
              serverSlug: $serverSlug
              serverRegion: $serverRegion
            ) {
              dpsRankings: encounterRankings(
                encounterID: $encounterID
                metric: dps
                partition: $partition
                timeframe: $timeframe
              )
              hpsRankings: encounterRankings(
                encounterID: $encounterID
                metric: hps
                partition: $partition
                timeframe: $timeframe
              )
            }
          }
        }`,
        {
          characterName: params.characterName,
          encounterID: params.encounterLookup.encounterId,
          partition: this.toOptionalNumber(params.partition),
          serverRegion: params.serverRegion.toUpperCase(),
          serverSlug: params.serverSlug,
          timeframe: this.normalizeTimeframe(params.timeframe) || 'Historical',
        },
      );
    const character = data.characterData?.character;
    if (!character) return [];
    const dpsPayload = this.normalizeJsonPayload(character.dpsRankings) as any;
    const hpsPayload = this.normalizeJsonPayload(character.hpsRankings) as any;
    const dpsRanks = (() => {
      if (Array.isArray(dpsPayload?.ranks)) {
        return dpsPayload.ranks;
      }
      return [];
    })();
    const hpsRanks = (() => {
      if (Array.isArray(hpsPayload?.ranks)) {
        return hpsPayload.ranks;
      }
      return [];
    })();
    const hpsByFight = new Map<string, any>();
    for (const rank of hpsRanks) {
      const key = this.buildRankingFightKey(rank);
      if (key) hpsByFight.set(key, rank);
    }
    return dpsRanks
      .map((rank) =>
        this.buildEncounterRankingLogItem(
          rank,
          hpsByFight.get(this.buildRankingFightKey(rank)),
          params.encounterLookup,
        ),
      )
      .filter(Boolean)
      .sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0))
      .slice(0, params.limit);
  }

  /**
   * 根据`damageRank`、`healingRank`、`encounterLookup`构造战斗记录排名数据日志条目；从 `getParseColor` 读取战斗记录排名数据日志条目。
   * @param damageRank - 限制战斗记录排名数据日志条目数量、尺寸、等级或重试边界的数值。
   * @param healingRank - 限制战斗记录排名数据日志条目数量、尺寸、等级或重试边界的数值。
   * @param encounterLookup - 用于战斗记录排名数据日志条目的领域对象，包含 `displayName` 字段。
   * @returns 包含 `adps`、`color`、`damageScore`、`dps`、`durationMs` 字段的战斗记录排名数据日志条目；无法解析或未命中时为 `null`。
   */
  private buildEncounterRankingLogItem(
    damageRank: any,
    healingRank: any,
    encounterLookup: FflogsEncounterLookup,
  ): FflogsEncounterLogItem | null {
    const code = `${damageRank?.report?.code || ''}`.trim();
    const fightId = this.toOptionalNumber(damageRank?.report?.fightID);
    if (!code || fightId === undefined) return null;
    const damageScore = this.pickNumber(
      damageRank?.rankPercent,
      damageRank?.historicalPercent,
      damageRank?.todayPercent,
    );
    const healingScore = this.pickNumber(
      healingRank?.rankPercent,
      healingRank?.historicalPercent,
      healingRank?.todayPercent,
    );
    return {
      adps: this.pickNumber(damageRank?.aDPS, damageRank?.cDPS),
      color: this.getParseColor(damageScore),
      damageScore,
      dps: this.pickNumber(damageRank?.amount, damageRank?.pDPS),
      durationMs: this.pickNumber(damageRank?.duration),
      encounterName: encounterLookup.displayName,
      fightId,
      healingColor: this.getParseColor(healingScore),
      healingScore,
      hps: this.pickNumber(healingRank?.amount),
      kill: true,
      logCode: code,
      logUrl: this.buildReportFightUrl(code, fightId),
      ndps: this.pickNumber(damageRank?.nDPS),
      rdps: this.pickNumber(damageRank?.rDPS),
      startTime: this.pickNumber(
        damageRank?.startTime,
        damageRank?.report?.startTime,
      ),
    };
  }

  /**
   * 根据`rank`构造排名数据Fight键；当 `code && fightId !== undefined` 成立时返回 ``${code}#${fightId}``。
   * @param rank - 用于排名数据Fight键的领域对象，包含 `report` 字段。
   * @returns 当前状态对应的排名数据Fight键，取值为 `''`。
   */
  private buildRankingFightKey(rank: any) {
    const code = `${rank?.report?.code || ''}`.trim();
    const fightId = this.toOptionalNumber(rank?.report?.fightID);
    if (code && fightId !== undefined) {
      return `${code}#${fightId}`;
    }
    return '';
  }

  /**
   * 按`params`读取战斗记录Fight日志；当 `!code || fightId === undefined || encounterId === undefined` 成立时返回 `null`。
   * @param params - 用于战斗记录Fight日志的领域对象，包含 `characterId`、`characterName`、`serverName`、`serverRegion` 字段。
   * @returns 包含 `adps`、`color`、`damageScore`、`dps`、`durationMs` 字段的战斗记录Fight日志；无法解析或未命中时为 `null`。
   */
  private async getEncounterFightLog(params: {
    candidate: FflogsEncounterFightCandidate;
    characterId?: number;
    characterName: string;
    encounterNameById: Map<number, string>;
    encounterLookup: FflogsEncounterLookup;
    localizationMaps: FflogsLocalizationMaps;
    serverName: string;
    serverRegion: string;
    serverSlug: string;
  }): Promise<FflogsEncounterLogItem | null> {
    const { candidate } = params;
    const code = `${candidate.report.code || ''}`.trim();
    const fightId = this.toOptionalNumber(candidate.fight.id);
    const encounterId = this.toOptionalNumber(candidate.fight.encounterID);
    if (!code || fightId === undefined || encounterId === undefined) {
      return null;
    }

    const data = await this.requestGraphql<FflogsReportFightMetricsResponse>(
      `query FflogsEncounterFightMetrics(
        $code: String!
        $encounterID: Int!
        $fightIDs: [Int]
      ) {
        reportData {
          report(code: $code) {
            dpsRankings: rankings(
              encounterID: $encounterID
              fightIDs: $fightIDs
              playerMetric: dps
            )
            hpsRankings: rankings(
              encounterID: $encounterID
              fightIDs: $fightIDs
              playerMetric: hps
            )
            damage: table(
              dataType: DamageDone
              encounterID: $encounterID
              fightIDs: $fightIDs
              translate: true
            )
            healing: table(
              dataType: Healing
              encounterID: $encounterID
              fightIDs: $fightIDs
              translate: true
            )
          }
        }
      }`,
      {
        code,
        encounterID: encounterId,
        fightIDs: [fightId],
      },
    );

    const report = data.reportData?.report;
    if (!report) return null;

    const target = {
      characterId: params.characterId,
      characterName: params.characterName,
      serverName: params.serverName,
      serverRegion: params.serverRegion,
      serverSlug: params.serverSlug,
    };
    const damageRanking = this.extractParseMetric(
      this.findRankingCharacter(report.dpsRankings, target),
    );
    const healingRanking = this.extractParseMetric(
      this.findRankingCharacter(report.hpsRankings, target),
    );
    const damageEntry = this.findTableEntry(report.damage, target);
    const healingEntry = this.findTableEntry(report.healing, target);
    if (
      !damageEntry &&
      !healingEntry &&
      damageRanking.amount === undefined &&
      healingRanking.amount === undefined
    ) {
      return null;
    }
    const damagePayload = this.normalizeJsonPayload(report.damage) as any;
    const healingPayload = this.normalizeJsonPayload(report.healing) as any;
    const combatTimeMs = this.pickNumber(
      damagePayload?.data?.combatTime,
      healingPayload?.data?.combatTime,
      (candidate.fight.endTime || 0) - (candidate.fight.startTime || 0),
    );
    const encounterName = this.localizeEncounter(
      this.pickText(
        params.encounterNameById.get(encounterId),
        candidate.fight.name,
        params.encounterLookup.displayName,
        `任务 ${candidate.fight.encounterID || ''}`,
      ),
    );

    return {
      adps: this.toPerSecond(damageEntry?.totalADPS, combatTimeMs),
      color: damageRanking.color,
      damageScore: damageRanking.percent,
      dps:
        damageRanking.amount ||
        this.toPerSecond(damageEntry?.total, combatTimeMs),
      durationMs: combatTimeMs,
      encounterName,
      fightId,
      healingColor: healingRanking.color,
      healingScore: healingRanking.percent,
      hps:
        healingRanking.amount ||
        this.toPerSecond(healingEntry?.total, combatTimeMs),
      kill: candidate.fight.kill,
      logCode: code,
      logUrl: this.buildReportFightUrl(code, fightId),
      ndps: this.toPerSecond(damageEntry?.totalNDPS, combatTimeMs),
      rdps: this.toPerSecond(damageEntry?.totalRDPS, combatTimeMs),
      reportTitle: candidate.report.title,
      startTime: candidate.absoluteStartTime,
    };
  }

  /**
   * 按当前运行态读取访问权限令牌；同步更新对应缓存或去重状态（`tokenCache.setToken`）。
   * @returns 访问权限令牌。
   * @throws 当 `!this.clientId || !this.clientSecret` 成立时拒绝当前输入并抛出 `Error`；当 `!data.access_token` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async getAccessToken() {
    const cached = this.tokenCache.getValidToken();
    if (cached) return cached;
    if (!this.clientId || !this.clientSecret) {
      throw new Error('未配置 FFLOGS_CLIENT_ID / FFLOGS_CLIENT_SECRET');
    }

    const body = 'grant_type=client_credentials';
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      'base64',
    );
    const data = await this.requestJson<FflogsTokenResponse>(
      new URL(this.tokenUrl),
      'POST',
      {
        body,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
    if (!data.access_token) throw new Error('FFLogs 未返回 access_token');
    const expiresIn = Number(data.expires_in || 3600);
    this.tokenCache.setToken(data.access_token, expiresIn);
    return data.access_token;
  }

  /**
   * 按`query`、`variables`投递GraphQL 响应数据；从 `getAccessToken` 读取GraphQL 响应数据。
   * @param query - 要发送给 FFLogs GraphQL 接口的查询文档。
   * @param variables - 绑定到 GraphQL 查询变量名的参数对象。
   * @returns GraphQL 响应中的 `data` 字段；响应包含 `errors` 或缺少数据时抛出接口错误。
   * @throws 当 `response.errors?.length` 成立时拒绝当前输入并抛出 `Error`；当 `!response.data` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async requestGraphql<T>(
    query: string,
    variables: Record<string, any>,
  ) {
    const token = await this.getAccessToken();
    const response = await this.requestJson<FflogsGraphqlResponse<T>>(
      new URL(this.graphqlUrl),
      'POST',
      {
        body: JSON.stringify({
          query,
          variables: this.removeUndefined(variables),
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (response.errors?.length) {
      const message = response.errors
        .map((item) => item.message)
        .filter(Boolean)
        .join('; ');
      throw new Error(message || 'FFLogs GraphQL 查询失败');
    }
    if (!response.data) throw new Error('FFLogs GraphQL 未返回 data');
    return response.data;
  }

  /**
   * 按`url`、`method`、`options`投递JSON 数据；从 `getTimeoutMs` 读取JSON 数据。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @param method - 决定JSON 数据内容、边界或目标的 `method` 值。
   * @param options - 控制JSON 数据筛选、缓存或输出方式的可选项，包含 `body`、`headers` 字段；省略时默认采用 `{}`。
   * @returns JSON 数据。
   */
  private requestJson<T>(
    url: URL,
    method: FflogsHttpMethod,
    options: { body?: string; headers?: Record<string, string> } = {},
  ) {
    return this.host.requestJson<T>({
      body: options.body,
      context: 'FFLogs',
      failureMessage: (statusCode) => `FFLogs 请求失败：${statusCode}`,
      headers: options.headers,
      invalidJsonMessage: 'FFLogs 返回不是合法 JSON',
      method,
      timeoutMessage: 'FFLogs 请求超时',
      timeoutMs: this.getTimeoutMs(),
      url,
    });
  }

  /**
   * 将角色、服务器、可选角色标识与全星数据、公开排名和查询链接排版为战绩回复。
   * @param params - 战绩展示资料；排名为空时显示无公开排名提示，可选角色标识与全星文本会按存在性加入。
   * @returns 包含本地化服务器地域、排名明细或缺省提示以及展示链接的多行回复文本。
   */
  private buildReplyText(params: {
    allStarText?: string;
    characterId?: number;
    characterName: string;
    localizationMaps: FflogsLocalizationMaps;
    metric: string;
    rankings: FflogsRankingItem[];
    serverName: string;
    serverRegion: string;
    url: string;
  }) {
    const region = this.localizeServerRegion(
      params.serverRegion,
      params.localizationMaps,
    );
    const header = `FFLogs 战绩：${params.characterName} @ ${params.serverName}（${region}）`;
    const idText = (() => {
      if (params.characterId) {
        return `角色ID：${params.characterId}`;
      }
      return '';
    })();
    const rankingText = (() => {
      if (params.rankings.length) {
        return [
          '公开排名：',
          ...params.rankings.map((item, index) =>
            this.formatRanking(
              item,
              index,
              params.metric,
              params.localizationMaps,
            ),
          ),
        ].join('\n');
      }
      return '公开排名：暂无公开排名数据';
    })();
    return [
      header,
      idText,
      params.allStarText,
      rankingText,
      this.formatDisplayUrl(params.url),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 将角色与副本信息、最近战斗记录和查询链接排版为回复，记录为空时改列可查副本建议。
   * @param params - 最近战斗查询资料；提供记录列表、可选角色标识以及无记录时使用的副本建议。
   * @returns 包含角色、副本、逐条记录或无记录建议及展示链接的多行回复文本。
   */
  private buildEncounterLogsReplyText(params: {
    characterId?: number;
    characterName: string;
    encounterName: string;
    encounterSuggestions?: string[];
    localizationMaps: FflogsLocalizationMaps;
    logs: FflogsEncounterLogItem[];
    rankingSuggestions?: string[];
    serverName: string;
    serverRegion: string;
    url: string;
  }) {
    const region = this.localizeServerRegion(
      params.serverRegion,
      params.localizationMaps,
    );
    const header = `FFLogs 最近10次记录`;
    const characterText = `角色：${params.characterName} @ ${params.serverName}（${region}）`;
    const encounterText = `任务：${params.encounterName}`;
    const idText = (() => {
      if (params.characterId) {
        return `角色ID：${params.characterId}`;
      }
      return '';
    })();
    const logText = (() => {
      if (params.logs.length) {
        return [
          ...params.logs.map((item, index) =>
            this.formatEncounterLogLine(item, index),
          ),
        ].join('\n');
      }
      return [
          '暂无匹配的公开记录',
          this.formatSuggestionLine(
            '最近报告中可查',
            params.encounterSuggestions,
          ),
          this.formatSuggestionLine(
            '公开排名中可查',
            params.rankingSuggestions,
          ),
        ]
          .filter(Boolean)
          .join('\n');
    })();

    return [
      header,
      characterText,
      encounterText,
      idText,
      '',
      logText,
      '',
      this.formatDisplayUrl(params.url),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 将一次战斗的击杀状态、评分、伤害与治疗指标以及报告链接排版为编号日志段。
   * @param item - 单次战斗记录；缺失击杀状态显示“未知”，缺失伤害或治疗评分显示连字符。
   * @param index - 战斗记录在回复中的零基位置，展示时转换为从一开始的编号。
   * @returns 占四行的战斗记录文本，包含时间、副本、指标和可访问链接。
   */
  private formatEncounterLogLine(item: FflogsEncounterLogItem, index: number) {
    const status =
      (() => {
        if (item.kill === true) {
          return '击杀';
        }
        if (item.kill === false) {
          return '灭团';
        }
        return '未知';
      })();
    const damageScore =
      (() => {
        if (item.damageScore !== undefined) {
          return `${this.formatNumber(item.damageScore)}`;
        }
        return '-';
      })();
    const healingScore =
      (() => {
        if (item.healingScore !== undefined) {
          return `${this.formatNumber(item.healingScore)}`;
        }
        return '-';
      })();
    const metrics = [
      `D${this.formatMetricNumber(item.dps)}`,
      `aD${this.formatMetricNumber(item.adps)}`,
      `rD${this.formatMetricNumber(item.rdps)}`,
      `nD${this.formatMetricNumber(item.ndps)}`,
      `H${this.formatMetricNumber(item.hps)}`,
    ].join('/');
    return [
      `${index + 1}. ${this.formatLogTime(item.startTime)}｜${status}｜${item.encounterName}`,
      `   颜色:D${item.color}/H${item.healingColor}｜评分:D${damageScore}/H${healingScore}`,
      `   ${metrics}`,
      `   ${this.formatDisplayUrl(item.logUrl)}`,
    ].join('\n');
  }

  /**
   * 从`reports`、`encounterLookup`、`difficulty`筛选战斗记录FightCandidates，并保持保留项的原有顺序与键名。
   * @param reports - 决定战斗记录FightCandidates内容、边界或目标的 `reports` 值。
   * @param encounterLookup - 决定战斗记录FightCandidates内容、边界或目标的 `encounterLookup` 值。
   * @param difficulty - 决定战斗记录FightCandidates内容、边界或目标的 `difficulty` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param encounterNameById - 用于精确定位战斗记录名称的标识；省略时默认采用 `new Map<number, string>()`。
   * @returns 战斗记录FightCandidates。
   */
  private pickEncounterFightCandidates(
    reports: FflogsRecentReport[],
    encounterLookup: FflogsEncounterLookup,
    difficulty?: number,
    encounterNameById = new Map<number, string>(),
  ) {
    return reports
      .flatMap((report) =>
        (report.fights || []).map((fight) => ({
          absoluteStartTime:
            Number(report.startTime || 0) + Number(fight.startTime || 0),
          fight,
          report,
        })),
      )
      .filter(({ fight }) =>
        this.matchEncounterFight(fight, encounterLookup, encounterNameById),
      )
      .filter(
        ({ fight }) =>
          difficulty === undefined || Number(fight.difficulty) === difficulty,
      )
      .sort((a, b) => b.absoluteStartTime - a.absoluteStartTime);
  }

  /**
   * 通过 `reports.flatMap` 遍历或定位集合元素。
   * @param reports - 决定最近日志战斗记录Suggestions内容、边界或目标的 `reports` 值。
   * @param encounterNameById - 用于精确定位战斗记录名称的标识；省略时默认采用 `new Map<number, string>()`。
   * @returns 最近日志战斗记录Suggestions。
   */
  private pickRecentEncounterSuggestions(
    reports: FflogsRecentReport[],
    encounterNameById = new Map<number, string>(),
  ) {
    const names = reports.flatMap((report) =>
      (report.fights || []).map((fight) =>
        this.pickText(
          encounterNameById.get(this.toOptionalNumber(fight.encounterID) || 0),
          fight.name,
        ),
      ),
    );
    return this.pickDistinctSuggestions(names, 8);
  }

  /**
   * 从`payload`筛选排名数据战斗记录Suggestions，并保持保留项的原有顺序与键名。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   * @returns 排名数据战斗记录Suggestions。
   */
  private pickRankingEncounterSuggestions(payload: unknown) {
    const rankingsPayload = this.normalizeJsonPayload(payload) as any;
    const rankings = this.pickRankings(rankingsPayload);
    const names = rankings.map((item) =>
      this.pickText(item.encounter?.name, item.encounterName, item.name),
    );
    return this.pickDistinctSuggestions(names, 8);
  }

  /**
   * 根据`payload`构造排名数据战斗记录名称标识；同步更新对应缓存或去重状态（`map.set`）。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   * @returns 排名数据战斗记录名称标识。
   */
  private buildRankingEncounterNameById(payload: unknown) {
    const rankingsPayload = this.normalizeJsonPayload(payload) as any;
    const rankings = this.pickRankings(rankingsPayload);
    const map = new Map<number, string>();
    for (const item of rankings) {
      const id = this.pickNumber(item.encounter?.id, item.encounterID, item.id);
      const name = this.pickText(
        item.encounter?.name,
        item.encounterName,
        item.name,
      );
      if (id !== undefined && name) map.set(id, name);
    }
    return map;
  }

  /**
   * 从`values`、`limit`筛选DistinctSuggestions，并保持保留项的原有顺序与键名。
   * @param values - 按原有顺序参与DistinctSuggestions筛选、合并或汇总的集合。
   * @param limit - 允许返回或处理的DistinctSuggestions最大数量。
   * @returns 忽略空值与 `unknown` 后按规范键去重的建议列表，数量不超过给定上限。
   */
  private pickDistinctSuggestions(values: any[], limit: number) {
    const suggestions: string[] = [];
    const keys = new Set<string>();
    for (const value of values) {
      const text = `${value || ''}`.trim();
      if (!text || text.toLowerCase() === 'unknown') continue;
      const key = this.normalizeLookupKey(text);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      suggestions.push(text);
      if (suggestions.length >= limit) break;
    }
    return suggestions;
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param label - 决定Suggestion文本行内容、边界或目标的 `label` 值。
   * @param values - 按原有顺序参与Suggestion文本行筛选、合并或汇总的集合；为空时采用 `[]` 作为兜底。
   * @returns 当前状态对应的Suggestion文本行，取值为 `''`。
   */
  private formatSuggestionLine(label: string, values?: string[]) {
    const list = (values || []).filter(Boolean);
    if (list.length) {
      return `${label}：${list.join('、')}`;
    }
    return '';
  }

  /**
   * 通过 `toOptionalNumber` 收敛领域表示。
   * @param fight - 用于战斗记录Fight的领域对象，包含 `encounterID`、`name` 字段。
   * @param encounterLookup - 用于战斗记录Fight的领域对象，包含 `encounterId`、`keys` 字段。
   * @param encounterNameById - 用于精确定位战斗记录名称的标识；省略时默认采用 `new Map<number, string>()`。
   * @returns 满足战斗记录Fight约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private matchEncounterFight(
    fight: FflogsReportFight,
    encounterLookup: FflogsEncounterLookup,
    encounterNameById = new Map<number, string>(),
  ) {
    const encounterId = this.toOptionalNumber(fight.encounterID);
    if (
      encounterLookup.encounterId !== undefined &&
      encounterId === encounterLookup.encounterId
    ) {
      return true;
    }
    const fightKeys = this.buildLookupKeys(
      `${fight.name || ''}`,
      (() => {
        if (encounterId !== undefined) {
          return encounterNameById.get(encounterId) || '';
        }
        return '';
      })(),
      `${fight.encounterID || ''}`,
    );
    return encounterLookup.keys.some((key) => fightKeys.includes(key));
  }

  /**
   * 从`input`解析战斗记录Lookup；当 `matched` 成立时返回 `{ displayName: matched.displayName, encount…`。
   * @param input - 用于战斗记录Lookup的结构化输入。
   * @returns 包含 `displayName`、`encounterId`、`input`、`keys` 字段的战斗记录Lookup。
   */
  private async resolveEncounterLookup(
    input: string,
  ): Promise<FflogsEncounterLookup> {
    const raw = `${input || ''}`.trim();
    const inputKeys = this.buildLookupKeys(raw);
    const catalog = await this.getFflogsEncounterCatalog();
    const matched = this.findEncounterCatalogMatch(inputKeys, catalog);
    if (matched) {
      return {
        displayName: matched.displayName,
        encounterId: matched.encounterId,
        input: raw,
        keys: [...new Set([...inputKeys, ...matched.keys])],
        zoneId: matched.zoneId,
      };
    }
    return {
      displayName: raw,
      encounterId: this.toOptionalNumber(raw),
      input: raw,
      keys: inputKeys,
    };
  }

  /**
   * 通过 `flatMap` 遍历或定位集合元素。
   * @returns Fflogs战斗记录目录。
   */
  private async getFflogsEncounterCatalog() {
    if (
      this.encounterCatalogCache &&
      Date.now() < this.encounterCatalogCache.expiresAt
    ) {
      return this.encounterCatalogCache.entries;
    }
    const data = await this.requestGraphql<{
      worldData?: {
        zones?: Array<{
          encounters?: Array<{ id?: number; name?: string }>;
          id?: number;
          name?: string;
        }>;
      };
    }>(
      `query FflogsEncounterCatalog {
        worldData {
          zones {
            id
            name
            encounters {
              id
              name
            }
          }
        }
      }`,
      {},
    );
    const entries = (data.worldData?.zones || []).flatMap((zone) =>
      (zone.encounters || [])
        .map((encounter) => {
          const encounterId = this.toOptionalNumber(encounter.id);
          const displayName = `${encounter.name || ''}`.trim();
          if (encounterId === undefined || !displayName) return undefined;
          return {
            displayName,
            encounterId,
            keys: this.buildLookupKeys(
              displayName,
              `${encounterId}`,
              `${zone.name || ''}`,
            ),
            zoneId: this.toOptionalNumber(zone.id),
            zoneName: zone.name,
          } satisfies FflogsEncounterCatalogItem;
        })
        .filter(Boolean),
    ) as FflogsEncounterCatalogItem[];
    this.encounterCatalogCache = {
      entries,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
    return entries;
  }

  /**
   * 按`inputKeys`、`catalog`读取战斗记录目录。
   * @param inputKeys - 用于批量校验或读取战斗记录目录的键集合。
   * @param catalog - 决定战斗记录目录内容、边界或目标的 `catalog` 值。
   * @returns 战斗记录目录。
   */
  private findEncounterCatalogMatch(
    inputKeys: string[],
    catalog: FflogsEncounterCatalogItem[],
  ) {
    const exact = catalog.find((entry) =>
      inputKeys.some((inputKey) => entry.keys.includes(inputKey)),
    );
    if (exact) return exact;
    return catalog.find((entry) =>
      inputKeys.some((inputKey) =>
        entry.keys.some(
          (key) =>
            inputKey.length >= 2 &&
            key.length >= 2 &&
            (key.includes(inputKey) || inputKey.includes(key)),
        ),
      ),
    );
  }

  /**
   * 按`payload`、`target`读取排名数据角色。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   * @param target - 决定排名数据角色内容、边界或目标的 `target` 值。
   * @returns 排名数据角色；没有可用结果或提前结束时为 `undefined`。
   */
  private findRankingCharacter(
    payload: unknown,
    target: {
      characterId?: number;
      characterName: string;
      serverName: string;
      serverRegion: string;
      serverSlug: string;
    },
  ) {
    const normalized = this.normalizeJsonPayload(payload) as any;
    const rankings = (() => {
      if (Array.isArray(normalized?.data)) {
        return normalized.data;
      }
      return [];
    })();
    for (const ranking of rankings) {
      const roles = ranking?.roles || {};
      for (const role of ['tanks', 'healers', 'dps']) {
        const characters = (() => {
          if (Array.isArray(roles?.[role]?.characters)) {
            return roles[role].characters;
          }
          return [];
        })();
        const matched = characters.find(
          (item) => !item?.id_2 && this.isTargetRankingCharacter(item, target),
        );
        if (matched) return matched;
      }
    }
    return undefined;
  }

  /**
   * 从规范化表格载荷中按不区分格式差异的角色名查找首个匹配条目。
   * @param payload - FFLogs 表格响应；数据结构无有效 `entries` 数组时按空集合处理。
   * @param target - 提供目标角色名称的查找条件。
   * @returns 首个名称匹配的表格条目；载荷无效或没有匹配角色时为 `undefined`。
   */
  private findTableEntry(
    payload: unknown,
    target: {
      characterName: string;
    },
  ) {
    const normalized = this.normalizeJsonPayload(payload) as any;
    const entries = (() => {
      if (Array.isArray(normalized?.data?.entries)) {
        return normalized.data.entries;
      }
      return [];
    })();
    const targetName = this.normalizeCharacterKey(target.characterName);
    return entries.find(
      (item) => this.normalizeCharacterKey(item?.name) === targetName,
    );
  }

  /**
   * 通过 `normalizeCharacterKey` 生成稳定标识。
   * @param item - 用于Target排名数据角色的领域对象，包含 `id`、`name`、`server` 字段。
   * @param target - 用于Target排名数据角色的领域对象，包含 `characterId`、`characterName`、`serverName`、`serverSlug` 字段。
   * @returns 满足Target排名数据角色约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isTargetRankingCharacter(
    item: any,
    target: {
      characterId?: number;
      characterName: string;
      serverName: string;
      serverRegion: string;
      serverSlug: string;
    },
  ) {
    if (!item || typeof item !== 'object') return false;
    if (
      target.characterId !== undefined &&
      Number(item.id) === target.characterId
    ) {
      return true;
    }
    if (
      this.normalizeCharacterKey(item.name) !==
      this.normalizeCharacterKey(target.characterName)
    ) {
      return false;
    }
    const serverName = this.pickText(item.server?.name, item.server?.slug);
    if (!serverName) return true;
    const serverKey = this.normalizeCharacterKey(serverName);
    return [target.serverName, target.serverSlug, target.serverRegion]
      .map((value) => this.normalizeCharacterKey(value))
      .includes(serverKey);
  }

  /**
   * 从`item`解析指标名称；从 `getParseColor` 读取指标名称。
   * @param item - 用于指标名称的领域对象，包含 `rankPercent`、`bracketPercent`、`amount`、`rank` 字段。
   * @returns 包含 `amount`、`color`、`percent`、`rank` 字段的指标名称。
   */
  private extractParseMetric(item: any): FflogsParseMetric {
    const percent = this.pickNumber(item?.rankPercent, item?.bracketPercent);
    return {
      amount: this.pickNumber(item?.amount),
      color: this.getParseColor(percent),
      percent,
      rank: this.pickText(item?.rank, item?.best),
    };
  }

  /**
   * 将`item`、`index`、`fallbackMetric`转换为排名数据；当 `!this.hasMeaningfulRanking(percent, amount)` 成立时返回 ``${index + 1}. ${encounter}：暂无有效排名``。
   * @param item - 用于排名数据的领域对象，包含 `encounter`、`encounterName`、`name`、`rankPercent` 字段。
   * @param index - 指定排名数据在集合或布局中的零基位置。
   * @param fallbackMetric - 决定排名数据内容、边界或目标的 `fallbackMetric` 值。
   * @param localizationMaps - 决定排名数据内容、边界或目标的 `localizationMaps` 值。
   * @returns 排名数据。
   */
  private formatRanking(
    item: FflogsRankingItem,
    index: number,
    fallbackMetric: string,
    localizationMaps: FflogsLocalizationMaps,
  ) {
    const encounter = this.localizeEncounter(
      this.pickText(
        item.encounter?.name,
        item.encounterName,
        item.name,
        `记录 ${index + 1}`,
      ),
    );
    const percent = this.pickNumber(
      item.rankPercent,
      item.percentile,
      item.bestPercent,
      item.historicalPercent,
    );
    const amount = this.pickNumber(item.bestAmount, item.amount, item.total);
    const spec = this.localizeSpec(
      this.pickText(item.spec, item.specName, item.class, item.role),
      localizationMaps,
    );
    const rank = this.pickText(item.rank, item.regionRank, item.serverRank);

    if (!this.hasMeaningfulRanking(percent, amount)) {
      return `${index + 1}. ${encounter}：暂无有效排名`;
    }

    const metric = this.localizeMetric(
      this.pickText(item.metric, item.metricName, fallbackMetric),
      localizationMaps,
    );
    const parts = [
      `${index + 1}. ${encounter}：${
        (() => {
          if (percent !== undefined) {
            return `${this.formatNumber(percent)}%`;
          }
          return '百分位暂无';
        })()
      }`,
      (() => {
        if (amount !== undefined) {
          return `${metric} ${this.formatNumber(amount)}`;
        }
        return '';
      })(),
      spec,
      (() => {
        if (rank) {
          return this.formatRank(rank);
        }
        return '';
      })(),
    ].filter(Boolean);
    return parts.join(' ｜ ');
  }

  /**
   * 从`payload`筛选Rankings，并保持保留项的原有顺序与键名。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `rankings`、`encounters` 字段。
   * @returns 按输入顺序得到的Rankings列表；没有匹配项时为空数组。
   */
  private pickRankings(payload: any): FflogsRankingItem[] {
    const raw = (() => {
      if (Array.isArray(payload)) {
        return payload;
      }
      if (Array.isArray(payload?.rankings)) {
        return payload.rankings;
      }
      if (Array.isArray(payload?.encounters)) {
        return payload.encounters;
      }
      return [];
    })();
    return raw
      .filter((item) => item && typeof item === 'object')
      .sort((a, b) => {
        const ap = this.pickNumber(a.rankPercent, a.percentile) || 0;
        const bp = this.pickNumber(b.rankPercent, b.percentile) || 0;
        return bp - ap;
      });
  }

  /**
   * 从`payload`筛选Star文本，并保持保留项的原有顺序与键名；当 `parts.length` 成立时返回 `parts.join(' / ')`。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `allStars` 字段。
   * @returns Star文本；没有可用结果或提前结束时为 `undefined`。
   */
  private pickAllStarText(payload: any) {
    const allStars = (() => {
      if (Array.isArray(payload?.allStars)) {
        return payload.allStars[0];
      }
      return payload?.allStars;
    })();
    if (!allStars || typeof allStars !== 'object') return undefined;
    const points = this.pickNumber(allStars.points, allStars.score);
    const rank = this.pickText(
      allStars.rank,
      allStars.regionRank,
      allStars.serverRank,
    );
    const parts = [
      (() => {
        if (points !== undefined) {
          return `全明星：${this.formatNumber(points)}分`;
        }
        return '';
      })(),
      (() => {
        if (rank) {
          return this.formatRank(rank);
        }
        return '';
      })(),
    ].filter(Boolean);
    if (parts.length) {
      return parts.join(' / ');
    }
    return undefined;
  }

  /**
   * 尝试解析字符串 JSON；文本无法解析或输入不是字符串时保留原值。
   * @param value - 待转换为尝试解析字符串 JSON的原始值。
   * @returns 尝试解析字符串 JSON。
   */
  private normalizeJsonPayload(value: unknown) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  /**
   * 尝试对 FFLogs 展示地址执行 URI 解码；遇到非法编码时保留原地址。
   * @param value - 待转换为尝试对 FFLogs 展示地址执行 URI 解码的原始值。
   * @returns 尝试对 FFLogs 展示地址执行 URI 解码。
   */
  private formatDisplayUrl(value: string) {
    try {
      return decodeURI(value);
    } catch {
      return value;
    }
  }

  /**
   * 通过 `encodeURIComponent` 编解码边界数据。
   * @param serverRegion - 决定角色URL 地址内容、边界或目标的 `serverRegion` 值。
   * @param serverSlug - 决定角色URL 地址内容、边界或目标的 `serverSlug` 值。
   * @param characterName - 决定角色URL 地址内容、边界或目标的 `characterName` 值。
   * @returns 按参数编码并拼接完成的角色URL 地址。
   */
  private buildCharacterUrl(
    serverRegion: string,
    serverSlug: string,
    characterName: string,
  ) {
    return `${this.webBaseUrl}/character/${encodeURIComponent(
      serverRegion.toLowerCase(),
    )}/${encodeURIComponent(serverSlug)}/${encodeURIComponent(characterName)}`;
  }

  /**
   * 根据`url`、`encounterLookup`、`partition`构造角色战斗记录URL 地址。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @param encounterLookup - 用于角色战斗记录URL 地址的领域对象，包含 `encounterId`、`zoneId` 字段。
   * @param partition - 决定角色战斗记录URL 地址内容、边界或目标的 `partition` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按参数编码并拼接完成的角色战斗记录URL 地址。
   */
  private buildCharacterEncounterUrl(
    url: string,
    encounterLookup: FflogsEncounterLookup,
    partition?: number | string,
  ) {
    if (encounterLookup.encounterId === undefined) return url;
    const searchParams = new URLSearchParams();
    if (encounterLookup.zoneId !== undefined) {
      searchParams.set('zone', `${encounterLookup.zoneId}`);
    }
    searchParams.set('boss', `${encounterLookup.encounterId}`);
    const partitionValue = this.toOptionalNumber(partition);
    searchParams.set('partition', `${partitionValue ?? 0}`);
    return `${url}?${searchParams.toString()}`;
  }

  /**
   * 通过 `encodeURIComponent` 编解码边界数据。
   * @param code - 决定报告FightURL 地址内容、边界或目标的 `code` 值。
   * @param fightId - 用于精确定位fight的标识。
   * @returns 按参数编码并拼接完成的报告FightURL 地址。
   */
  private buildReportFightUrl(code: string, fightId: number) {
    return `${this.webBaseUrl}/reports/${encodeURIComponent(
      code,
    )}#fight=${encodeURIComponent(`${fightId}`)}`;
  }

  /**
   * 优先读取 FFLogs 遭遇名称，缺失时回退到遭遇标识，并去除首尾空白。
   * @param params - 用于战斗记录输入的领域对象，包含 `encounterName`、`encounter` 字段。
   * @returns 战斗记录输入。
   */
  private normalizeEncounterInput(params: FflogsCharacterSummaryInput) {
    return `${params.encounterName || params.encounter || ''}`.trim();
  }

  /**
   * 将`value`规范为指标名称，使等价输入得到一致表示。
   * @param value - 待转换为指标名称的原始值；为空时采用 `''` 作为兜底。
   * @returns 规范化后的指标名称；主值为空时采用 `raw` 兜底；没有可用结果或提前结束时为 `undefined`。
   */
  private normalizeMetric(value?: string) {
    const raw = `${value || ''}`.trim();
    if (!raw) return undefined;
    const lower = raw.toLowerCase();
    const map: Record<string, string> = {
      adps: 'cdps',
      cdps: 'cdps',
      damage: 'dps',
      dps: 'dps',
      healer: 'hps',
      healing: 'hps',
      hps: 'hps',
      ndps: 'ndps',
      rdps: 'rdps',
    };
    return map[lower] || raw;
  }

  /**
   * 将`value`规范为角色，使等价输入得到一致表示。
   * @param value - 待转换为角色的原始值；为空时采用 `''` 作为兜底。
   * @returns 规范化后的角色；主值为空时采用 `raw` 兜底；没有可用结果或提前结束时为 `undefined`。
   */
  private normalizeRole(value?: string) {
    const raw = `${value || ''}`.trim();
    if (!raw) return undefined;
    const lower = raw.toLowerCase();
    const map: Record<string, string> = {
      dps: 'DPS',
      healer: 'Healer',
      tank: 'Tank',
      治疗: 'Healer',
      输出: 'DPS',
      坦克: 'Tank',
    };
    return map[lower] || raw;
  }

  /**
   * 将`value`规范为Timeframe，使等价输入得到一致表示。
   * @param value - 待转换为Timeframe的原始值；为空时采用 `''` 作为兜底。
   * @returns 当前状态对应的Timeframe，取值为 `'Today'`、`'Historical'`；没有可用结果或提前结束时为 `undefined`。
   */
  private normalizeTimeframe(value?: string) {
    const raw = `${value || ''}`.trim();
    if (!raw) return undefined;
    const lower = raw.toLowerCase();
    if (['today', 'current', '当前', '今天'].includes(lower)) return 'Today';
    if (['historical', 'history', '历史'].includes(lower)) return 'Historical';
    return raw;
  }

  /**
   * 将非空数字或数字文本解析为有限数值，并把空值、空白文本与非有限结果统一为空值。
   * @param value - 可选数字或数字文本；`null`、`undefined` 与仅含空白的文本视为未提供。
   * @returns 解析得到的有限数值；输入为空或无法得到有限数值时为 `undefined`。
   */
  private toOptionalNumber(value?: number | string) {
    if (value === undefined || value === null || `${value}`.trim() === '') {
      return undefined;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return undefined;
  }

  /**
   * 通过 `toOptionalNumber` 收敛领域表示。
   * @param value - 待转换为LimitedPositive数值的原始值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @param min - 决定LimitedPositive数值内容、边界或目标的 `min` 值。
   * @param max - 决定LimitedPositive数值内容、边界或目标的 `max` 值。
   * @returns LimitedPositive数值。
   */
  private toLimitedPositiveNumber(
    value: number | string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) {
    const parsed = this.toOptionalNumber(value);
    const normalized = (() => {
      if (parsed === undefined) {
        return fallback;
      }
      return parsed;
    })();
    return Math.min(Math.max(Math.floor(normalized), min), max);
  }

  /**
   * 将可解析数值除以正时长得到每秒值；数值缺失或时长非正时返回空值。
   * @param value - 待转换为每秒值Second的原始值。
   * @param durationMs - 用于每秒值Second超时、有效期或退避计算的毫秒数；为空时采用 `durationMs <= 0` 作为兜底。
   * @returns 每秒值Second；没有可用结果或提前结束时为 `undefined`。
   */
  private toPerSecond(value: any, durationMs?: number) {
    const amount = this.pickNumber(value);
    if (amount === undefined || !durationMs || durationMs <= 0)
      return undefined;
    return amount / (durationMs / 1000);
  }

  /**
   * 将可选文本裁剪为非空字符串，并把缺失值或纯空白统一为空值。
   * @param value - 可能缺失或带首尾空白的文本。
   * @returns 裁剪后的非空文本；输入缺失或裁剪后为空时为 `undefined`。
   */
  private normalizeOptionalString(value?: string) {
    const raw = `${value || ''}`.trim();
    return raw || undefined;
  }

  /**
   * 从`values`筛选文本，并保持保留项的原有顺序与键名；当 `picked === undefined` 成立时返回 `''`。
   * @param values - 按原有顺序参与文本筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 当前状态对应的文本，取值为 `''`。
   */
  private pickText(...values: any[]) {
    const picked = values.find(
      (item) => item !== undefined && item !== null && `${item}`.trim() !== '',
    );
    if (picked === undefined) {
      return '';
    }
    return `${picked}`;
  }

  /**
   * 从`values`筛选数值，并保持保留项的原有顺序与键名。
   * @param values - 按原有顺序参与数值筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 数值；没有可用结果或提前结束时为 `undefined`。
   */
  private pickNumber(...values: any[]) {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  /**
   * 按绝对值选择 FFLogs 数字精度：绝对值至少 `100` 时不保留小数，其余最多保留一位，并使用中文分组格式。
   * @param value - 待转换为数值的原始值。
   * @returns 数值。
   */
  private formatNumber(value: number) {
    const digits = (() => {
      if (Math.abs(value) >= 100) {
        return 0;
      }
      return 1;
    })();
    return value.toLocaleString('zh-CN', {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    });
  }

  /**
   * 将`value`转换为指标名称数值；当 `value === undefined` 成立时返回 `'-'`。
   * @param value - 待转换为指标名称数值的原始值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的指标名称数值，取值为 `'-'`。
   */
  private formatMetricNumber(value?: number) {
    if (value === undefined) {
      return '-';
    }
    return this.formatNumber(value);
  }

  /**
   * 将时间戳格式化为上海时区的月日时分文本；缺失时返回“时间未知”。
   * @param value - 待转换为将时间戳格式化为上海时区的月日时分文本的原始值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的将时间戳格式化为上海时区的月日时分文本，取值为 `'时间未知'`。
   */
  private formatLogTime(value?: number) {
    if (!value) return '时间未知';
    return new Date(value).toLocaleString('zh-CN', {
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Shanghai',
    });
  }

  /**
   * 按 FFLogs 百分位阈值映射金、粉、橙、紫、蓝、绿或灰色；缺失百分位返回无色。
   * @param percent - 决定颜色内容、边界或目标的 `percent` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 表示颜色的固定文本 `'灰'`。
   */
  private getParseColor(percent?: number) {
    if (percent === undefined) return '无色';
    if (percent >= 100) return '金';
    if (percent >= 99) return '粉';
    if (percent >= 95) return '橙';
    if (percent >= 75) return '紫';
    if (percent >= 50) return '蓝';
    if (percent >= 25) return '绿';
    return '灰';
  }

  /**
   * 去除排名文本的井号与空白，并统一补齐中文排名前缀；空输入返回空字符串。
   * @param value - 待转换为排名的原始值。
   * @returns 当前状态对应的排名，取值为 `''`。
   */
  private formatRank(value: string) {
    const rank = value.replace(/^#/, '').trim();
    if (!rank) return '';
    if (rank.startsWith('第') || rank.endsWith('名')) return `排名${rank}`;
    return `排名第${rank}`;
  }

  /**
   * 根据 `(percent !== undefined && percent > 0) || (amount !== undefined && amount > 0)` 判定输入是否满足条件。
   * @param percent - 决定Meaningful排名数据内容、边界或目标的 `percent` 值；为空时采用 `(amount !== undefined && amount > 0)` 作为兜底。
   * @param amount - 决定Meaningful排名数据内容、边界或目标的 `amount` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足Meaningful排名数据约束时为 `true`；不满足、未命中或显式失败分支为 `false`；没有可用结果或提前结束时为 `undefined`。
   */
  private hasMeaningfulRanking(percent?: number, amount?: number) {
    return (
      (percent !== undefined && percent > 0) ||
      (amount !== undefined && amount > 0)
    );
  }

  /**
   * 按当前运行态读取LocalizationMaps；从 `getNormalizedDictMap` 读取LocalizationMaps。
   * @returns 包含 `job`、`metric`、`role`、`serverRegion` 字段的LocalizationMaps。
   */
  private async getLocalizationMaps(): Promise<FflogsLocalizationMaps> {
    const [job, metric, role, serverRegion] = await Promise.all([
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.job),
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.metric),
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.role),
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.serverRegion),
    ]);

    return {
      job,
      metric,
      role,
      serverRegion,
    };
  }

  /**
   * 按`dictCode`读取Normalized字典；同步更新对应缓存或去重状态（`map.set`）。
   * @param dictCode - 决定Normalized字典内容、边界或目标的 `dictCode` 值。
   * @returns Normalized字典。
   */
  private async getNormalizedDictMap(dictCode: string) {
    const dicts = await this.getDictItems(dictCode);
    const map = new Map<string, string>();
    for (const { label, value } of dicts) {
      for (const key of this.buildLookupKeys(`${value}`, `${label}`)) {
        map.set(key, `${label}`);
      }
    }
    return map;
  }

  /**
   * 按当前运行态读取FF14市场目录；当 `this.host.relationTree` 成立时返回 `treeCatalog`。
   * @returns FF14市场目录。
   */
  private async loadFf14MarketCatalog() {
    if (this.host.relationTree) {
      const treeCatalog = buildFf14MarketCatalogFromTree(
        await this.host.relationTree({
          dictCode: PLUGIN_FF14_MARKET_DICT_CODES.region,
        }),
      );
      if (treeCatalog.dataCenters.length > 0) return treeCatalog;
    }

    const [regions, dataCenters, worlds] = await Promise.all([
      this.getDictItems(PLUGIN_FF14_MARKET_DICT_CODES.region),
      this.getDictItems(PLUGIN_FF14_MARKET_DICT_CODES.dataCenter),
      this.getDictItems(PLUGIN_FF14_MARKET_DICT_CODES.world),
    ]);
    return buildFf14MarketCatalog({
      dataCenters,
      regions,
      worlds,
    });
  }

  /**
   * 按`dictCode`读取字典项目；当 `this.host.getDictItemsByKey` 成立时返回 `this.host.getDictItemsByKey(dictCode)`。
   * @param dictCode - 决定字典项目内容、边界或目标的 `dictCode` 值。
   * @returns 按输入顺序得到的字典项目列表；没有匹配项时为空数组。
   */
  private async getDictItems(dictCode: string): Promise<Ff14DictItem[]> {
    if (this.host.getDictItemsByKey) {
      return this.host.getDictItemsByKey(dictCode);
    }
    if (this.host.getDictByKey) {
      return this.host.getDictByKey(dictCode);
    }
    return [];
  }

  /**
   * 按本地化映射将`value`转换为战斗记录；映射缺失时保留原文本或使用领域默认值。
   * @param value - 待转换为战斗记录的原始值。
   * @returns 战斗记录。
   */
  private localizeEncounter(value: string) {
    return value;
  }

  /**
   * 按本地化映射将`value`、`localizationMaps`转换为指标名称；映射缺失时保留原文本或使用领域默认值；从 `localizationMaps.metric.get` 读取指标名称。
   * @param value - 待转换为指标名称的原始值。
   * @param localizationMaps - 用于指标名称的领域对象，包含 `metric` 字段。
   * @returns 规范化后的指标名称；主值为空时采用 `'DPS'` 兜底。
   */
  private localizeMetric(
    value: string,
    localizationMaps: FflogsLocalizationMaps,
  ) {
    return (
      localizationMaps.metric.get(this.normalizeLookupKey(value)) ||
      value ||
      'DPS'
    );
  }

  /**
   * 按本地化映射将`value`、`localizationMaps`转换为服务器Region；映射缺失时保留原文本或使用领域默认值；从 `localizationMaps.serverRegion.get` 读取服务器Region。
   * @param value - 待转换为服务器Region的原始值。
   * @param localizationMaps - 用于服务器Region的领域对象，包含 `serverRegion` 字段。
   * @returns 规范化后的服务器Region；主值为空时采用 `value.toUpperCase()` 兜底。
   */
  private localizeServerRegion(
    value: string,
    localizationMaps: FflogsLocalizationMaps,
  ) {
    return (
      localizationMaps.serverRegion.get(this.normalizeLookupKey(value)) ||
      value.toUpperCase()
    );
  }

  /**
   * 通过 `normalizeLookupKey` 生成稳定标识。
   * @param value - 待转换为布局规格的原始值。
   * @param localizationMaps - 用于布局规格的领域对象，包含 `job`、`role` 字段。
   * @returns 规范化后的布局规格；主值为空时采用 `value` 兜底。
   */
  private localizeSpec(
    value: string,
    localizationMaps: FflogsLocalizationMaps,
  ) {
    const key = this.normalizeLookupKey(value);
    return (
      localizationMaps.job.get(key) || localizationMaps.role.get(key) || value
    );
  }

  /**
   * 将`value`规范为Lookup键，使等价输入得到一致表示。
   * @param value - 待转换为Lookup键的原始值。
   * @returns Lookup键。
   */
  private normalizeLookupKey(value: string) {
    return `${value || ''}`
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param values - 按原有顺序参与LookupKeys筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 按输入顺序得到的LookupKeys列表；没有匹配项时为空数组。
   */
  private buildLookupKeys(...values: string[]) {
    const keys = values
      .flatMap((value) => {
        const normalized = this.normalizeLookupKey(value);
        const withoutAnd = normalized.replace(/and/g, '');
        return [normalized, withoutAnd];
      })
      .filter(Boolean);
    return [...new Set(keys)];
  }

  /**
   * 将`value`规范为角色键，使等价输入得到一致表示。
   * @param value - 待转换为角色键的原始值。
   * @returns 角色键。
   */
  private normalizeCharacterKey(value: string) {
    return `${value || ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }

  /**
   * 按`input`移除未定义字段。
   * @param input - 用于未定义字段的结构化输入。
   * @returns 未定义字段。
   */
  private removeUndefined(input: Record<string, any>) {
    return Object.entries(input).reduce<Record<string, any>>(
      (result, [key, value]) => {
        if (value !== undefined && value !== '') result[key] = value;
        return result;
      },
      {},
    );
  }

  /**
   * 按当前运行态读取服务器；从 `host.getConfig` 读取服务器。
   * @returns 规范化后的服务器；主值为空时采用 `''` 兜底。
   */
  private getDefaultServer() {
    return this.host.getConfig<string>('FFLOGS_DEFAULT_SERVER') || '';
  }

  /**
   * 按当前运行态读取服务器Region；从 `host.getConfig` 读取服务器Region。
   * @returns 规范化后的服务器Region；主值为空时采用 `'CN'` 兜底。
   */
  private getDefaultServerRegion() {
    return this.host.getConfig<string>('FFLOGS_DEFAULT_SERVER_REGION') || 'CN';
  }

  /**
   * 按当前运行态读取超时Ms；从 `host.getConfig` 读取超时Ms。
   * @returns 超时Ms。
   */
  private getTimeoutMs() {
    return Number(this.host.getConfig('FFLOGS_REQUEST_TIMEOUT_MS') || 10_000);
  }
}
