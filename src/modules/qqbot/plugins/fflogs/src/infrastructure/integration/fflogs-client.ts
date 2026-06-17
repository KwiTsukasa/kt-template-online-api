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
  getDictByKey: (
    dictCode: string,
  ) => Promise<Array<{ label?: string; value?: string }>>;
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

  /**
   * 初始化 FflogsClient 实例。
   * @param host - host 输入；驱动 `resolveFflogsConfig()` 的 FFLogs步骤。
   */
  constructor(private readonly host: FflogsPluginHost) {
    const config = resolveFflogsConfig(host);
    this.webBaseUrl = config.webBaseUrl;
    this.graphqlUrl = config.graphqlUrl;
    this.tokenUrl = config.tokenUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  /**
   * 执行 FFLogs 插件流程。
   */
  async checkHealth() {
    await this.getAccessToken();
    return true;
  }

  /**
   * 查询 FFLogs 插件数据。
   * @param params - FFLogs列表；使用 `characterName`、`character`、`serverSlug`、`server` 字段生成结果。
   * @returns FFLogs 插件查询结果。
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
   * 创建 FFLogs 插件对象或配置。
   * @param candidates - FFLogs列表；转换 FFLogs列表项。
   * @returns 创建后的 FFLogs 插件对象或配置。
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
   * 解析Known World。
   * @param value - 待转换值；影响 resolveKnownWorld 的返回值。
   */
  async resolveKnownWorld(value: string) {
    return this.host.resolveKnownWorld?.(value) || null;
  }

  /**
   * 查询 FFLogs 插件数据。
   * @param params - FFLogs列表；使用 `characterName`、`character`、`serverSlug`、`server` 字段生成结果。
   * @returns FFLogs 插件查询结果。
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
    const encounterSuggestions = candidates.length
      ? []
      : this.pickRecentEncounterSuggestions(
          character.recentReports?.data || [],
          encounterNameById,
        );
    const rankingSuggestions = candidates.length
      ? []
      : this.pickRankingEncounterSuggestions(character.zoneRankings);

    const rankingLogs =
      encounterLookup.encounterId !== undefined
        ? await this.getEncounterRankingLogs({
            characterName: character.name || characterName,
            encounterLookup,
            limit,
            partition: params.partition,
            serverRegion,
            serverSlug: character.server?.slug || serverSlug,
            timeframe: params.timeframe,
          })
        : [];
    const fallbackLogs = rankingLogs.length
      ? []
      : (
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
    const logs = rankingLogs.length ? rankingLogs : fallbackLogs;

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
   * 查询 FFLogs 插件数据。
   * @param params - FFLogs列表；使用 `encounterLookup`、`characterName`、`partition`、`serverRegion` 字段生成结果。
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
    const dpsRanks = Array.isArray(dpsPayload?.ranks) ? dpsPayload.ranks : [];
    const hpsRanks = Array.isArray(hpsPayload?.ranks) ? hpsPayload.ranks : [];
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
   * 创建 FFLogs 插件对象或配置。
   * @param damageRank - damageRank 输入；驱动 `this.toOptionalNumber()`、`this.pickNumber()` 的 FFLogs步骤。
   * @param healingRank - healingRank 输入；驱动 `this.pickNumber()` 的 FFLogs步骤。
   * @param encounterLookup - encounterLookup 输入；使用 `displayName` 字段生成结果。
   * @returns 创建后的 FFLogs 插件对象或配置。
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
   * 创建 FFLogs 插件对象或配置。
   * @param rank - rank 输入；驱动 `this.toOptionalNumber()` 的 FFLogs步骤。
   */
  private buildRankingFightKey(rank: any) {
    const code = `${rank?.report?.code || ''}`.trim();
    const fightId = this.toOptionalNumber(rank?.report?.fightID);
    return code && fightId !== undefined ? `${code}#${fightId}` : '';
  }

  /**
   * 查询 FFLogs 插件数据。
   * @param params - FFLogs列表；使用 `characterId`、`characterName`、`serverName`、`serverRegion` 字段生成结果。
   * @returns FFLogs 插件查询结果。
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
   * 查询 FFLogs 插件数据。
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
   * 执行 FFLogs 插件流程。
   * @param query - 查询参数 DTO；限定 FFLogs分页、搜索或详情查询条件。
   * @param variables - FFLogs列表；驱动 `this.removeUndefined()` 的 FFLogs步骤。
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
   * 执行 FFLogs 插件流程。
   * @param url - 访问地址；驱动 `this.getTimeoutMs()` 的 FFLogs步骤。
   * @param method - HTTP 方法名；影响 requestJson 的返回值。
   * @param options - FFLogs列表；使用 `body`、`headers` 字段生成结果。
   */
  private requestJson<T>(
    url: URL,
    method: FflogsHttpMethod,
    options: { body?: string; headers?: Record<string, string> } = {},
  ) {
    return this.host.requestJson<T>({
      body: options.body,
      context: 'FFLogs',
      /**
       * 执行 FFLogs回调。
       * @param statusCode - statusCode 输入；影响 failureMessage 的返回值。
       */
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
   * 创建 FFLogs 插件对象或配置。
   * @param params - FFLogs列表；使用 `serverRegion`、`localizationMaps`、`characterName`、`serverName` 字段生成结果。
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
    const idText = params.characterId ? `角色ID：${params.characterId}` : '';
    const rankingText = params.rankings.length
      ? [
          '公开排名：',
          ...params.rankings.map((item, index) =>
            this.formatRanking(
              item,
              index,
              params.metric,
              params.localizationMaps,
            ),
          ),
        ].join('\n')
      : '公开排名：暂无公开排名数据';
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
   * 创建 FFLogs 插件对象或配置。
   * @param params - FFLogs列表；使用 `serverRegion`、`localizationMaps`、`characterName`、`serverName` 字段生成结果。
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
    const idText = params.characterId ? `角色ID：${params.characterId}` : '';
    const logText = params.logs.length
      ? [
          ...params.logs.map((item, index) =>
            this.formatEncounterLogLine(item, index),
          ),
        ].join('\n')
      : [
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
   * 转换 FFLogs 插件输入。
   * @param item - item 输入；使用 `kill`、`damageScore`、`healingScore`、`dps` 字段生成结果。
   * @param index - index 输入；影响 formatEncounterLogLine 的返回值。
   */
  private formatEncounterLogLine(item: FflogsEncounterLogItem, index: number) {
    const status =
      item.kill === true ? '击杀' : item.kill === false ? '灭团' : '未知';
    const damageScore =
      item.damageScore !== undefined
        ? `${this.formatNumber(item.damageScore)}`
        : '-';
    const healingScore =
      item.healingScore !== undefined
        ? `${this.formatNumber(item.healingScore)}`
        : '-';
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
   * 执行 FFLogs 插件流程。
   * @param reports - FFLogs列表；影响 pickEncounterFightCandidates 的返回值。
   * @param encounterLookup - encounterLookup 输入；驱动 `this.matchEncounterFight()` 的 FFLogs步骤。
   * @param difficulty - difficulty 输入；驱动 `Number()` 的 FFLogs步骤。
   * @param encounterNameById - FFLogs ID；定位本次读取、更新、删除或关联的FFLogs。
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
   * 执行 FFLogs 插件流程。
   * @param reports - FFLogs列表；执行 `reports.flatMap()` 对应的 FFLogs步骤。
   * @param encounterNameById - FFLogs ID；定位本次读取、更新、删除或关联的FFLogs。
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
   * 执行 FFLogs 插件流程。
   * @param payload - payload 输入；驱动 `this.normalizeJsonPayload()` 的 FFLogs步骤。
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
   * 创建 FFLogs 插件对象或配置。
   * @param payload - payload 输入；驱动 `this.normalizeJsonPayload()` 的 FFLogs步骤。
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
   * 执行 FFLogs 插件流程。
   * @param values - 配置值字典；驱动 `for()` 的 FFLogs步骤。
   * @param limit - limit 输入；决定 FFLogs条件分支。
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
   * 转换 FFLogs 插件输入。
   * @param label - 字典展示文本；影响 formatSuggestionLine 的返回值。
   * @param values - 配置值字典；影响 formatSuggestionLine 的返回值。
   */
  private formatSuggestionLine(label: string, values?: string[]) {
    const list = (values || []).filter(Boolean);
    return list.length ? `${label}：${list.join('、')}` : '';
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param fight - fight 输入；使用 `encounterID`、`name` 字段生成结果。
   * @param encounterLookup - encounterLookup 输入；使用 `encounterId`、`keys` 字段生成结果。
   * @param encounterNameById - FFLogs ID；定位本次读取、更新、删除或关联的FFLogs。
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
      encounterId !== undefined ? encounterNameById.get(encounterId) || '' : '',
      `${fight.encounterID || ''}`,
    );
    return encounterLookup.keys.some((key) => fightKeys.includes(key));
  }

  /**
   * 解析Encounter Lookup。
   * @param input - input 输入；驱动 `this.toOptionalNumber()` 的 FFLogs步骤。
   * @returns FFLogs 插件转换后的值。
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
   * 查询 FFLogs 插件数据。
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
   * 查询 FFLogs 插件数据。
   * @param inputKeys - FFLogs列表；计算 FFLogs布尔判断。
   * @param catalog - catalog 输入；执行 `catalog.find()` 对应的 FFLogs步骤。
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
   * 查询 FFLogs 插件数据。
   * @param payload - payload 输入；驱动 `this.normalizeJsonPayload()` 的 FFLogs步骤。
   * @param target - target 输入；驱动 `characters.find()` 的 FFLogs步骤。
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
    const rankings = Array.isArray(normalized?.data) ? normalized.data : [];
    for (const ranking of rankings) {
      const roles = ranking?.roles || {};
      for (const role of ['tanks', 'healers', 'dps']) {
        const characters = Array.isArray(roles?.[role]?.characters)
          ? roles[role].characters
          : [];
        const matched = characters.find(
          (item) => !item?.id_2 && this.isTargetRankingCharacter(item, target),
        );
        if (matched) return matched;
      }
    }
    return undefined;
  }

  /**
   * 查询 FFLogs 插件数据。
   * @param payload - payload 输入；驱动 `this.normalizeJsonPayload()` 的 FFLogs步骤。
   * @param target - target 输入；使用 `characterName` 字段生成结果。
   */
  private findTableEntry(
    payload: unknown,
    target: {
      characterName: string;
    },
  ) {
    const normalized = this.normalizeJsonPayload(payload) as any;
    const entries = Array.isArray(normalized?.data?.entries)
      ? normalized.data.entries
      : [];
    const targetName = this.normalizeCharacterKey(target.characterName);
    return entries.find(
      (item) => this.normalizeCharacterKey(item?.name) === targetName,
    );
  }

  /**
   * 判断 FFLogs 插件条件。
   * @param item - item 输入；使用 `id`、`name`、`server` 字段计算判断结果。
   * @param target - target 输入；使用 `characterId`、`characterName`、`serverName`、`serverSlug` 字段计算判断结果。
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
   * 执行 FFLogs 插件流程。
   * @param item - item 输入；驱动 `this.pickNumber()` 的 FFLogs步骤。
   * @returns FFLogs 插件产出的 FflogsParseMetric。
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
   * 转换 FFLogs 插件输入。
   * @param item - item 输入；使用 `encounter`、`encounterName`、`name`、`rankPercent` 字段生成结果。
   * @param index - index 输入；影响 formatRanking 的返回值。
   * @param fallbackMetric - fallbackMetric 输入；驱动 `this.localizeMetric()` 的 FFLogs步骤。
   * @param localizationMaps - FFLogs列表；驱动 `this.localizeSpec()`、`this.localizeMetric()` 的 FFLogs步骤。
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
        percent !== undefined ? `${this.formatNumber(percent)}%` : '百分位暂无'
      }`,
      amount !== undefined ? `${metric} ${this.formatNumber(amount)}` : '',
      spec,
      rank ? this.formatRank(rank) : '',
    ].filter(Boolean);
    return parts.join(' ｜ ');
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param payload - payload 输入；使用 `rankings`、`encounters` 字段生成结果。
   * @returns FFLogs 插件产出的 FflogsRankingItem[]。
   */
  private pickRankings(payload: any): FflogsRankingItem[] {
    const raw = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.rankings)
        ? payload.rankings
        : Array.isArray(payload?.encounters)
          ? payload.encounters
          : [];
    return raw
      .filter((item) => item && typeof item === 'object')
      .sort((a, b) => {
        const ap = this.pickNumber(a.rankPercent, a.percentile) || 0;
        const bp = this.pickNumber(b.rankPercent, b.percentile) || 0;
        return bp - ap;
      });
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param payload - payload 输入；使用 `allStars` 字段生成结果。
   */
  private pickAllStarText(payload: any) {
    const allStars = Array.isArray(payload?.allStars)
      ? payload.allStars[0]
      : payload?.allStars;
    if (!allStars || typeof allStars !== 'object') return undefined;
    const points = this.pickNumber(allStars.points, allStars.score);
    const rank = this.pickText(
      allStars.rank,
      allStars.regionRank,
      allStars.serverRank,
    );
    const parts = [
      points !== undefined ? `全明星：${this.formatNumber(points)}分` : '',
      rank ? this.formatRank(rank) : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' / ') : undefined;
  }

  /**
   * 转换 FFLogs 插件输入。
   * @param value - 待转换值；转换 JSON 文本。
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
   * 转换 FFLogs 插件输入。
   * @param value - 待转换时间值；驱动 `decodeURI()` 的 FFLogs步骤。
   */
  private formatDisplayUrl(value: string) {
    try {
      return decodeURI(value);
    } catch {
      return value;
    }
  }

  /**
   * 创建 FFLogs 插件对象或配置。
   * @param serverRegion - serverRegion 输入；执行 `serverRegion.toLowerCase()` 对应的 FFLogs步骤。
   * @param serverSlug - serverSlug 输入；驱动 `encodeURIComponent()` 的 FFLogs步骤。
   * @param characterName - characterName 输入；驱动 `encodeURIComponent()` 的 FFLogs步骤。
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
   * 创建 FFLogs 插件对象或配置。
   * @param url - 访问地址；生成 FFLogs对象。
   * @param encounterLookup - encounterLookup 输入；使用 `encounterId`、`zoneId` 字段生成结果。
   * @param partition - partition 输入；驱动 `this.toOptionalNumber()`、`searchParams.set()` 的 FFLogs步骤。
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
   * 创建 FFLogs 插件对象或配置。
   * @param code - 响应状态码；驱动 `encodeURIComponent()` 的 FFLogs步骤。
   * @param fightId - FFLogs ID；定位本次读取、更新、删除或关联的FFLogs。
   */
  private buildReportFightUrl(code: string, fightId: number) {
    return `${this.webBaseUrl}/reports/${encodeURIComponent(
      code,
    )}#fight=${encodeURIComponent(`${fightId}`)}`;
  }

  /**
   * 转换 FFLogs 插件输入。
   * @param params - FFLogs列表；使用 `encounterName`、`encounter` 字段生成结果。
   */
  private normalizeEncounterInput(params: FflogsCharacterSummaryInput) {
    return `${params.encounterName || params.encounter || ''}`.trim();
  }

  /**
   * 转换 FFLogs 插件输入。
   * @param value - 待转换值；影响 normalizeMetric 的返回值。
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
   * 转换 FFLogs 插件输入。
   * @param value - 待转换值；影响 normalizeRole 的返回值。
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
   * 转换 FFLogs 插件输入。
   * @param value - 待转换时间值；影响 normalizeTimeframe 的返回值。
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
   * 执行 FFLogs 插件流程。
   * @param value - 待转换值；驱动 `Number()` 的 FFLogs步骤。
   */
  private toOptionalNumber(value?: number | string) {
    if (value === undefined || value === null || `${value}`.trim() === '') {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param value - 待转换值；驱动 `this.toOptionalNumber()` 的 FFLogs步骤。
   * @param fallback - 兜底值；影响 toLimitedPositiveNumber 的返回值。
   * @param min - min 输入；影响 toLimitedPositiveNumber 的返回值。
   * @param max - max 输入；驱动 `Math.min()` 的 FFLogs步骤。
   */
  private toLimitedPositiveNumber(
    value: number | string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) {
    const parsed = this.toOptionalNumber(value);
    const normalized = parsed === undefined ? fallback : parsed;
    return Math.min(Math.max(Math.floor(normalized), min), max);
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param value - 待转换值；驱动 `this.pickNumber()` 的 FFLogs步骤。
   * @param durationMs - FFLogs列表；决定 FFLogs条件分支。
   */
  private toPerSecond(value: any, durationMs?: number) {
    const amount = this.pickNumber(value);
    if (amount === undefined || !durationMs || durationMs <= 0)
      return undefined;
    return amount / (durationMs / 1000);
  }

  /**
   * 转换 FFLogs 插件输入。
   * @param value - 待转换值；影响 normalizeOptionalString 的返回值。
   */
  private normalizeOptionalString(value?: string) {
    const raw = `${value || ''}`.trim();
    return raw || undefined;
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param values - 配置值字典；执行 `values.find()` 对应的 FFLogs步骤。
   */
  private pickText(...values: any[]) {
    const picked = values.find(
      (item) => item !== undefined && item !== null && `${item}`.trim() !== '',
    );
    return picked === undefined ? '' : `${picked}`;
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param values - 配置值字典；驱动 `for()` 的 FFLogs步骤。
   */
  private pickNumber(...values: any[]) {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  /**
   * 转换 FFLogs 插件输入。
   * @param value - 待转换时间值；执行 `value.toLocaleString()` 对应的 FFLogs步骤。
   */
  private formatNumber(value: number) {
    const digits = Math.abs(value) >= 100 ? 0 : 1;
    return value.toLocaleString('zh-CN', {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    });
  }

  /**
   * 转换 FFLogs 插件输入。
   * @param value - 待转换时间值；驱动 `this.formatNumber()` 的 FFLogs步骤。
   */
  private formatMetricNumber(value?: number) {
    return value === undefined ? '-' : this.formatNumber(value);
  }

  /**
   * 转换 FFLogs 插件输入。
   * @param value - 待转换时间值；构造时间对象。
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
   * 查询 FFLogs 插件数据。
   * @param percent - percent 输入；决定 FFLogs条件分支。
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
   * 转换 FFLogs 插件输入。
   * @param value - 待转换时间值；生成规范化文本。
   */
  private formatRank(value: string) {
    const rank = value.replace(/^#/, '').trim();
    if (!rank) return '';
    if (rank.startsWith('第') || rank.endsWith('名')) return `排名${rank}`;
    return `排名第${rank}`;
  }

  /**
   * 判断 FFLogs 插件条件。
   * @param percent - percent 输入；计算 FFLogs判断结果。
   * @param amount - amount 输入；计算 FFLogs判断结果。
   */
  private hasMeaningfulRanking(percent?: number, amount?: number) {
    return (
      (percent !== undefined && percent > 0) ||
      (amount !== undefined && amount > 0)
    );
  }

  /**
   * 查询 FFLogs 插件数据。
   * @returns FFLogs 插件查询结果。
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
   * 查询 FFLogs 插件数据。
   * @param dictCode - dictCode 输入；驱动 `host.getDictByKey()` 的 FFLogs步骤。
   */
  private async getNormalizedDictMap(dictCode: string) {
    const dicts = await this.host.getDictByKey(dictCode);
    const map = new Map<string, string>();
    for (const { label, value } of dicts) {
      for (const key of this.buildLookupKeys(`${value}`, `${label}`)) {
        map.set(key, `${label}`);
      }
    }
    return map;
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param value - 待转换值；影响 localizeEncounter 的返回值。
   */
  private localizeEncounter(value: string) {
    return value;
  }

  /**
   * 执行 FFLogs 插件流程。
   * @param value - 待转换值；影响 localizeMetric 的返回值。
   * @param localizationMaps - FFLogs列表；使用 `metric` 字段生成结果。
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
   * 执行 FFLogs 插件流程。
   * @param value - 待转换值；执行 `value.toUpperCase()` 对应的 FFLogs步骤。
   * @param localizationMaps - FFLogs列表；使用 `serverRegion` 字段生成结果。
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
   * 执行 FFLogs 插件流程。
   * @param value - 待转换值；驱动 `this.normalizeLookupKey()` 的 FFLogs步骤。
   * @param localizationMaps - FFLogs列表；使用 `job`、`role` 字段生成结果。
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
   * 转换 FFLogs 插件输入。
   * @param value - 待转换值；影响 normalizeLookupKey 的返回值。
   */
  private normalizeLookupKey(value: string) {
    return `${value || ''}`
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  /**
   * 创建 FFLogs 插件对象或配置。
   * @param values - 配置值字典；生成 FFLogs对象。
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
   * 转换 FFLogs 插件输入。
   * @param value - 待转换值；影响 normalizeCharacterKey 的返回值。
   */
  private normalizeCharacterKey(value: string) {
    return `${value || ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }

  /**
   * 清理 FFLogs 插件状态。
   * @param input - input 输入；驱动 `Object.entries()` 的 FFLogs步骤。
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
   * 查询 FFLogs 插件数据。
   */
  private getDefaultServer() {
    return this.host.getConfig<string>('FFLOGS_DEFAULT_SERVER') || '';
  }

  /**
   * 查询 FFLogs 插件数据。
   */
  private getDefaultServerRegion() {
    return this.host.getConfig<string>('FFLOGS_DEFAULT_SERVER_REGION') || 'CN';
  }

  /**
   * 查询 FFLogs 插件数据。
   */
  private getTimeoutMs() {
    return Number(this.host.getConfig('FFLOGS_REQUEST_TIMEOUT_MS') || 10_000);
  }
}
