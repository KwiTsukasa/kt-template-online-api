import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import { DictService } from '../../../admin/dict/dict.service';

type HttpMethod = 'GET' | 'POST';

type FflogsTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

type FflogsGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type FflogsCharacter = {
  id?: number;
  lodestoneID?: number;
  name?: string;
  recentReports?: {
    data?: FflogsRecentReport[];
  };
  server?: {
    name?: string;
    slug?: string;
  };
  zoneRankings?: unknown;
};

type FflogsReportFight = {
  difficulty?: number | null;
  encounterID?: number;
  endTime?: number;
  id?: number;
  kill?: boolean | null;
  name?: string;
  startTime?: number;
};

type FflogsRecentReport = {
  code?: string;
  endTime?: number;
  fights?: FflogsReportFight[];
  startTime?: number;
  title?: string;
  zone?: {
    id?: number;
    name?: string;
  };
};

type FflogsCharacterSummaryResponse = {
  characterData?: {
    character?: FflogsCharacter | null;
  };
};

type FflogsReportFightMetricsResponse = {
  reportData?: {
    report?: {
      damage?: unknown;
      dpsRankings?: unknown;
      healing?: unknown;
      hpsRankings?: unknown;
    } | null;
  };
};

type FflogsRankingItem = Record<string, any>;

type FflogsEncounterLookup = {
  displayName: string;
  encounterId?: number;
  input: string;
  keys: string[];
};

type FflogsEncounterFightCandidate = {
  absoluteStartTime: number;
  fight: FflogsReportFight;
  report: FflogsRecentReport;
};

type FflogsParseMetric = {
  amount?: number;
  color: string;
  percent?: number;
  rank?: string;
};

export type QqbotFflogsEncounterLogItem = {
  adps?: number;
  color: string;
  damageScore?: number;
  dps?: number;
  durationMs?: number;
  encounterName: string;
  fightId?: number;
  healingColor: string;
  healingScore?: number;
  hps?: number;
  kill?: boolean | null;
  logCode: string;
  logUrl: string;
  ndps?: number;
  rdps?: number;
  reportTitle?: string;
  startTime?: number;
};

const FFLOGS_LOCALIZATION_DICT_CODES = {
  encounter: 'FFLOGS_ENCOUNTER_LABEL',
  job: 'FFLOGS_JOB_LABEL',
  metric: 'FFLOGS_METRIC_LABEL',
  role: 'FFLOGS_ROLE_LABEL',
  serverRegion: 'FFLOGS_SERVER_REGION_LABEL',
};

type FflogsLocalizationMaps = Record<
  keyof typeof FFLOGS_LOCALIZATION_DICT_CODES,
  Map<string, string>
>;

export type QqbotFflogsCharacterSummaryInput = {
  character?: string;
  characterName?: string;
  className?: string;
  difficulty?: number | string;
  encounter?: string;
  encounterName?: string;
  limit?: number | string;
  metric?: string;
  partition?: number | string;
  reportsLimit?: number | string;
  role?: string;
  server?: string;
  serverRegion?: string;
  serverSlug?: string;
  size?: number | string;
  specName?: string;
  timeframe?: string;
  zoneId?: number | string;
};

export type QqbotFflogsCharacterSummaryResult = {
  allStarText?: string;
  characterId?: number;
  characterName: string;
  encounterName?: string;
  logs?: QqbotFflogsEncounterLogItem[];
  rankings: FflogsRankingItem[];
  replyText: string;
  serverName: string;
  serverRegion: string;
  url: string;
};

@Injectable()
export class QqbotFflogsClientService {
  private accessToken = '';
  private accessTokenExpireAt = 0;
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly graphqlUrl: string;
  private readonly tokenUrl: string;
  private readonly webBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly dictService: DictService,
  ) {
    this.baseUrl = this.normalizeBaseUrl(
      this.configService.get<string>('FFLOGS_BASE_URL') ||
        'https://www.fflogs.com',
    );
    this.webBaseUrl = this.normalizeBaseUrl(
      this.configService.get<string>('FFLOGS_WEB_BASE_URL') ||
        'https://cn.fflogs.com',
    );
    this.graphqlUrl =
      this.configService.get<string>('FFLOGS_GRAPHQL_URL') ||
      `${this.baseUrl}/api/v2/client`;
    this.tokenUrl =
      this.configService.get<string>('FFLOGS_TOKEN_URL') ||
      `${this.baseUrl}/oauth/token`;
    this.clientId = `${
      this.configService.get<string>('FFLOGS_CLIENT_ID') || ''
    }`.trim();
    this.clientSecret = `${
      this.configService.get<string>('FFLOGS_CLIENT_SECRET') || ''
    }`.trim();
  }

  async checkHealth() {
    await this.getAccessToken();
    return true;
  }

  async getCharacterSummary(
    params: QqbotFflogsCharacterSummaryInput,
  ): Promise<QqbotFflogsCharacterSummaryResult> {
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
      `query QqbotFflogsCharacterSummary(
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

  private async getCharacterEncounterLogs(
    params: QqbotFflogsCharacterSummaryInput,
  ): Promise<QqbotFflogsCharacterSummaryResult> {
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
      `query QqbotFflogsCharacterEncounterReports(
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
    const difficulty = this.toOptionalNumber(params.difficulty);
    const candidates = this.pickEncounterFightCandidates(
      character.recentReports?.data || [],
      encounterLookup,
      difficulty,
    );
    const metricCandidates = candidates.slice(0, Math.min(limit * 3, 30));

    const logs = (
      await Promise.all(
        metricCandidates.map((candidate) =>
          this.getEncounterFightLog({
            candidate,
            characterId: character.id,
            characterName: character.name || characterName,
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

    return {
      characterId: character.id,
      characterName: character.name || characterName,
      encounterName: encounterLookup.displayName,
      logs,
      rankings: [],
      replyText: this.buildEncounterLogsReplyText({
        characterId: character.id,
        characterName: character.name || characterName,
        encounterName: encounterLookup.displayName,
        logs,
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

  private async getEncounterFightLog(params: {
    candidate: FflogsEncounterFightCandidate;
    characterId?: number;
    characterName: string;
    encounterLookup: FflogsEncounterLookup;
    localizationMaps: FflogsLocalizationMaps;
    serverName: string;
    serverRegion: string;
    serverSlug: string;
  }): Promise<QqbotFflogsEncounterLogItem | null> {
    const { candidate } = params;
    const code = `${candidate.report.code || ''}`.trim();
    const fightId = this.toOptionalNumber(candidate.fight.id);
    const encounterId = this.toOptionalNumber(candidate.fight.encounterID);
    if (!code || fightId === undefined || encounterId === undefined) {
      return null;
    }

    const data = await this.requestGraphql<FflogsReportFightMetricsResponse>(
      `query QqbotFflogsEncounterFightMetrics(
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
            )
            healing: table(
              dataType: Healing
              encounterID: $encounterID
              fightIDs: $fightIDs
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
        candidate.fight.name,
        params.encounterLookup.displayName,
        `任务 ${candidate.fight.encounterID || ''}`,
      ),
      params.localizationMaps,
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

  private async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpireAt) {
      return this.accessToken;
    }
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
    this.accessToken = data.access_token;
    this.accessTokenExpireAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
    return this.accessToken;
  }

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

  private requestJson<T>(
    url: URL,
    method: HttpMethod,
    options: { body?: string; headers?: Record<string, string> } = {},
  ) {
    return new Promise<T>((resolve, reject) => {
      const client = url.protocol === 'http:' ? http : https;
      const request = client.request(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'kt-template-online-api/qqbot',
            ...(options.headers || {}),
          },
          method,
          timeout: this.getTimeoutMs(),
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            if ((response.statusCode || 500) >= 400) {
              reject(new Error(`FFLogs 请求失败：${response.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new Error('FFLogs 返回不是合法 JSON'));
            }
          });
        },
      );
      request.on('timeout', () => {
        request.destroy(new Error('FFLogs 请求超时'));
      });
      request.on('error', reject);
      if (options.body) request.write(options.body);
      request.end();
    });
  }

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
    return [header, idText, params.allStarText, rankingText, params.url]
      .filter(Boolean)
      .join('\n');
  }

  private buildEncounterLogsReplyText(params: {
    characterId?: number;
    characterName: string;
    encounterName: string;
    localizationMaps: FflogsLocalizationMaps;
    logs: QqbotFflogsEncounterLogItem[];
    serverName: string;
    serverRegion: string;
    url: string;
  }) {
    const region = this.localizeServerRegion(
      params.serverRegion,
      params.localizationMaps,
    );
    const header = `FFLogs 最近记录：${params.characterName} @ ${params.serverName}（${region}）`;
    const encounterText = `高难任务：${params.encounterName}`;
    const idText = params.characterId ? `角色ID：${params.characterId}` : '';
    const logText = params.logs.length
      ? [
          '最近10次：',
          ...params.logs.map((item, index) =>
            this.formatEncounterLogLine(item, index),
          ),
        ].join('\n')
      : '最近10次：暂无匹配的公开记录';

    return [header, encounterText, idText, logText, params.url]
      .filter(Boolean)
      .join('\n');
  }

  private formatEncounterLogLine(
    item: QqbotFflogsEncounterLogItem,
    index: number,
  ) {
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
      `DPS ${this.formatMetricNumber(item.dps)}`,
      `aDPS ${this.formatMetricNumber(item.adps)}`,
      `rDPS ${this.formatMetricNumber(item.rdps)}`,
      `nDPS ${this.formatMetricNumber(item.ndps)}`,
      `HPS ${this.formatMetricNumber(item.hps)}`,
    ].join(' / ');
    return `${index + 1}. ${this.formatLogTime(
      item.startTime,
    )}｜${status}｜颜色 ${item.color}｜输出 ${damageScore}｜治疗 ${
      item.healingColor
    } ${healingScore}｜${metrics}｜log ${item.logCode}#${item.fightId}`;
  }

  private pickEncounterFightCandidates(
    reports: FflogsRecentReport[],
    encounterLookup: FflogsEncounterLookup,
    difficulty?: number,
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
      .filter(({ fight }) => this.matchEncounterFight(fight, encounterLookup))
      .filter(
        ({ fight }) =>
          difficulty === undefined || Number(fight.difficulty) === difficulty,
      )
      .sort((a, b) => b.absoluteStartTime - a.absoluteStartTime);
  }

  private matchEncounterFight(
    fight: FflogsReportFight,
    encounterLookup: FflogsEncounterLookup,
  ) {
    if (
      encounterLookup.encounterId !== undefined &&
      Number(fight.encounterID) === encounterLookup.encounterId
    ) {
      return true;
    }
    const fightKeys = this.buildLookupKeys(
      `${fight.name || ''}`,
      `${fight.encounterID || ''}`,
    );
    return encounterLookup.keys.some((key) => fightKeys.includes(key));
  }

  private async resolveEncounterLookup(
    input: string,
  ): Promise<FflogsEncounterLookup> {
    const raw = `${input || ''}`.trim();
    const inputKeys = this.buildLookupKeys(raw);
    const dicts = await this.dictService.getDictItemsByKey(
      FFLOGS_LOCALIZATION_DICT_CODES.encounter,
    );
    const entries = dicts.map((item) => ({
      displayName: `${item.label || item.value}`.trim(),
      encounterId: this.toOptionalNumber(item.value),
      keys: this.buildLookupKeys(`${item.label}`, `${item.value}`),
    }));
    const exact = entries.find((entry) =>
      inputKeys.some((inputKey) => entry.keys.includes(inputKey)),
    );
    const prefix = exact
      ? undefined
      : entries.find((entry) =>
          inputKeys.some(
            (inputKey) =>
              inputKey.length >= 3 &&
              entry.keys.some(
                (key) => key.startsWith(inputKey) || key.includes(inputKey),
              ),
          ),
        );
    const matched = exact || prefix;

    if (!matched) {
      return {
        displayName: raw,
        encounterId: this.toOptionalNumber(raw),
        input: raw,
        keys: inputKeys,
      };
    }

    return {
      displayName: matched.displayName,
      encounterId: matched.encounterId,
      input: raw,
      keys: [...new Set([...matched.keys, ...inputKeys])],
    };
  }

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

  private extractParseMetric(item: any): FflogsParseMetric {
    const percent = this.pickNumber(item?.rankPercent, item?.bracketPercent);
    return {
      amount: this.pickNumber(item?.amount),
      color: this.getParseColor(percent),
      percent,
      rank: this.pickText(item?.rank, item?.best),
    };
  }

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
      localizationMaps,
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

  private buildCharacterUrl(
    serverRegion: string,
    serverSlug: string,
    characterName: string,
  ) {
    return `${this.webBaseUrl}/character/${encodeURIComponent(
      serverRegion.toLowerCase(),
    )}/${encodeURIComponent(serverSlug)}/${encodeURIComponent(characterName)}`;
  }

  private buildReportFightUrl(code: string, fightId: number) {
    return `${this.webBaseUrl}/reports/${encodeURIComponent(
      code,
    )}#fight=${encodeURIComponent(`${fightId}`)}`;
  }

  private normalizeEncounterInput(params: QqbotFflogsCharacterSummaryInput) {
    return `${params.encounterName || params.encounter || ''}`.trim();
  }

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

  private normalizeTimeframe(value?: string) {
    const raw = `${value || ''}`.trim();
    if (!raw) return undefined;
    const lower = raw.toLowerCase();
    if (['today', 'current', '当前', '今天'].includes(lower)) return 'Today';
    if (['historical', 'history', '历史'].includes(lower)) return 'Historical';
    return raw;
  }

  private toOptionalNumber(value?: number | string) {
    if (value === undefined || value === null || `${value}`.trim() === '') {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

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

  private toPerSecond(value: any, durationMs?: number) {
    const amount = this.pickNumber(value);
    if (amount === undefined || !durationMs || durationMs <= 0)
      return undefined;
    return amount / (durationMs / 1000);
  }

  private normalizeOptionalString(value?: string) {
    const raw = `${value || ''}`.trim();
    return raw || undefined;
  }

  private pickText(...values: any[]) {
    const picked = values.find(
      (item) => item !== undefined && item !== null && `${item}`.trim() !== '',
    );
    return picked === undefined ? '' : `${picked}`;
  }

  private pickNumber(...values: any[]) {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private formatNumber(value: number) {
    const digits = Math.abs(value) >= 100 ? 0 : 1;
    return value.toLocaleString('zh-CN', {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    });
  }

  private formatMetricNumber(value?: number) {
    return value === undefined ? '-' : this.formatNumber(value);
  }

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

  private formatRank(value: string) {
    const rank = value.replace(/^#/, '').trim();
    if (!rank) return '';
    if (rank.startsWith('第') || rank.endsWith('名')) return `排名${rank}`;
    return `排名第${rank}`;
  }

  private hasMeaningfulRanking(percent?: number, amount?: number) {
    return (
      (percent !== undefined && percent > 0) ||
      (amount !== undefined && amount > 0)
    );
  }

  private async getLocalizationMaps(): Promise<FflogsLocalizationMaps> {
    const [encounter, job, metric, role, serverRegion] = await Promise.all([
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.encounter),
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.job),
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.metric),
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.role),
      this.getNormalizedDictMap(FFLOGS_LOCALIZATION_DICT_CODES.serverRegion),
    ]);

    return {
      encounter,
      job,
      metric,
      role,
      serverRegion,
    };
  }

  private async getNormalizedDictMap(dictCode: string) {
    const dicts = await this.dictService.getDictByKey(dictCode);
    const map = new Map<string, string>();
    for (const { label, value } of dicts) {
      for (const key of this.buildLookupKeys(`${value}`, `${label}`)) {
        map.set(key, `${label}`);
      }
    }
    return map;
  }

  private localizeEncounter(
    value: string,
    localizationMaps: FflogsLocalizationMaps,
  ) {
    return (
      localizationMaps.encounter.get(this.normalizeLookupKey(value)) || value
    );
  }

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

  private localizeServerRegion(
    value: string,
    localizationMaps: FflogsLocalizationMaps,
  ) {
    return (
      localizationMaps.serverRegion.get(this.normalizeLookupKey(value)) ||
      value.toUpperCase()
    );
  }

  private localizeSpec(
    value: string,
    localizationMaps: FflogsLocalizationMaps,
  ) {
    const key = this.normalizeLookupKey(value);
    return (
      localizationMaps.job.get(key) || localizationMaps.role.get(key) || value
    );
  }

  private normalizeLookupKey(value: string) {
    return `${value || ''}`
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

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

  private normalizeCharacterKey(value: string) {
    return `${value || ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }

  private removeUndefined(input: Record<string, any>) {
    return Object.entries(input).reduce<Record<string, any>>(
      (result, [key, value]) => {
        if (value !== undefined && value !== '') result[key] = value;
        return result;
      },
      {},
    );
  }

  private normalizeBaseUrl(value: string) {
    return value.replace(/\/+$/, '');
  }

  private getDefaultServer() {
    return this.configService.get<string>('FFLOGS_DEFAULT_SERVER') || '';
  }

  private getDefaultServerRegion() {
    return (
      this.configService.get<string>('FFLOGS_DEFAULT_SERVER_REGION') || 'CN'
    );
  }

  private getTimeoutMs() {
    return Number(
      this.configService.get('FFLOGS_REQUEST_TIMEOUT_MS') || 10_000,
    );
  }
}
