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
  constructor(private readonly host: BilibiliCardPluginHost) {}

  /** 获取视频。 */
  async fetchVideo(
    reference: BilibiliVideoReference,
    config: Pick<BilibiliCardRuntimeConfig, 'httpTimeoutMs'>,
  ): Promise<BilibiliVideoInfo> {
    const response = await this.host.requestJson<BilibiliViewResponse>({
      context: 'Bilibili 视频信息获取',
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

/** 构建Bilibili视图URL。 */
function buildBilibiliViewUrl(reference: BilibiliVideoReference) {
  const url = new URL('https://api.bilibili.com/x/web-interface/view');
  url.searchParams.set(reference.kind === 'bvid' ? 'bvid' : 'aid', reference.value);
  return url;
}

/** 规范化Bilibili视频信息。 */
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

/** 读取文本。 */
function readText(value: unknown, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

/** 读取数字。 */
function readNumber(value: unknown, fallback = 0) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : fallback;
}

/** 规范化Bilibili消息。 */
function normalizeBilibiliMessage(message: unknown) {
  return readText(message, '未知错误');
}
