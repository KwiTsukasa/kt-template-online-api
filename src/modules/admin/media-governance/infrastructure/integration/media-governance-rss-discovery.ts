import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { MediaGovernanceMediaType } from '../../contract/media-governance.dto';
import {
  searchTmdbMediaCandidates,
  verifyTmdbMediaCandidate,
} from './media-governance-provider-search';
import {
  mediaGovernanceMagnetInfoHash,
  normalizeMediaGovernanceMagnetUri,
} from './media-governance-rss-parser';

const DISCOVERY_TIMEOUT_MS = 12_000;
const MAX_DISCOVERY_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_IDENTITY_CANDIDATES = 12;
const MAX_SOURCE_ITEMS = 60;
const MAX_RELEASE_GROUPS = 40;
const MAX_GROUP_ITEMS = 20;

export type MediaGovernanceRssIdentityProvider = 'bangumi' | 'tmdb';

export type MediaGovernanceRssDiscoveryProvider =
  | 'acg-rip'
  | 'anibt'
  | 'bangumi-moe'
  | 'dmhy'
  | 'mikan'
  | 'nekobt'
  | 'nyaa'
  | 'shana-project'
  | 'subsplease';

export interface MediaGovernanceRssIdentityCandidate {
  candidateId: string;
  episodeCount: null | number;
  originalTitle: null | string;
  posterUrl: null | string;
  provider: MediaGovernanceRssIdentityProvider;
  providerId: string;
  releaseYear: null | number;
  title: string;
}

export interface MediaGovernanceRssIdentitySearchResult {
  items: MediaGovernanceRssIdentityCandidate[];
  providers: MediaGovernanceRssDiscoveryProviderStatus[];
}

export interface MediaGovernanceRssSelectedIdentity {
  provider: MediaGovernanceRssIdentityProvider;
  providerId: string;
  releaseYear: null | number;
}

export interface MediaGovernanceRssDiscoveryContext {
  identity: MediaGovernanceRssSelectedIdentity;
  mediaType?: MediaGovernanceMediaType;
  originalTitle: null | string;
  releaseYear: number;
  seasonNumber: number;
  seriesTitle: string;
}

export interface MediaGovernanceRssDiscoveryProviderStatus {
  errorCode: null | string;
  itemCount: number;
  label: string;
  provider:
    | MediaGovernanceRssDiscoveryProvider
    | MediaGovernanceRssIdentityProvider;
  rssCapable: boolean;
  status: 'available' | 'unavailable';
}

export interface MediaGovernanceRssDiscoverySourceRef {
  detailUrl: null | string;
  feedUrl: null | string;
  label: string;
  magnetUri: null | string;
  provider: MediaGovernanceRssDiscoveryProvider;
  torrentUrl: null | string;
}

export interface MediaGovernanceRssDiscoveryItem {
  id: string;
  infoHash: null | string;
  providers: MediaGovernanceRssDiscoverySourceRef[];
  publishedAt: null | string;
  releaseGroup: string;
  seeders: null | number;
  sizeBytes: null | number;
  title: string;
}

export interface MediaGovernanceRssDiscoverySubscriptionOption {
  feedUrl: string;
  itemCount: number;
  label: string;
  provider: MediaGovernanceRssDiscoveryProvider;
}

export interface MediaGovernanceRssDiscoveryGroup {
  groupId: string;
  includePattern: string;
  items: MediaGovernanceRssDiscoveryItem[];
  latestPublishedAt: null | string;
  maxSeeders: null | number;
  providerCount: number;
  providers: MediaGovernanceRssDiscoveryProvider[];
  releaseGroup: string;
  subscriptionOptions: MediaGovernanceRssDiscoverySubscriptionOption[];
  uniqueItemCount: number;
}

export interface MediaGovernanceRssDiscoveryResult {
  groups: MediaGovernanceRssDiscoveryGroup[];
  identity: MediaGovernanceRssIdentityCandidate;
  providers: MediaGovernanceRssDiscoveryProviderStatus[];
  queriedAt: string;
  totalUniqueItems: number;
}

interface MediaGovernanceRssDiscoveryOptions {
  fetchImpl?: typeof fetch;
  searchTmdb?: typeof searchTmdbMediaCandidates;
  verifyTmdb?: typeof verifyTmdbMediaCandidate;
}

interface ResolvedDiscoveryIdentity extends MediaGovernanceRssIdentityCandidate {
  aliases: string[];
}

interface RawDiscoveryItem {
  detailUrl: null | string;
  explicitGroup: null | string;
  feedUrl: null | string;
  infoHash: null | string;
  magnetUri: null | string;
  preferExplicitGroup?: boolean;
  provider: MediaGovernanceRssDiscoveryProvider;
  publishedAt: null | string;
  seeders: null | number;
  sizeBytes: null | number;
  title: string;
  torrentUrl: null | string;
}

interface ProviderSearchResult {
  items: RawDiscoveryItem[];
  provider: MediaGovernanceRssDiscoveryProvider;
  subscriptions?: RawDiscoverySubscription[];
}

interface BangumiIdentitySearchContract {
  platform: 'TV' | '剧场版' | '电影';
  subjectType: 2 | 6;
}

interface RawDiscoverySubscription {
  feedUrl: string;
  provider: MediaGovernanceRssDiscoveryProvider;
  releaseGroup: string;
}

interface ProviderDefinition {
  label: string;
  rssCapable: boolean;
}

const PROVIDER_DEFINITIONS: Record<
  MediaGovernanceRssDiscoveryProvider,
  ProviderDefinition
> = {
  'acg-rip': { label: 'ACG.RIP', rssCapable: true },
  anibt: { label: 'AniBT', rssCapable: true },
  'bangumi-moe': { label: 'Bangumi.moe', rssCapable: false },
  dmhy: { label: '动漫花园', rssCapable: true },
  mikan: { label: 'Mikan', rssCapable: true },
  nekobt: { label: 'nekoBT', rssCapable: true },
  nyaa: { label: 'Nyaa', rssCapable: true },
  'shana-project': { label: 'Shana Project', rssCapable: false },
  subsplease: { label: 'SubsPlease', rssCapable: false },
};

/**
 * 同时查询 Bangumi 与 TMDB 的 TV 身份候选，并把单个资料源失败保留为独立状态。
 *
 * @param keyword - 用户输入的作品名称或别名。
 * @param options - 测试可替换的网络读取和 TMDB 查询实现。
 * @returns 有界身份候选及两个资料源的可用状态。
 */
export async function searchMediaGovernanceRssIdentityCandidates(
  keyword: string,
  options: MediaGovernanceRssDiscoveryOptions = {},
): Promise<MediaGovernanceRssIdentitySearchResult> {
  return searchMediaGovernanceIdentityCandidates(keyword, 'tv', options);
}

/**
 * 根据用户选择的 Work 类型并行查询 Bangumi 与 TMDB，供 Series/Work 创建显式选择身份。
 *
 * @param keyword - 用户输入的作品名称或别名。
 * @param mediaType - 待创建 Work 的 TV、电影或剧场版类型。
 * @param options - 测试可替换的网络读取和 TMDB 查询实现。
 * @returns 有界身份候选及两个资料源的可用状态。
 */
export async function searchMediaGovernanceCatalogIdentityCandidates(
  keyword: string,
  mediaType: MediaGovernanceMediaType,
  options: MediaGovernanceRssDiscoveryOptions = {},
): Promise<MediaGovernanceRssIdentitySearchResult> {
  return searchMediaGovernanceIdentityCandidates(keyword, mediaType, options);
}

/**
 * 将身份关键词与 Work 类型投影到两个固定资料源，并隔离单个上游失败。
 *
 * @param keyword - 用户输入的作品名称或别名。
 * @param mediaType - Bangumi 与 TMDB 共用的作品类型合同。
 * @param options - 测试可替换的网络读取和 TMDB 查询实现。
 * @returns 有界身份候选及两个资料源的可用状态。
 */
async function searchMediaGovernanceIdentityCandidates(
  keyword: string,
  mediaType: MediaGovernanceMediaType,
  options: MediaGovernanceRssDiscoveryOptions,
): Promise<MediaGovernanceRssIdentitySearchResult> {
  const normalizedKeyword = boundedSearchText(keyword, 'identity keyword');
  const fetchImpl = options.fetchImpl ?? fetch;
  const searchTmdb = options.searchTmdb ?? searchTmdbMediaCandidates;
  const bangumiPromise = searchBangumiIdentityCandidates(
    normalizedKeyword,
    mediaType,
    fetchImpl,
  );
  const tmdbPromise = searchTmdb({
    mediaType,
    releaseYear: null,
    title: normalizedKeyword,
  });
  const settled = await Promise.allSettled([bangumiPromise, tmdbPromise]);
  const items: MediaGovernanceRssIdentityCandidate[] = [];
  const providers: MediaGovernanceRssDiscoveryProviderStatus[] = [];

  const bangumiResult = settled[0];
  if (bangumiResult.status === 'fulfilled') {
    items.push(...bangumiResult.value);
    providers.push(
      identityProviderStatus('bangumi', bangumiResult.value.length),
    );
  } else {
    providers.push(identityProviderFailure('bangumi'));
  }

  const tmdbResult = settled[1];
  if (tmdbResult.status === 'fulfilled') {
    const tmdbItems = tmdbResult.value.map((candidate) => ({
      candidateId: candidate.candidateId,
      episodeCount: null,
      originalTitle: candidate.originalTitle,
      posterUrl: candidate.posterUrl,
      provider: candidate.provider,
      providerId: candidate.providerId,
      releaseYear: candidate.releaseYear,
      title: candidate.title,
    }));
    items.push(...tmdbItems);
    providers.push(identityProviderStatus('tmdb', tmdbItems.length));
  } else {
    providers.push(identityProviderFailure('tmdb'));
  }

  items.sort((left, right) => {
    const leftScore = identityCandidateScore(left, normalizedKeyword);
    const rightScore = identityCandidateScore(right, normalizedKeyword);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.title.localeCompare(right.title, 'zh-CN');
  });
  return { items: items.slice(0, MAX_IDENTITY_CANDIDATES), providers };
}

/**
 * 重新核验用户选择的身份，再并发查询九个固定来源并按 BTIH 和发布组聚合结果。
 *
 * @param context - Series/Season 上下文与用户明确选择的资料身份。
 * @param options - 测试可替换的网络读取和 TMDB 详情核验实现。
 * @returns 逐源状态、跨站去重条目及发布组聚合结果。
 */
export async function discoverMediaGovernanceRssSources(
  context: MediaGovernanceRssDiscoveryContext,
  options: MediaGovernanceRssDiscoveryOptions = {},
): Promise<MediaGovernanceRssDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const identity = await resolveDiscoveryIdentity(context, options);
  const aliases = identity.aliases;
  const searches: Array<{
    promise: Promise<ProviderSearchResult>;
    provider: MediaGovernanceRssDiscoveryProvider;
  }> = [
    { promise: searchMikan(aliases, fetchImpl), provider: 'mikan' },
    {
      promise: searchBangumiMoe(aliases, fetchImpl),
      provider: 'bangumi-moe',
    },
    { promise: searchNyaa(aliases, fetchImpl), provider: 'nyaa' },
    { promise: searchAcgRip(aliases, fetchImpl), provider: 'acg-rip' },
    { promise: searchDmhy(aliases, fetchImpl), provider: 'dmhy' },
    { promise: searchAniBt(aliases, fetchImpl), provider: 'anibt' },
    {
      promise: searchShanaProject(aliases, fetchImpl),
      provider: 'shana-project',
    },
    { promise: searchNekoBt(aliases, fetchImpl), provider: 'nekobt' },
    {
      promise: searchSubsPlease(aliases, fetchImpl),
      provider: 'subsplease',
    },
  ];
  const settled = await Promise.allSettled(
    searches.map((search) => search.promise),
  );
  const rawItems: RawDiscoveryItem[] = [];
  const rawSubscriptions: RawDiscoverySubscription[] = [];
  const providers: MediaGovernanceRssDiscoveryProviderStatus[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const provider = searches[index].provider;
    const result = settled[index];
    if (result.status === 'fulfilled') {
      rawItems.push(...result.value.items);
      rawSubscriptions.push(...(result.value.subscriptions ?? []));
      providers.push(sourceProviderStatus(provider, result.value.items.length));
    } else {
      providers.push(sourceProviderFailure(provider));
    }
  }
  const items = aggregateDuplicateItems(rawItems);
  const groupedItems = items.filter(
    (item) => item.releaseGroup !== '未识别发布组',
  );
  const groups = aggregateReleaseGroups(groupedItems, rawSubscriptions);
  return {
    groups,
    identity,
    providers,
    queriedAt: new Date().toISOString(),
    totalUniqueItems: groupedItems.length,
  };
}

/**
 * 通过固定官方详情重新核验订阅携带的资料身份，并只返回可持久化的公开证据字段。
 *
 * @param context - Series/Season 上下文与用户明确选择的资料身份。
 * @param options - 测试可替换的网络与 TMDB 核验实现。
 * @returns 已核验的来源、编号、标题、年份、海报和集数证据。
 */
export async function verifyMediaGovernanceRssIdentity(
  context: MediaGovernanceRssDiscoveryContext,
  options: MediaGovernanceRssDiscoveryOptions = {},
): Promise<MediaGovernanceRssIdentityCandidate> {
  const identity = await resolveDiscoveryIdentity(context, options);
  return {
    candidateId: identity.candidateId,
    episodeCount: identity.episodeCount,
    originalTitle: identity.originalTitle,
    posterUrl: identity.posterUrl,
    provider: identity.provider,
    providerId: identity.providerId,
    releaseYear: identity.releaseYear,
    title: identity.title,
  };
}

/**
 * 通过固定官方详情核验 Series/Work 创建身份，并按请求类型校验 TMDB 命名空间。
 *
 * @param context - 待创建 Work 的类型、Series 上下文与用户选择身份。
 * @param options - 测试可替换的网络与 TMDB 核验实现。
 * @returns 已核验的公开身份字段。
 */
export async function verifyMediaGovernanceCatalogIdentity(
  context: MediaGovernanceRssDiscoveryContext,
  options: MediaGovernanceRssDiscoveryOptions = {},
): Promise<MediaGovernanceRssIdentityCandidate> {
  return verifyMediaGovernanceRssIdentity(context, options);
}

/**
 * 将 Work 类型映射到 Bangumi 官方 subject 类型与 platform，避免动画、三次元和不同发行形态互相污染候选。
 *
 * @param mediaType - 用户在 Series/Work 创建器中选择的作品类型。
 * @returns Bangumi 搜索和详情二次核验共用的 subject 类型与 platform。
 */
function bangumiIdentitySearchContract(
  mediaType: MediaGovernanceMediaType,
): BangumiIdentitySearchContract {
  if (mediaType === 'tv') return { platform: 'TV', subjectType: 2 };
  if (mediaType === 'theatrical') {
    return { platform: '剧场版', subjectType: 2 };
  }
  return { platform: '电影', subjectType: 6 };
}

/**
 * 查询 Bangumi 官方 subject 搜索并投影与 Work 类型一致的身份候选。
 *
 * @param keyword - 已清理的用户搜索词。
 * @param mediaType - 待创建 Work 的 TV、电影或剧场版类型。
 * @param fetchImpl - 有界网络读取实现。
 * @returns 最多十二个 subject 类型与 platform 均匹配的候选。
 */
async function searchBangumiIdentityCandidates(
  keyword: string,
  mediaType: MediaGovernanceMediaType,
  fetchImpl: typeof fetch,
): Promise<MediaGovernanceRssIdentityCandidate[]> {
  const contract = bangumiIdentitySearchContract(mediaType);
  const payload = await requestJson(
    'https://api.bgm.tv/v0/search/subjects',
    {
      body: JSON.stringify({
        filter: {
          meta_tags: [contract.platform],
          type: [contract.subjectType],
        },
        keyword,
        sort: 'match',
      }),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'KT-Media-Governance/1.0 (https://kwitsukasa.top)',
      },
      method: 'POST',
    },
    ['api.bgm.tv'],
    fetchImpl,
  );
  const root = objectValue(payload);
  const values = arrayValue(root.data);
  const candidates: MediaGovernanceRssIdentityCandidate[] = [];
  for (const value of values) {
    const item = objectValue(value);
    if (positiveInteger(item.type) !== contract.subjectType) continue;
    if (stringValue(item.platform, 32) !== contract.platform) continue;
    const providerId = positiveIntegerText(item.id);
    const originalTitle = stringValue(item.name, 200);
    const chineseTitle = stringValue(item.name_cn, 200);
    const title = chineseTitle || originalTitle;
    if (!providerId || !title) continue;
    const images = objectValue(item.images);
    const posterUrl = safeHttpsUrl(
      stringValue(images.grid, 2_048) || stringValue(item.image, 2_048),
      ['lain.bgm.tv'],
    );
    candidates.push({
      candidateId: `bangumi:${providerId}`,
      episodeCount: positiveInteger(item.eps),
      originalTitle: originalTitle || null,
      posterUrl,
      provider: 'bangumi',
      providerId,
      releaseYear: dateYear(item.date),
      title,
    });
    if (candidates.length >= MAX_IDENTITY_CANDIDATES) break;
  }
  return candidates;
}

/**
 * 通过官方详情页重新核验用户选中的 Bangumi 或 TMDB 身份并补齐可搜索别名。
 *
 * @param context - 用户选择和当前 Series 上下文。
 * @param options - 测试可替换的网络与 TMDB 核验实现。
 * @returns 经过官方详情核验的唯一身份。
 * @throws 当 provider ID 非法、核验对象不匹配请求作品类型或官方详情缺少标题时抛出稳定身份错误。
 */
async function resolveDiscoveryIdentity(
  context: MediaGovernanceRssDiscoveryContext,
  options: MediaGovernanceRssDiscoveryOptions,
): Promise<ResolvedDiscoveryIdentity> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const providerId = context.identity.providerId.trim();
  if (!/^[1-9]\d*$/u.test(providerId)) {
    throw new Error('rss-discovery-identity-invalid');
  }
  if (context.identity.provider === 'bangumi') {
    const contract = bangumiIdentitySearchContract(context.mediaType ?? 'tv');
    const payload = await requestJson(
      `https://api.bgm.tv/v0/subjects/${providerId}`,
      {
        headers: {
          'user-agent': 'KT-Media-Governance/1.0 (https://kwitsukasa.top)',
        },
        method: 'GET',
      },
      ['api.bgm.tv'],
      fetchImpl,
    );
    const item = objectValue(payload);
    if (
      positiveInteger(item.type) !== contract.subjectType ||
      stringValue(item.platform, 32) !== contract.platform
    ) {
      throw new Error('rss-discovery-identity-media-type-mismatch');
    }
    const originalTitle = stringValue(item.name, 200);
    const chineseTitle = stringValue(item.name_cn, 200);
    const title = chineseTitle || originalTitle;
    if (!title) throw new Error('rss-discovery-identity-title-missing');
    const images = objectValue(item.images);
    const additionalAliases = bangumiInfoboxAliases(item.infobox);
    const resolved: ResolvedDiscoveryIdentity = {
      aliases: [],
      candidateId: `bangumi:${providerId}`,
      episodeCount: positiveInteger(item.eps),
      originalTitle: originalTitle || null,
      posterUrl: safeHttpsUrl(stringValue(images.grid, 2_048), ['lain.bgm.tv']),
      provider: 'bangumi',
      providerId,
      releaseYear: dateYear(item.date),
      title,
    };
    resolved.aliases = discoveryAliases(resolved, context, additionalAliases);
    return resolved;
  }
  const verifyTmdb = options.verifyTmdb ?? verifyTmdbMediaCandidate;
  const verified = await verifyTmdb({
    mediaType: context.mediaType ?? 'tv',
    providerId,
    releaseYear: context.identity.releaseYear,
  });
  const resolved: ResolvedDiscoveryIdentity = {
    aliases: [],
    candidateId: verified.candidateId,
    episodeCount: null,
    originalTitle: verified.originalTitle,
    posterUrl: verified.posterUrl,
    provider: 'tmdb',
    providerId,
    releaseYear: verified.releaseYear,
    title: verified.title,
  };
  resolved.aliases = discoveryAliases(resolved, context);
  return resolved;
}

/**
 * 优先使用已核验身份标题和原名；仅在身份缺标题时回退当前 Series 标题。
 *
 * @param identity - 已重新核验的资料身份。
 * @param context - 当前 Series 标题和原名。
 * @param additionalAliases - Bangumi infobox 提供的可选国际别名。
 * @returns 保持身份标题优先级、最多八个的去重别名。
 */
function discoveryAliases(
  identity: MediaGovernanceRssIdentityCandidate,
  context: MediaGovernanceRssDiscoveryContext,
  additionalAliases: string[] = [],
): string[] {
  const aliases: string[] = [];
  const candidates = [
    identity.title,
    identity.originalTitle,
    ...additionalAliases,
  ];
  for (const candidate of candidates) {
    const value = candidate?.replace(/\s+/gu, ' ').trim() ?? '';
    if (!value || value.length > 200) continue;
    const key = normalizeSearchKey(value);
    if (aliases.some((alias) => normalizeSearchKey(alias) === key)) continue;
    aliases.push(value);
    if (aliases.length >= 8) break;
  }
  if (aliases.length > 0) return aliases;
  const fallbacks = [context.seriesTitle, context.originalTitle];
  for (const fallback of fallbacks) {
    const value = fallback?.replace(/\s+/gu, ' ').trim() ?? '';
    if (!value || value.length > 200) continue;
    aliases.push(value);
    break;
  }
  return aliases;
}

/**
 * 从 Bangumi infobox 的别名、英文名和日文名字段提取国际来源可用的标题别名。
 *
 * @param value - Bangumi subject infobox 字段。
 * @returns 最多六个去重别名。
 */
function bangumiInfoboxAliases(value: unknown): string[] {
  const aliases: string[] = [];
  for (const rawItem of arrayValue(value)) {
    const item = objectValue(rawItem);
    const key = stringValue(item.key, 80);
    if (!/(?:别名|英文名|日文名|原名|alias|english)/iu.test(key)) continue;
    for (const rawAlias of arrayValue(item.value)) {
      const aliasItem = objectValue(rawAlias);
      let alias = stringValue(aliasItem.v, 200);
      if (!alias) alias = stringValue(rawAlias, 200);
      if (!alias) continue;
      const normalized = normalizeSearchKey(alias);
      if (
        aliases.some(
          (candidate) => normalizeSearchKey(candidate) === normalized,
        )
      ) {
        continue;
      }
      aliases.push(alias);
      if (aliases.length >= 6) return aliases;
    }
  }
  return aliases;
}

/**
 * 通过精确番组页的子组 Feed 建立订阅入口和统计证据，并让普通搜索页只补充未覆盖发布条目。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns Mikan 发布条目。
 */
async function searchMikan(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const query = preferredAlias(aliases, false);
  const searchUrl = new URL('https://mikanani.kas.pub/Home/Search');
  searchUrl.searchParams.set('searchstr', query);
  const html = await requestText(
    searchUrl,
    {},
    ['mikanani.kas.pub'],
    fetchImpl,
  );
  const candidates = parseMikanBangumiCandidates(html);
  let bangumiId: null | string = null;
  for (const candidate of candidates) {
    if (aliases.some((alias) => titlesEquivalent(candidate.title, alias))) {
      bangumiId = candidate.id;
      break;
    }
  }
  const groupFeeds = new Map<string, string>();
  const groupItems: RawDiscoveryItem[] = [];
  let subscriptionGroups: Array<{
    feedUrl: string;
    releaseGroup: string;
  }> = [];
  let fallbackFeed: null | string = null;
  if (bangumiId) {
    const detailUrl = new URL(
      `/Home/Bangumi/${bangumiId}`,
      'https://mikanani.kas.pub',
    );
    const detailHtml = await requestText(
      detailUrl,
      {},
      ['mikanani.kas.pub'],
      fetchImpl,
    );
    subscriptionGroups = parseMikanGroupFeeds(detailHtml, bangumiId);
    for (const group of subscriptionGroups) {
      groupFeeds.set(
        normalizeGroupSignature(group.releaseGroup),
        group.feedUrl,
      );
    }
    fallbackFeed = `https://mikanani.kas.pub/RSS/Bangumi?bangumiId=${bangumiId}`;
    for (let offset = 0; offset < subscriptionGroups.length; offset += 4) {
      const batch = subscriptionGroups.slice(offset, offset + 4);
      const settled = await Promise.allSettled(
        batch.map((group) =>
          searchXmlFeed('mikan', new URL(group.feedUrl), [], fetchImpl, false),
        ),
      );
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        if (result.status !== 'fulfilled') continue;
        const group = batch[index];
        for (const item of result.value.items) {
          item.explicitGroup = group.releaseGroup;
          item.feedUrl = group.feedUrl;
          item.preferExplicitGroup = true;
          groupItems.push(item);
        }
      }
    }
  }
  const items = [...groupItems, ...parseMikanReleases(html)];
  for (const item of items) {
    const releaseGroup = releaseGroupName(
      item.title,
      item.explicitGroup,
      item.preferExplicitGroup,
    );
    const feed = groupFeeds.get(normalizeGroupSignature(releaseGroup));
    if (feed) {
      item.feedUrl = feed;
    } else {
      item.feedUrl = fallbackFeed;
    }
  }
  return {
    items,
    provider: 'mikan',
    subscriptions: subscriptionGroups.map((group) => ({
      ...group,
      provider: 'mikan',
    })),
  };
}

/**
 * 查询 Bangumi.moe 固定 JSON API 并保留团队、BTIH、热度和磁链证据。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns Bangumi.moe 发布条目。
 */
async function searchBangumiMoe(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const query = preferredAlias(aliases, false);
  const payload = await requestJson(
    'https://bangumi.moe/api/v2/torrent/search',
    {
      body: JSON.stringify({ p: 1, query }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    ['bangumi.moe'],
    fetchImpl,
  );
  const records = arrayValue(objectValue(payload).torrents);
  const items: RawDiscoveryItem[] = [];
  for (const value of records) {
    const record = objectValue(value);
    const title = stringValue(record.title, 512);
    if (!title || !titleMatchesAliases(title, aliases)) continue;
    const team = objectValue(record.team);
    const explicitGroup = stringValue(team.name, 160);
    items.push({
      detailUrl: 'https://bangumi.moe/',
      explicitGroup: explicitGroup || null,
      feedUrl: null,
      infoHash: normalizeInfoHash(stringValue(record.infoHash, 40)),
      magnetUri: safeMagnet(stringValue(record.magnet, 4_096)),
      provider: 'bangumi-moe',
      publishedAt: isoDate(record.publish_time),
      seeders: nonNegativeInteger(record.seeders),
      sizeBytes: parseSizeBytes(record.size),
      title,
      torrentUrl: null,
    });
    if (items.length >= MAX_SOURCE_ITEMS) break;
  }
  return { items, provider: 'bangumi-moe' };
}

/**
 * 查询 Nyaa 动画 RSS 并保留可直接创建订阅的搜索 Feed。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns Nyaa 发布条目。
 */
async function searchNyaa(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const query = preferredAlias(aliases, true);
  const feedUrl = new URL('https://nyaa.si/');
  feedUrl.searchParams.set('page', 'rss');
  feedUrl.searchParams.set('f', '0');
  feedUrl.searchParams.set('c', '1_0');
  feedUrl.searchParams.set('q', query);
  feedUrl.searchParams.set('s', 'seeders');
  feedUrl.searchParams.set('o', 'desc');
  return searchXmlFeed('nyaa', feedUrl, aliases, fetchImpl);
}

/**
 * 查询 ACG.RIP RSS 并保留固定 torrent enclosure 供订阅轮询延迟解析。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns ACG.RIP 发布条目。
 */
async function searchAcgRip(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const feedUrl = new URL('https://acg.rip/.xml');
  return searchXmlFeedWithAliasFallback(
    'acg-rip',
    feedUrl,
    'term',
    aliases,
    fetchImpl,
  );
}

/**
 * 查询动漫花园关键字 RSS，并把 Base32 BTIH 规范为十六进制磁链。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns 动漫花园发布条目。
 */
async function searchDmhy(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const feedUrl = new URL('https://share.dmhy.org/topics/rss/rss.xml');
  return searchXmlFeedWithAliasFallback(
    'dmhy',
    feedUrl,
    'keyword',
    aliases,
    fetchImpl,
  );
}

/**
 * 查询 AniBT 动画 RSS，并读取其嵌套 groupName、infohash 与 magneturi 扩展。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns AniBT 发布条目。
 */
async function searchAniBt(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const query = preferredAlias(aliases, false);
  const feedUrl = new URL('https://anibt.net/rss/magnets.xml');
  feedUrl.searchParams.set('q', query);
  return searchXmlFeed('anibt', feedUrl, aliases, fetchImpl);
}

/**
 * 将 Shana Project 的无 RSS 发布块投影为只读来源证据，不伪造可订阅 Feed。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns Shana Project 发布条目。
 */
async function searchShanaProject(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const query = preferredAlias(aliases, true);
  const url = new URL('https://www.shanaproject.com/search/');
  url.searchParams.set('title', query);
  url.searchParams.set('subber', '');
  url.searchParams.set('sort', 'date');
  url.searchParams.set('dir', 'Descending');
  const html = await requestText(url, {}, ['www.shanaproject.com'], fetchImpl);
  return {
    items: parseShanaReleases(html, aliases).slice(0, MAX_SOURCE_ITEMS),
    provider: 'shana-project',
  };
}

/**
 * 查询 nekoBT 公共 Torznab Feed，并保留真实活跃度字段。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns nekoBT 发布条目。
 */
async function searchNekoBt(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const query = preferredAlias(aliases, true);
  const feedUrl = new URL('https://nekobt.to/api/torznab/api');
  feedUrl.searchParams.set('t', 'search');
  feedUrl.searchParams.set('q', query);
  feedUrl.searchParams.set('limit', '100');
  return searchXmlFeed('nekobt', feedUrl, aliases, fetchImpl);
}

/**
 * 将 SubsPlease 搜索结果收敛为固定发布组条目，并保留其可用磁链和发布时间。
 *
 * @param aliases - 身份与 Series 的受控查询别名。
 * @param fetchImpl - 有界网络读取实现。
 * @returns SubsPlease 发布条目。
 */
async function searchSubsPlease(
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const query = preferredAlias(aliases, true);
  const url = new URL('https://subsplease.org/api/');
  url.searchParams.set('f', 'search');
  url.searchParams.set('tz', 'UTC');
  url.searchParams.set('s', query);
  const payload = await requestJson(
    url,
    { method: 'GET' },
    ['subsplease.org'],
    fetchImpl,
  );
  const root = objectValue(payload);
  const items: RawDiscoveryItem[] = [];
  for (const value of Object.values(root)) {
    const record = objectValue(value);
    const show = stringValue(record.show, 300);
    const episode = stringValue(record.episode, 80);
    if (!show || !titleMatchesAliases(show, aliases)) continue;
    const downloads = arrayValue(record.downloads);
    for (const downloadValue of downloads) {
      const download = objectValue(downloadValue);
      const resolution = stringValue(download.res, 16);
      const magnetUri = safeMagnet(stringValue(download.magnet, 4_096));
      if (!magnetUri) continue;
      let title = `[SubsPlease] ${show}`;
      if (episode) title += ` - ${episode}`;
      if (resolution) title += ` (${resolution}p)`;
      const page = stringValue(record.page, 200);
      let detailUrl: null | string = null;
      if (page) detailUrl = `https://subsplease.org/shows/${page}/`;
      items.push({
        detailUrl,
        explicitGroup: 'SubsPlease',
        feedUrl: null,
        infoHash: safeInfoHashFromMagnet(magnetUri),
        magnetUri,
        provider: 'subsplease',
        publishedAt: isoDate(record.release_date),
        seeders: null,
        sizeBytes: null,
        title,
        torrentUrl: null,
      });
      if (items.length >= MAX_SOURCE_ITEMS) break;
    }
    if (items.length >= MAX_SOURCE_ITEMS) break;
  }
  return { items, provider: 'subsplease' };
}

/**
 * 读取一个固定 XML Feed，并投影通用 RSS、Torznab、Nyaa 与 AniBT 扩展字段。
 *
 * @param provider - 当前固定来源标识。
 * @param feedUrl - 由服务端构造的查询 Feed。
 * @param aliases - 用于剔除上游宽泛匹配的身份别名。
 * @param fetchImpl - 有界网络读取实现。
 * @param requireAliasMatch - 是否仍需按身份别名过滤精确组级 Feed。
 * @returns 指定来源的有界发布条目。
 */
async function searchXmlFeed(
  provider: MediaGovernanceRssDiscoveryProvider,
  feedUrl: URL,
  aliases: string[],
  fetchImpl: typeof fetch,
  requireAliasMatch = true,
): Promise<ProviderSearchResult> {
  const xml = await requestText(
    feedUrl,
    { headers: { accept: 'application/rss+xml, application/xml, text/xml' } },
    [feedUrl.hostname],
    fetchImpl,
  );
  const parser = new XMLParser({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    removeNSPrefix: true,
    textNodeName: '#text',
    trimValues: true,
  });
  const document = objectValue(parser.parse(xml));
  const rss = objectValue(document.rss);
  const channel = objectValue(rss.channel);
  const values = arrayValue(channel.item);
  const items: RawDiscoveryItem[] = [];
  for (const value of values) {
    const item = objectValue(value);
    const title = nodeText(item.title, 512);
    if (!title) continue;
    if (requireAliasMatch && !titleMatchesAliases(title, aliases)) continue;
    const nestedTorrent = objectValue(item.torrent);
    const magnetUri = firstMagnet([
      item.magnetURI,
      item.magneturi,
      nestedTorrent.magnetURI,
      nestedTorrent.magneturi,
      item.link,
      enclosureValue(item, '@_url'),
      torznabAttribute(item, 'magneturl'),
    ]);
    let infoHash = normalizeInfoHash(
      nodeText(
        item.infoHash ??
          item.infohash ??
          nestedTorrent.infoHash ??
          nestedTorrent.infohash ??
          torznabAttribute(item, 'infohash'),
        40,
      ),
    );
    if (!infoHash && magnetUri) infoHash = safeInfoHashFromMagnet(magnetUri);
    const explicitGroup =
      nodeText(item.author ?? item.groupName ?? nestedTorrent.groupName, 160) ||
      null;
    items.push({
      detailUrl: firstHttpUrl([item.guid, item.comments, item.link], false),
      explicitGroup,
      feedUrl: feedUrl.href,
      infoHash,
      magnetUri,
      provider,
      publishedAt: isoDate(
        item.pubDate ?? item.published ?? item.updated ?? nestedTorrent.pubDate,
      ),
      seeders: nonNegativeInteger(
        item.seeders ??
          nestedTorrent.seeders ??
          torznabAttribute(item, 'seeders'),
      ),
      sizeBytes: firstSizeBytes([
        item.size,
        item.contentLength,
        nestedTorrent.fileSize,
        nestedTorrent.contentLength,
        enclosureValue(item, '@_length'),
        torznabAttribute(item, 'size'),
      ]),
      title,
      torrentUrl: firstHttpUrl(
        [
          item.torrentUrl,
          nestedTorrent.torrentUrl,
          enclosureValue(item, '@_url'),
        ],
        true,
      ),
    });
    if (items.length >= MAX_SOURCE_ITEMS) break;
  }
  return { items, provider };
}

/**
 * 对会拒绝长查询词的 XML 来源最多尝试一次短别名，并始终按完整身份别名过滤条目。
 *
 * @param provider - 当前固定来源标识。
 * @param baseUrl - 尚未写入查询参数的固定 Feed 地址。
 * @param queryParameter - 来源协议声明的查询参数名。
 * @param aliases - 已核验身份的完整别名集合。
 * @param fetchImpl - 有界网络读取实现。
 * @returns 首个包含身份匹配条目的结果，或至少一次成功请求的空结果。
 * @throws 当完整标题和短别名请求都未取得成功响应时抛出最后一次上游错误。
 */
async function searchXmlFeedWithAliasFallback(
  provider: MediaGovernanceRssDiscoveryProvider,
  baseUrl: URL,
  queryParameter: string,
  aliases: string[],
  fetchImpl: typeof fetch,
): Promise<ProviderSearchResult> {
  const primary = preferredAlias(aliases, false);
  const queries = [primary];
  const fallback = providerFallbackAlias(aliases, primary);
  if (fallback) queries.push(fallback);
  let firstSuccess: null | ProviderSearchResult = null;
  let lastFailure: unknown = null;
  for (const query of queries) {
    const feedUrl = new URL(baseUrl.href);
    feedUrl.searchParams.set(queryParameter, query);
    try {
      const result = await searchXmlFeed(provider, feedUrl, aliases, fetchImpl);
      if (!firstSuccess) firstSuccess = result;
      if (result.items.length > 0) return result;
    } catch (error) {
      lastFailure = error;
    }
  }
  if (firstSuccess) return firstSuccess;
  if (lastFailure instanceof Error) throw lastFailure;
  throw new Error('rss-discovery-upstream-unavailable');
}

/**
 * 从标题尾部选择短而有区分度的文字片段，避免旧站查询接口因完整长标题返回 500。
 *
 * @param aliases - 已核验身份的有序别名。
 * @param primary - 已用于首次请求的完整查询词。
 * @returns 首个不同于完整查询词的中日韩片段或较长拉丁片段。
 */
function providerFallbackAlias(
  aliases: string[],
  primary: string,
): null | string {
  const primaryKey = normalizeSearchKey(primary);
  for (const alias of aliases) {
    const segments = decodeHtml(alias)
      .normalize('NFKC')
      .match(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[A-Za-z][A-Za-z0-9]+/gu,
      );
    if (!segments) continue;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (!segment) continue;
      const length = [...segment].length;
      const containsCjk = /[^\x00-\x7f]/u.test(segment);
      let eligible = false;
      if (containsCjk && length >= 2) eligible = true;
      if (!containsCjk && length >= 5) eligible = true;
      if (!eligible) continue;
      if (normalizeSearchKey(segment) === primaryKey) continue;
      return segment;
    }
  }
  return null;
}

/**
 * 只从番组详情链接邻近标题提取候选，并按番组 ID 去重以排除 Episode 链接噪声。
 *
 * @param html - Mikan 搜索页 HTML。
 * @returns Mikan 番组 ID 与标题列表。
 */
function parseMikanBangumiCandidates(
  html: string,
): Array<{ id: string; title: string }> {
  const candidates: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/href="\/Home\/Bangumi\/(\d+)"/giu)) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    const segment = html.slice(match.index, match.index + 1_200);
    const titleMatch = segment.match(/\btitle="([^"]+)"/iu);
    const title = decodeHtml(titleMatch?.[1] ?? '').trim();
    if (!title) continue;
    candidates.push({ id, title });
    seen.add(id);
  }
  return candidates;
}

/**
 * 将 Mikan 搜索页的 Episode 行压缩为有界回退条目，保留磁链、详情、torrent 和发布时间。
 *
 * @param html - Mikan 搜索页 HTML。
 * @returns 最多六十条可归并发布记录。
 */
function parseMikanReleases(html: string): RawDiscoveryItem[] {
  const items: RawDiscoveryItem[] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const row = match[1];
    if (!/\/Home\/Episode\//iu.test(row)) continue;
    const titleMatch = row.match(
      /<a\b[^>]*href="\/Home\/Episode\/[^"]+"[^>]*>([\s\S]*?)<\/a>/iu,
    );
    const title = stripHtml(titleMatch?.[1] ?? '').trim();
    if (!title) continue;
    const magnetMatch = row.match(/data-clipboard-text="([^"]+)"/iu);
    const magnetUri = safeMagnet(decodeHtml(magnetMatch?.[1] ?? ''));
    const detailPath = row.match(/href="(\/Home\/Episode\/[^"]+)"/iu)?.[1];
    let detailUrl: null | string = null;
    if (detailPath)
      detailUrl = new URL(detailPath, 'https://mikanani.kas.pub').href;
    items.push({
      detailUrl,
      explicitGroup: null,
      feedUrl: null,
      infoHash: safeInfoHashFromMagnet(magnetUri),
      magnetUri,
      provider: 'mikan',
      publishedAt: mikanRowDate(row),
      seeders: null,
      sizeBytes: parseSizeBytes(stripHtml(row)),
      title,
      torrentUrl: firstHttpUrl(
        [row.match(/href="(\/Download\/[^"]+\.torrent)"/iu)?.[1]],
        true,
        'https://mikanani.kas.pub',
      ),
    });
    if (items.length >= MAX_SOURCE_ITEMS) break;
  }
  return items;
}

/**
 * 从 Mikan 番组详情提取字幕组名称和组级 RSS 地址。
 *
 * @param html - 精确 Mikan 番组详情 HTML。
 * @param bangumiId - 已从搜索页匹配的 Mikan 番组 ID。
 * @returns 可按发布组回填的组级 RSS 地址。
 */
function parseMikanGroupFeeds(
  html: string,
  bangumiId: string,
): Array<{ feedUrl: string; releaseGroup: string }> {
  const groups: Array<{ feedUrl: string; releaseGroup: string }> = [];
  const seen = new Set<string>();
  const pattern = new RegExp(
    'href="/RSS/Bangumi\\?bangumiId=' +
      bangumiId +
      '(?:&amp;|&)subgroupid=(\\d+)"',
    'giu',
  );
  for (const match of html.matchAll(pattern)) {
    const subgroupId = match[1];
    if (!subgroupId || seen.has(subgroupId)) continue;
    let sectionStart = html.lastIndexOf(
      '<div class="subgroup-text"',
      match.index,
    );
    if (sectionStart < 0 || match.index - sectionStart > 4_000) {
      sectionStart = Math.max(0, match.index - 2_000);
    }
    const section = html.slice(sectionStart, match.index);
    const names: string[] = [];
    for (const anchor of section.matchAll(
      /<a\b[^>]*href="\/Home\/PublishGroup\/\d+"[^>]*>([\s\S]*?)<\/a>/giu,
    )) {
      const name = stripHtml(anchor[1]).trim();
      if (name && !names.includes(name)) names.push(name);
    }
    if (names.length === 0) continue;
    seen.add(subgroupId);
    groups.push({
      feedUrl: `https://mikanani.kas.pub/RSS/Bangumi?bangumiId=${bangumiId}&subgroupid=${subgroupId}`,
      releaseGroup: names.join('&'),
    });
  }
  return groups;
}

/**
 * 只保留命中完整身份别名的 Shana 发布块，并投影无订阅能力的实时条目证据。
 *
 * @param html - Shana Project 搜索 HTML。
 * @param aliases - 已确认身份别名。
 * @returns 无原生 RSS 但可参与发布组聚合的实时条目。
 */
function parseShanaReleases(
  html: string,
  aliases: string[],
): RawDiscoveryItem[] {
  const items: RawDiscoveryItem[] = [];
  for (const match of html.matchAll(
    /<div\b[^>]*id="rel\d+"[^>]*>([\s\S]*?)(?=<div\b[^>]*id="rel\d+"|$)/giu,
  )) {
    const section = match[1];
    const titleMatch = section.match(
      /release_text_contents[^>]*>([\s\S]*?)<\/div>/iu,
    );
    const title = stripHtml(titleMatch?.[1] ?? '').trim();
    if (!title || !titleMatchesAliases(title, aliases)) continue;
    const detailUrl = firstHttpUrl(
      [section.match(/href="([^"]+)"/iu)?.[1]],
      false,
      'https://www.shanaproject.com',
    );
    const torrentUrl = firstHttpUrl(
      [section.match(/href="(\/download\/[^"]+)"/iu)?.[1]],
      true,
      'https://www.shanaproject.com',
    );
    const dateMatch = section.match(
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s+\d{1,2},\s+\d{4},\s+[^<]+/iu,
    );
    items.push({
      detailUrl,
      explicitGroup: null,
      feedUrl: null,
      infoHash: null,
      magnetUri: null,
      provider: 'shana-project',
      publishedAt: isoDate(dateMatch?.[0]),
      seeders: null,
      sizeBytes: parseSizeBytes(stripHtml(section)),
      title,
      torrentUrl,
    });
    if (items.length >= MAX_SOURCE_ITEMS) break;
  }
  return items;
}

/**
 * 按 BTIH 优先、规范标题兜底合并跨站转载，并保留每个来源的独立订阅入口。
 *
 * @param values - 九个固定来源返回的原始条目。
 * @returns 跨来源去重后的条目。
 */
function aggregateDuplicateItems(
  values: RawDiscoveryItem[],
): MediaGovernanceRssDiscoveryItem[] {
  const byIdentity = new Map<string, MediaGovernanceRssDiscoveryItem>();
  const byTitle = new Map<string, MediaGovernanceRssDiscoveryItem>();
  for (const value of values) {
    const releaseGroup = releaseGroupName(
      value.title,
      value.explicitGroup,
      value.preferExplicitGroup,
    );
    const titleKey = `title:${normalizeSearchKey(value.title)}`;
    let key = titleKey;
    if (value.infoHash) key = `btih:${value.infoHash}`;
    const source = sourceRef(value);
    let existing = byIdentity.get(key);
    const titleMatch = byTitle.get(titleKey);
    if (!existing && !value.infoHash) existing = titleMatch;
    if (!existing && value.infoHash && !titleMatch?.infoHash) {
      existing = titleMatch;
    }
    if (!existing) {
      const created: MediaGovernanceRssDiscoveryItem = {
        id: createHash('sha256').update(key).digest('hex').slice(0, 24),
        infoHash: value.infoHash,
        providers: [source],
        publishedAt: value.publishedAt,
        releaseGroup,
        seeders: value.seeders,
        sizeBytes: value.sizeBytes,
        title: value.title,
      };
      byIdentity.set(key, created);
      if (!byTitle.has(titleKey)) byTitle.set(titleKey, created);
      continue;
    }
    if (!existing.infoHash && value.infoHash)
      existing.infoHash = value.infoHash;
    if (value.infoHash) byIdentity.set(`btih:${value.infoHash}`, existing);
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, existing);
    if (!existing.providers.some((item) => item.provider === source.provider)) {
      existing.providers.push(source);
    }
    existing.publishedAt = newestDate(existing.publishedAt, value.publishedAt);
    existing.seeders = maximumNumber(existing.seeders, value.seeders);
    if (existing.sizeBytes === null && value.sizeBytes !== null) {
      existing.sizeBytes = value.sizeBytes;
    }
    if (
      existing.releaseGroup.startsWith('未识别') &&
      !releaseGroup.startsWith('未识别')
    ) {
      existing.releaseGroup = releaseGroup;
    }
  }
  return [...new Set(byIdentity.values())].sort(compareDiscoveryItems);
}

/**
 * 把去重条目按发布组同义签名归并，并生成组级订阅来源选项。
 *
 * @param items - 跨站去重后的来源条目。
 * @param subscriptions - 来源详情页独立声明的组级 RSS。
 * @returns 按结果量和最新发布时间排序的发布组。
 */
function aggregateReleaseGroups(
  items: MediaGovernanceRssDiscoveryItem[],
  subscriptions: RawDiscoverySubscription[],
): MediaGovernanceRssDiscoveryGroup[] {
  const groups: MediaGovernanceRssDiscoveryGroup[] = [];
  for (const item of items) {
    let group = groups.find((candidate) =>
      releaseGroupsEquivalent(candidate.releaseGroup, item.releaseGroup),
    );
    if (!group) {
      group = createDiscoveryGroup(item.releaseGroup);
      groups.push(group);
    }
    group.uniqueItemCount += 1;
    group.latestPublishedAt = newestDate(
      group.latestPublishedAt,
      item.publishedAt,
    );
    group.maxSeeders = maximumNumber(group.maxSeeders, item.seeders);
    if (group.items.length < MAX_GROUP_ITEMS) group.items.push(item);
    for (const source of item.providers) {
      if (!group.providers.includes(source.provider)) {
        group.providers.push(source.provider);
      }
      if (!source.feedUrl) continue;
      const option = group.subscriptionOptions.find(
        (candidate) =>
          candidate.provider === source.provider &&
          candidate.feedUrl === source.feedUrl,
      );
      if (option) {
        option.itemCount += 1;
        continue;
      }
      group.subscriptionOptions.push({
        feedUrl: source.feedUrl,
        itemCount: 1,
        label: source.label,
        provider: source.provider,
      });
    }
  }
  for (const subscription of subscriptions) {
    let group = groups.find((candidate) =>
      releaseGroupsEquivalent(
        candidate.releaseGroup,
        subscription.releaseGroup,
      ),
    );
    if (!group) {
      group = createDiscoveryGroup(subscription.releaseGroup);
      groups.push(group);
    }
    if (!group.providers.includes(subscription.provider)) {
      group.providers.push(subscription.provider);
    }
    const duplicate = group.subscriptionOptions.some(
      (option) =>
        option.provider === subscription.provider &&
        option.feedUrl === subscription.feedUrl,
    );
    if (duplicate) continue;
    group.subscriptionOptions.push({
      feedUrl: subscription.feedUrl,
      itemCount: 0,
      label: PROVIDER_DEFINITIONS[subscription.provider].label,
      provider: subscription.provider,
    });
  }
  for (const group of groups) {
    group.providers.sort();
    group.providerCount = group.providers.length;
    group.subscriptionOptions.sort(
      (left, right) => right.itemCount - left.itemCount,
    );
  }
  groups.sort((left, right) => {
    if (left.uniqueItemCount !== right.uniqueItemCount) {
      return right.uniqueItemCount - left.uniqueItemCount;
    }
    return compareNullableDates(
      right.latestPublishedAt,
      left.latestPublishedAt,
    );
  });
  return groups.slice(0, MAX_RELEASE_GROUPS);
}

/**
 * 从发布组规范签名派生稳定 ID 与安全过滤正则，并初始化所有统计容器。
 *
 * @param releaseGroup - 来源声明的发布组名称。
 * @returns 尚未累计条目和来源的发布组结构。
 */
function createDiscoveryGroup(
  releaseGroup: string,
): MediaGovernanceRssDiscoveryGroup {
  const signature = normalizeGroupSignature(releaseGroup);
  return {
    groupId: createHash('sha256').update(signature).digest('hex').slice(0, 20),
    includePattern: escapeRegularExpression(releaseGroup),
    items: [],
    latestPublishedAt: null,
    maxSeeders: null,
    providerCount: 0,
    providers: [],
    releaseGroup,
    subscriptionOptions: [],
    uniqueItemCount: 0,
  };
}

/**
 * 将原始条目投影为前端可追溯的来源引用。
 *
 * @param item - 单个固定来源发布条目。
 * @returns 来源名称、详情、订阅、磁链和 torrent 地址。
 */
function sourceRef(
  item: RawDiscoveryItem,
): MediaGovernanceRssDiscoverySourceRef {
  return {
    detailUrl: item.detailUrl,
    feedUrl: item.feedUrl,
    label: PROVIDER_DEFINITIONS[item.provider].label,
    magnetUri: item.magnetUri,
    provider: item.provider,
    torrentUrl: item.torrentUrl,
  };
}

/**
 * 从发布标题的首个方括号读取真实联合发布组，缺失时使用来源显式团队。
 *
 * @param title - 来源发布标题。
 * @param explicitGroup - 来源 API 提供的可选团队名称。
 * @param preferExplicitGroup - 是否以精确组级 Feed 身份覆盖标题首括号。
 * @returns 可供跨站聚合的发布组名称。
 */
function releaseGroupName(
  title: string,
  explicitGroup: null | string,
  preferExplicitGroup = false,
): string {
  if (preferExplicitGroup && explicitGroup?.trim()) {
    return explicitGroup.replace(/\s+/gu, ' ').trim();
  }
  const match = title.match(/^\s*[\[【]([^\]】]{1,160})[\]】]/u);
  if (match?.[1] && !looksLikeMediaTag(match[1])) {
    return decodeHtml(match[1]).replace(/\s+/gu, ' ').trim();
  }
  if (explicitGroup?.trim()) return explicitGroup.replace(/\s+/gu, ' ').trim();
  return '未识别发布组';
}

/**
 * 防止分辨率、编码和语言等首括号参数被错误提升为发布组身份。
 *
 * @param value - 首括号文本。
 * @returns 命中常见媒体参数时返回 true。
 */
function looksLikeMediaTag(value: string): boolean {
  return /^(?:480|720|1080|2160)p|^(?:web|webrip|web-dl|bdrip|bluray|hevc|avc|x26[45]|aac|flac|简|繁|chs|cht|jpn|eng)$/iu.test(
    value.trim(),
  );
}

/**
 * 对发布组进行 Unicode、连接符和成员排序规范化，保持联合发布成员集合语义。
 *
 * @param value - 展示发布组名称。
 * @returns 可用于哈希和跨站比较的成员签名。
 */
function normalizeGroupSignature(value: string): string {
  const members = value
    .normalize('NFKC')
    .split(/(?:&|＆|\+|×|\/|、)/u)
    .map((item) => normalizeSearchKey(item))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return members.join('&');
}

/**
 * 将联合发布成员规范排序后按中文基础敏感度核对，避免简繁差异拆成重复组。
 *
 * @param left - 已有聚合组名称。
 * @param right - 新条目发布组名称。
 * @returns 两组成员数量和中文基础排序均一致时返回 true。
 */
function releaseGroupsEquivalent(left: string, right: string): boolean {
  const leftMembers = normalizeGroupSignature(left).split('&').filter(Boolean);
  const rightMembers = normalizeGroupSignature(right)
    .split('&')
    .filter(Boolean);
  if (leftMembers.length !== rightMembers.length) return false;
  const collator = new Intl.Collator('zh-CN', { sensitivity: 'base' });
  for (let index = 0; index < leftMembers.length; index += 1) {
    if (collator.compare(leftMembers[index], rightMembers[index]) !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * 从身份候选标题、原名和年份计算用户查询相关度。
 *
 * @param candidate - 单个 Bangumi 或 TMDB 候选。
 * @param keyword - 已规范用户搜索词。
 * @returns 精确标题优先、包含匹配其次的稳定分数。
 */
function identityCandidateScore(
  candidate: MediaGovernanceRssIdentityCandidate,
  keyword: string,
): number {
  const normalizedKeyword = normalizeSearchKey(keyword);
  const titles = [candidate.title, candidate.originalTitle ?? ''];
  let score = 0;
  for (const title of titles) {
    const normalizedTitle = normalizeSearchKey(title);
    if (normalizedTitle === normalizedKeyword) score = Math.max(score, 100);
    if (normalizedTitle.includes(normalizedKeyword))
      score = Math.max(score, 60);
  }
  if (candidate.provider === 'bangumi') score += 5;
  return score;
}

/**
 * 为成功身份来源生成统一状态。
 *
 * @param provider - Bangumi 或 TMDB。
 * @param itemCount - 返回候选数量。
 * @returns 可用身份来源状态。
 */
function identityProviderStatus(
  provider: MediaGovernanceRssIdentityProvider,
  itemCount: number,
): MediaGovernanceRssDiscoveryProviderStatus {
  let label = 'Bangumi';
  if (provider === 'tmdb') label = 'TMDB';
  return {
    errorCode: null,
    itemCount,
    label,
    provider,
    rssCapable: false,
    status: 'available',
  };
}

/**
 * 为失败身份来源生成不泄漏底层网络细节的独立状态。
 *
 * @param provider - Bangumi 或 TMDB。
 * @returns 不可用身份来源状态。
 */
function identityProviderFailure(
  provider: MediaGovernanceRssIdentityProvider,
): MediaGovernanceRssDiscoveryProviderStatus {
  const status = identityProviderStatus(provider, 0);
  status.status = 'unavailable';
  status.errorCode = `${provider}-identity-unavailable`;
  return status;
}

/**
 * 为成功来源搜索生成统一状态。
 *
 * @param provider - 固定来源标识。
 * @param itemCount - 通过身份别名过滤后的条目数。
 * @returns 可用来源状态。
 */
function sourceProviderStatus(
  provider: MediaGovernanceRssDiscoveryProvider,
  itemCount: number,
): MediaGovernanceRssDiscoveryProviderStatus {
  const definition = PROVIDER_DEFINITIONS[provider];
  return {
    errorCode: null,
    itemCount,
    label: definition.label,
    provider,
    rssCapable: definition.rssCapable,
    status: 'available',
  };
}

/**
 * 为失败来源生成独立降级状态，不影响其他来源结果。
 *
 * @param provider - 固定来源标识。
 * @returns 不可用来源状态。
 */
function sourceProviderFailure(
  provider: MediaGovernanceRssDiscoveryProvider,
): MediaGovernanceRssDiscoveryProviderStatus {
  const status = sourceProviderStatus(provider, 0);
  status.status = 'unavailable';
  status.errorCode = `${provider}-unavailable`;
  return status;
}

/**
 * 从别名列表选择中文来源或国际来源的首选查询词。
 *
 * @param aliases - 有序身份别名。
 * @param preferAscii - 是否优先仅含 ASCII 的原文标题。
 * @returns 至少一个存在的查询别名。
 * @throws 当身份核验未产生任何可查询别名时抛出稳定缺失错误。
 */
function preferredAlias(aliases: string[], preferAscii: boolean): string {
  if (preferAscii) {
    const ascii = aliases.find((alias) => /^[\x20-\x7e]+$/u.test(alias));
    if (ascii) return ascii;
  } else {
    const localized = aliases.find((alias) => /[^\x20-\x7e]/u.test(alias));
    if (localized) return localized;
  }
  const first = aliases[0];
  if (!first) throw new Error('rss-discovery-alias-missing');
  return first;
}

/**
 * 在宽泛站点搜索之后重新执行完整身份边界，阻止只命中短查询词的无关条目进入聚合。
 *
 * @param title - 来源发布标题。
 * @param aliases - 身份和 Series 标题别名。
 * @returns 至少命中一个有效别名时返回 true。
 */
function titleMatchesAliases(title: string, aliases: string[]): boolean {
  const normalizedTitle = normalizeSearchKey(title);
  return aliases.some((alias) =>
    normalizedTitle.includes(normalizeSearchKey(alias)),
  );
}

/**
 * 为番组身份候选执行去标点和大小写后的等值门禁，不接受仅局部包含关系。
 *
 * @param left - 来源候选标题。
 * @param right - 已确认身份别名。
 * @returns 规范标题相同时返回 true。
 */
function titlesEquivalent(left: string, right: string): boolean {
  return normalizeSearchKey(left) === normalizeSearchKey(right);
}

/**
 * 规范 Unicode、大小写、HTML 实体与非文字符号，供标题和发布组比较。
 *
 * @param value - 外部来源文本。
 * @returns 仅保留字母数字和 CJK 字符的比较键。
 */
function normalizeSearchKey(value: string): string {
  return decodeHtml(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

/**
 * 折叠用户搜索空白并限制长度与控制字符，保证所有上游查询使用同一输入边界。
 *
 * @param value - 用户搜索框原始值。
 * @param label - 稳定错误标签。
 * @returns 规范为单空格的 1–120 字符搜索词。
 * @throws 当文本为空、超过 120 字符或含控制字符时抛出带调用方标签的错误。
 */
function boundedSearchText(value: string, label: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (
    !normalized ||
    normalized.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

/**
 * 对固定 URL 发起有界请求，并拒绝重定向到未声明主机。
 *
 * @param input - 服务端构造的固定 URL。
 * @param init - 可选请求方法、请求头和正文。
 * @param allowedHosts - 重定向后仍允许的固定主机。
 * @param fetchImpl - 网络读取实现。
 * @returns 不超过四 MiB 的 UTF-8 正文。
 * @throws 当上游失败、重定向越过固定主机或响应超过四 MiB 时抛出稳定网络边界错误。
 */
async function requestText(
  input: URL | string,
  init: RequestInit,
  allowedHosts: string[],
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(input, {
    ...init,
    redirect: 'follow',
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('rss-discovery-upstream-unavailable');
  if (response.url) {
    const finalUrl = new URL(response.url);
    if (!allowedHosts.includes(finalUrl.hostname)) {
      throw new Error('rss-discovery-upstream-redirect-rejected');
    }
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_DISCOVERY_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('rss-discovery-upstream-response-too-large');
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 读取固定 JSON 端点并拒绝非对象或数组载荷之外的解析异常。
 *
 * @param input - 服务端构造的固定 URL。
 * @param init - 可选请求方法、请求头和正文。
 * @param allowedHosts - 重定向后仍允许的固定主机。
 * @param fetchImpl - 网络读取实现。
 * @returns 已解析 JSON 值。
 * @throws 当固定端点请求失败、越界或正文不是有效 JSON 时抛出稳定上游错误。
 */
async function requestJson(
  input: URL | string,
  init: RequestInit,
  allowedHosts: string[],
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const text = await requestText(input, init, allowedHosts, fetchImpl);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('rss-discovery-upstream-json-invalid');
  }
}

/**
 * 将未知值收窄为普通对象，其他值统一为空对象。
 *
 * @param value - 外部 JSON 或 XML 节点。
 * @returns 可安全按键读取的普通对象。
 */
function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * 将未知单值或数组统一为数组。
 *
 * @param value - 外部 JSON 或 XML 节点。
 * @returns 保持原始顺序的数组。
 */
function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

/**
 * 从 XML 文本节点或原始标量读取有界单行文本。
 *
 * @param value - XML 节点或原始值。
 * @param maximum - 最大字符数。
 * @returns 清理空白后的文本。
 */
function nodeText(value: unknown, maximum: number): string {
  let candidate = value;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    candidate = objectValue(candidate)['#text'];
  }
  if (!['number', 'string'].includes(typeof candidate)) return '';
  return String(candidate).replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

/**
 * 从未知值读取有界字符串。
 *
 * @param value - 外部 JSON 字段。
 * @param maximum - 最大字符数。
 * @returns 有效字符串或空串。
 */
function stringValue(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

/**
 * 把正整数转换为十进制文本。
 *
 * @param value - 外部候选 ID。
 * @returns 正整数文本或空串。
 */
function positiveIntegerText(value: unknown): string {
  const number = positiveInteger(value);
  if (number === null) return '';
  return String(number);
}

/**
 * 把未知数值收窄为正整数。
 *
 * @param value - 外部计数字段。
 * @returns 正整数或 null。
 */
function positiveInteger(value: unknown): null | number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

/**
 * 把未知数值收窄为非负整数。
 *
 * @param value - 外部热度或字节字段。
 * @returns 非负整数或 null。
 */
function nonNegativeInteger(value: unknown): null | number {
  const number = Number(nodeText(value, 32) || value);
  if (!Number.isInteger(number) || number < 0) return null;
  return number;
}

/**
 * 从 ISO 日期或普通日期文本读取年份。
 *
 * @param value - 外部发布日期字段。
 * @returns 1888–2100 年或 null。
 */
function dateYear(value: unknown): null | number {
  const text = stringValue(value, 80);
  const match = text.match(/(?:18|19|20|21)\d{2}/u);
  if (!match) return null;
  const year = Number(match[0]);
  if (year < 1888 || year > 2100) return null;
  return year;
}

/**
 * 把外部日期转换为 ISO 字符串。
 *
 * @param value - 外部日期字段。
 * @returns 有效 ISO 日期或 null。
 */
function isoDate(value: unknown): null | string {
  const text = nodeText(value, 160);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

/**
 * 校验 HTTPS 图片或详情 URL 的固定主机。
 *
 * @param value - 外部 URL 字符串。
 * @param allowedHosts - 允许的固定主机。
 * @returns 合法 HTTPS URL 或 null。
 */
function safeHttpsUrl(value: string, allowedHosts: string[]): null | string {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/**
 * 从候选值读取第一个 HTTP(S) URL，并可限制必须为 torrent 文件。
 *
 * @param values - 外部 URL 候选。
 * @param torrentOnly - 是否只接受 `.torrent` 路径。
 * @param baseUrl - 相对地址的固定基准。
 * @returns 合法 URL 或 null。
 */
function firstHttpUrl(
  values: unknown[],
  torrentOnly: boolean,
  baseUrl?: string,
): null | string {
  for (const value of values) {
    const text = nodeText(value, 2_048);
    if (!text) continue;
    try {
      const url = new URL(text, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (torrentOnly && !/\.torrent$/iu.test(url.pathname)) continue;
      if (!torrentOnly && /\.torrent$/iu.test(url.pathname)) continue;
      return url.href;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 从 XML enclosure 列表读取指定属性。
 *
 * @param item - RSS item 节点。
 * @param attribute - XMLParser 属性名。
 * @returns 首个存在的属性值。
 */
function enclosureValue(
  item: Record<string, unknown>,
  attribute: string,
): unknown {
  for (const enclosure of arrayValue(item.enclosure)) {
    const value = objectValue(enclosure)[attribute];
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

/**
 * 从 Torznab attr 数组读取指定名称的值。
 *
 * @param item - Torznab RSS 条目节点。
 * @param name - 要读取的 attr 属性名称。
 * @returns 匹配属性值或 undefined。
 */
function torznabAttribute(
  item: Record<string, unknown>,
  name: string,
): unknown {
  for (const value of arrayValue(item.attr)) {
    const attribute = objectValue(value);
    if (nodeText(attribute['@_name'], 80) !== name) continue;
    return attribute['@_value'];
  }
  return undefined;
}

/**
 * 从候选字段读取并规范第一条磁链。
 *
 * @param values - XML 或 JSON 磁链候选。
 * @returns 十六进制 BTIH 磁链或 null。
 */
function firstMagnet(values: unknown[]): null | string {
  for (const value of values) {
    const magnet = safeMagnet(nodeText(value, 4_096));
    if (magnet) return magnet;
  }
  return null;
}

/**
 * 只接受 BTIH 磁链并规范其哈希与参数，任何协议或解析异常均收敛为 null。
 *
 * @param value - 外部磁链文本。
 * @returns 十六进制 BTIH 磁链或 null。
 */
function safeMagnet(value: string): null | string {
  if (!/^magnet:\?xt=urn:btih:/iu.test(value)) return null;
  try {
    return normalizeMediaGovernanceMagnetUri(value);
  } catch {
    return null;
  }
}

/**
 * 从已规范磁链安全读取 BTIH。
 *
 * @param magnetUri - 可选磁链。
 * @returns 四十位小写 BTIH 或 null。
 */
function safeInfoHashFromMagnet(magnetUri: null | string): null | string {
  if (!magnetUri) return null;
  try {
    return mediaGovernanceMagnetInfoHash(magnetUri);
  } catch {
    return null;
  }
}

/**
 * 将候选摘要收窄为四十位十六进制 BTIH。
 *
 * @param value - 外部摘要文本。
 * @returns 小写 BTIH 或 null。
 */
function normalizeInfoHash(value: string): null | string {
  if (!/^[a-f0-9]{40}$/iu.test(value)) return null;
  return value.toLowerCase();
}

/**
 * 从候选尺寸字段读取第一个有效字节数。
 *
 * @param values - XML 尺寸候选。
 * @returns 非负字节数或 null。
 */
function firstSizeBytes(values: unknown[]): null | number {
  for (const value of values) {
    const integer = nonNegativeInteger(value);
    if (integer !== null) return integer;
    const parsed = parseSizeBytes(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * 把常见 B、KiB、MiB、GiB 尺寸文本转换为字节。
 *
 * @param value - 外部尺寸字段或混合文本。
 * @returns 向下取整的非负字节数或 null。
 */
function parseSizeBytes(value: unknown): null | number {
  const text = nodeText(value, 2_000);
  const match = text.match(
    /(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)\b/iu,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();
  const powers: Record<string, number> = {
    B: 0,
    GB: 3,
    GIB: 3,
    KB: 1,
    KIB: 1,
    MB: 2,
    MIB: 2,
    TB: 4,
    TIB: 4,
  };
  const power = powers[unit];
  if (power === undefined || !Number.isFinite(amount)) return null;
  return Math.floor(amount * 1024 ** power);
}

/**
 * 从 Mikan 行读取完整日期。
 *
 * @param row - 单个搜索结果表格行。
 * @returns ISO 日期或 null。
 */
function mikanRowDate(row: string): null | string {
  const match = row.match(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/u);
  if (!match) return null;
  return isoDate(`${match[0]} +08:00`);
}

/**
 * 跨来源合并时保留最新有效时间，并阻止空值覆盖已有时间证据。
 *
 * @param left - 已聚合时间。
 * @param right - 新来源时间。
 * @returns 较新 ISO 时间或唯一非空值。
 */
function newestDate(left: null | string, right: null | string): null | string {
  if (!left) return right;
  if (!right) return left;
  if (Date.parse(right) > Date.parse(left)) return right;
  return left;
}

/**
 * 跨来源合并时保留较大活跃度数值，并阻止空值覆盖已有证据。
 *
 * @param left - 已聚合数字。
 * @param right - 新来源数字。
 * @returns 较大数字或唯一非空值。
 */
function maximumNumber(
  left: null | number,
  right: null | number,
): null | number {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

/**
 * 按发布时间、活跃度和标题排列聚合条目。
 *
 * @param left - 左侧条目。
 * @param right - 右侧条目。
 * @returns Array.sort 比较值。
 */
function compareDiscoveryItems(
  left: MediaGovernanceRssDiscoveryItem,
  right: MediaGovernanceRssDiscoveryItem,
): number {
  const dateOrder = compareNullableDates(right.publishedAt, left.publishedAt);
  if (dateOrder !== 0) return dateOrder;
  const leftSeeders = left.seeders ?? -1;
  const rightSeeders = right.seeders ?? -1;
  if (leftSeeders !== rightSeeders) return rightSeeders - leftSeeders;
  return left.title.localeCompare(right.title, 'zh-CN');
}

/**
 * 为聚合排序生成日期比较值，非空日期按时间顺序排列且空值固定置后。
 *
 * @param left - 左侧日期。
 * @param right - 右侧日期。
 * @returns Array.sort 比较值，空值排在后面。
 */
function compareNullableDates(
  left: null | string,
  right: null | string,
): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return Date.parse(left) - Date.parse(right);
}

/**
 * 把发布组名称转义为可直接写入 includePattern 的文字正则。
 *
 * @param value - 发布组展示名称。
 * @returns 仅匹配文字本身的安全正则片段。
 */
function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * 将受控命名实体和数字实体还原后再进入标题规范化，并拒绝引入通用 HTML 执行能力。
 *
 * @param value - 外部 HTML 文本。
 * @returns 解码后的 Unicode 文本。
 */
function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([a-f0-9]+);/giu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/**
 * 去除 HTML 标签并解码实体，供来源标题和发布组展示。
 *
 * @param value - 外部 HTML 片段。
 * @returns 单空格纯文本。
 */
function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/gu, ' ')).replace(/\s+/gu, ' ');
}
