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

  /**
   * 按 aid 或 bvid 请求 Bilibili 视频接口，并规范化标题、作者、统计与默认值；接口业务码失败时抛出错误。
   * @param reference - 决定视频内容、边界或目标的 `reference` 值。
   * @param config - 限定视频边界、地址与开关的运行配置，包含 `httpTimeoutMs` 字段。
   * @returns 视频。
   * @throws 当 `response.code !== 0` 成立时拒绝当前输入并抛出 `Error`。
   */
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

/**
 * 根据引用类型将 aid 或 bvid 写入 Bilibili 视频详情接口查询参数。
 * @param reference - 用于Bilibili视图URL的领域对象，包含 `kind`、`value` 字段。
 * @returns Bilibili视图URL。
 */
function buildBilibiliViewUrl(reference: BilibiliVideoReference) {
  const url = new URL('https://api.bilibili.com/x/web-interface/view');
  url.searchParams.set((() => {
    if (reference.kind === 'bvid') {
      return 'bvid';
    }
    return 'aid';
  })(), reference.value);
  return url;
}

/**
 * 将`data`、`reference`规范为Bilibili视频信息，使等价输入得到一致表示；从 `readNumber` 读取Bilibili视频信息。
 * @param data - 用于Bilibili视频信息的领域对象，包含 `aid`、`bvid`、`desc`、`duration` 字段。
 * @param reference - 用于Bilibili视频信息的领域对象，包含 `kind`、`value` 字段。
 * @returns 包含 `aid`、`bvid`、`desc`、`duration`、`ownerName` 字段的Bilibili视频信息。
 */
function normalizeBilibiliVideoInfo(
  data: BilibiliViewResponse['data'],
  reference: BilibiliVideoReference,
): BilibiliVideoInfo {
  return {
    aid: readNumber(data?.aid, (() => {
      if (reference.kind === 'aid') {
        return Number(reference.value);
      }
      return 0;
    })()),
    bvid: readText(data?.bvid, (() => {
      if (reference.kind === 'bvid') {
        return reference.value;
      }
      return '';
    })()),
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
 * 仅接受字符串并去除两端空白；结果为空或输入非字符串时返回调用方兜底文本。
 * @param value - 参与文本比较、格式化或输出的候选值。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
 * @returns 规范化后的文本；主值为空时采用 `fallback` 兜底。
 */
function readText(value: unknown, fallback = '') {
  const text = (() => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return '';
  })();
  return text || fallback;
}

/**
 * 按`value`、`fallback`读取数字；当 `Number.isFinite(numberValue) && numberValue > 0` 成立时返回 `Math.floor(numberValue)`。
 * @param value - 参与数字比较、格式化或输出的候选值。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `0`。
 * @returns 数字。
 */
function readNumber(value: unknown, fallback = 0) {
  const numberValue = (() => {
    if (typeof value === 'number') {
      return value;
    }
    return Number(value);
  })();
  if (Number.isFinite(numberValue) && numberValue > 0) {
    return Math.floor(numberValue);
  }
  return fallback;
}

/**
 * 将`message`规范为Bilibili消息，使等价输入得到一致表示；从 `readText` 读取Bilibili消息。
 * @param message - 包含正文、发送目标与账号身份的待处理消息。
 * @returns Bilibili消息。
 */
function normalizeBilibiliMessage(message: unknown) {
  return readText(message, '未知错误');
}
