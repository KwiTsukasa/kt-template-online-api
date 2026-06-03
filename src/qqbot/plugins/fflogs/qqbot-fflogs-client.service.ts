import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';

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
  server?: {
    name?: string;
    slug?: string;
  };
  zoneRankings?: unknown;
};

type FflogsCharacterSummaryResponse = {
  characterData?: {
    character?: FflogsCharacter | null;
  };
};

type FflogsRankingItem = Record<string, any>;

export type QqbotFflogsCharacterSummaryInput = {
  character?: string;
  characterName?: string;
  className?: string;
  difficulty?: number | string;
  metric?: string;
  partition?: number | string;
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

  constructor(private readonly configService: ConfigService) {
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

    return {
      allStarText,
      characterId: character.id,
      characterName: character.name || characterName,
      rankings,
      replyText: this.buildReplyText({
        allStarText,
        characterId: character.id,
        characterName: character.name || characterName,
        rankings,
        serverName,
        serverRegion,
        url,
      }),
      serverName,
      serverRegion,
      url,
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
    rankings: FflogsRankingItem[];
    serverName: string;
    serverRegion: string;
    url: string;
  }) {
    const header = `FFLogs：${params.characterName} - ${params.serverName} (${params.serverRegion})`;
    const idText = params.characterId ? `角色 ID：${params.characterId}` : '';
    const rankingText = params.rankings.length
      ? params.rankings
          .map((item, index) => this.formatRanking(item, index))
          .join('\n')
      : '暂无公开排名数据';
    return [header, idText, params.allStarText, rankingText, params.url]
      .filter(Boolean)
      .join('\n');
  }

  private formatRanking(item: FflogsRankingItem, index: number) {
    const encounter = this.pickText(
      item.encounter?.name,
      item.encounterName,
      item.name,
      `记录 ${index + 1}`,
    );
    const percent = this.pickNumber(
      item.rankPercent,
      item.percentile,
      item.bestPercent,
      item.historicalPercent,
    );
    const amount = this.pickNumber(item.bestAmount, item.amount, item.total);
    const spec = this.pickText(item.spec, item.specName, item.class, item.role);
    const rank = this.pickText(item.rank, item.regionRank, item.serverRank);
    const parts = [
      `${index + 1}. ${encounter}`,
      percent !== undefined ? `${this.formatNumber(percent)}%` : '',
      amount !== undefined ? this.formatNumber(amount) : '',
      spec,
      rank ? `Rank ${rank}` : '',
    ].filter(Boolean);
    return parts.join(' / ');
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
      points !== undefined ? `全明星分：${this.formatNumber(points)}` : '',
      rank ? `名次：${rank}` : '',
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

  private normalizeMetric(value?: string) {
    const raw = `${value || ''}`.trim();
    if (!raw) return undefined;
    const lower = raw.toLowerCase();
    const map: Record<string, string> = {
      cdps: 'DPS',
      damage: 'DPS',
      dps: 'DPS',
      healer: 'HPS',
      healing: 'HPS',
      hps: 'HPS',
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
    return value.toLocaleString('en-US', {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    });
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
