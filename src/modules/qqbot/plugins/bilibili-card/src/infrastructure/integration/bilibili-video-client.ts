import type {
  BilibiliCardPluginHost,
  BilibiliCardRuntimeConfig,
  BilibiliVideoInfo,
  BilibiliVideoReference,
} from '../../domain/bilibili-card.types';

type BilibiliViewResponse = {
  code?: number;
  data?: {
    aid?: unknown;
    bvid?: unknown;
    desc?: unknown;
    duration?: unknown;
    owner?: {
      name?: unknown;
    };
    pic?: unknown;
    stat?: {
      danmaku?: unknown;
      like?: unknown;
      view?: unknown;
    };
    title?: unknown;
  };
  message?: unknown;
};

export class BilibiliVideoClient {
  /**
   * Initializes the host-mediated Bilibili video client.
   * @param host - Package-local host facade that owns all external HTTP access.
   */
  constructor(private readonly host: BilibiliCardPluginHost) {}

  /**
   * Fetches and normalizes one Bilibili video through the official view endpoint.
   * @param reference - Parsed BV or av reference produced by the URL parser or redirect resolver.
   * @param config - Runtime config containing the host request timeout budget.
   * @returns Normalized video info safe for reply formatting.
   */
  async fetchVideo(
    reference: BilibiliVideoReference,
    config: Pick<BilibiliCardRuntimeConfig, 'httpTimeoutMs'>,
  ): Promise<BilibiliVideoInfo> {
    const response = await this.host.requestJson<BilibiliViewResponse>({
      context: 'Bilibili 视频信息获取',
      /**
       * Builds a readable HTTP failure message for host-mediated Bilibili API requests.
       * @param statusCode - HTTP status code reported by the generic host HTTP client.
       * @returns Chinese error text with the status code preserved.
       */
      failureMessage: (statusCode) =>
        `Bilibili 视频信息获取失败：HTTP ${statusCode}`,
      invalidJsonMessage: 'Bilibili 视频信息返回不是合法 JSON',
      method: 'GET',
      timeoutMessage: 'Bilibili 视频信息获取超时',
      timeoutMs: config.httpTimeoutMs,
      url: buildBilibiliViewUrl(reference),
    });

    if (response.code !== 0) {
      throw new Error(
        `Bilibili 视频信息获取失败：${normalizeBilibiliMessage(
          response.message,
        )}`,
      );
    }

    return normalizeBilibiliVideoInfo(response.data, reference);
  }
}

/**
 * Builds the official Bilibili web-interface view endpoint URL for a video reference.
 * @param reference - Parsed BV or av reference produced by URL parsing.
 * @returns Official Bilibili API URL with either `bvid` or `aid` query parameter.
 */
function buildBilibiliViewUrl(reference: BilibiliVideoReference) {
  const url = new URL('https://api.bilibili.com/x/web-interface/view');
  url.searchParams.set(reference.kind === 'bvid' ? 'bvid' : 'aid', reference.value);
  return url;
}

/**
 * Normalizes the Bilibili API payload into the package-local video info contract.
 * @param data - Raw `data` object returned by Bilibili's view endpoint.
 * @param reference - Original parsed reference used as a fallback for missing identifiers.
 * @returns Video info with safe fallback strings and numbers.
 */
function normalizeBilibiliVideoInfo(
  data: BilibiliViewResponse['data'],
  reference: BilibiliVideoReference,
): BilibiliVideoInfo {
  return {
    aid: readNumber(data?.aid, reference.kind === 'aid' ? Number(reference.value) : 0),
    bvid: readText(data?.bvid, reference.kind === 'bvid' ? reference.value : ''),
    desc: readText(data?.desc),
    duration: readNumber(data?.duration),
    ownerName: readText(data?.owner?.name, '未知UP主'),
    pic: readText(data?.pic),
    stat: {
      danmaku: readNumber(data?.stat?.danmaku),
      like: readNumber(data?.stat?.like),
      view: readNumber(data?.stat?.view),
    },
    title: readText(data?.title, '未知标题'),
  };
}

/**
 * Converts arbitrary API text values to stable strings.
 * @param value - Unknown text-like field from the Bilibili API response.
 * @param fallback - Domain fallback used when the API field is absent or blank.
 * @returns Trimmed string or the supplied fallback.
 */
function readText(value: unknown, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

/**
 * Converts arbitrary API number values to non-negative integers.
 * @param value - Unknown numeric field from the Bilibili API response.
 * @param fallback - Domain fallback used when the API field is missing or invalid.
 * @returns Non-negative integer suitable for duration, id or stat counters.
 */
function readNumber(value: unknown, fallback = 0) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : fallback;
}

/**
 * Converts Bilibili API error payloads to readable Chinese messages.
 * @param message - Raw `message` field returned by the Bilibili API.
 * @returns Trimmed message or a stable fallback.
 */
function normalizeBilibiliMessage(message: unknown) {
  return readText(message, '未知错误');
}
