import { createHash } from 'node:crypto';
import type {
  BotPluginEventResult,
  BotPluginMessageEvent,
} from '@/modules/plugin-platform/contract/plugin-protocol';

type HermesOptions = {
  host: Record<string, unknown>;
  manifest: {
    pluginKey: string;
    name: string;
    version: string;
    description?: string;
  };
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type HermesResponse = {
  error?: unknown;
  hermes?: { failed?: boolean; completed?: boolean; partial?: boolean };
  choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
};

/**
 * 将普通消息事件路由到文字与图片会话处理，只返回回复意图并保留宿主发送边界。
 * @param options - 插件定义、受控网络能力以及当前安装实例的配置快照。
 * @returns 可由通用插件工作线程加载的消息处理实例。
 */
export function createPlugin(options: HermesOptions) {
  const application = new HermesMessageApplication(options);
  return {
    getDefinition: () => ({
      key: options.manifest.pluginKey,
      name: options.manifest.name,
      description: options.manifest.description,
      version: options.manifest.version,
      triggerType: 'message' as const,
    }),
    handleEvent: (key: string, event: unknown) => {
      if (!['message', 'hermes-agent.message', 'handleMessage'].includes(key)) {
        return { handled: false, replies: [] };
      }
      return application.handleMessage(event as BotPluginMessageEvent);
    },
  };
}

class HermesMessageApplication {
  private readonly sessionTails = new Map<string, Promise<void>>();

  constructor(private readonly options: HermesOptions) {}

  /**
   * 保持共享长期记忆，按发送者串行处理聊天历史，并拒绝把不完整推理当作成功回复。
   * @param event - 宿主完成权限验证后投递的平台无关消息。
   * @returns 普通对话的文本回复意图，或不参与当前消息的空结果。
   */
  async handleMessage(
    event: BotPluginMessageEvent,
  ): Promise<BotPluginEventResult> {
    if (!event || event.isSelf || typeof event.text !== 'string') {
      return { handled: false, replies: [] };
    }
    const imageUrls = event.imageUrls ?? [];
    let text = event.text.trim();
    if (imageUrls.length > 0) {
      text = text.replace(/\[CQ:(?:image|at|reply)(?:,[^\]]*)?\]/gu, '').trim();
    }
    if (
      (!text && imageUrls.length === 0) ||
      /^[!！/]/u.test(text) ||
      /\[CQ:/u.test(text)
    ) {
      return { handled: false, replies: [] };
    }
    if (!event.conversationKey || !event.senderKey || !event.eventId) {
      return { handled: false, replies: [] };
    }
    if (text.length > 8000) return reply('消息有点长，请分段发送。');
    if (imageUrls.length > 8) return reply('图片有点多，一次最多发 8 张。');
    if (imageUrls.some((imageUrl) => !imageUrl)) {
      return reply('这张图片暂时读取不了，重新发一下。');
    }
    let userContent:
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        > = text;
    const sessionKey = createHash('sha256')
      .update(
        JSON.stringify([
          this.options.runtime.installationId,
          event.scope,
          event.conversationKey,
          event.senderKey,
        ]),
      )
      .digest('hex');
    const startedAt = Date.now();
    const previous = this.sessionTails.get(sessionKey) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => completion);
    this.sessionTails.set(sessionKey, tail);
    void tail.then(() => {
      if (this.sessionTails.get(sessionKey) === tail) {
        this.sessionTails.delete(sessionKey);
      }
    });
    let queueTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        previous.then(() => true),
        new Promise<boolean>((resolve) => {
          queueTimeout = setTimeout(() => resolve(false), 15000);
        }),
      ]);
      clearTimeout(queueTimeout);
      if (!ready) {
        return reply('前面的消息还在处理，请稍后再发这条。');
      }
      const config = this.options.runtime.configSnapshot;
      const base = config.HERMES_AGENT_BASE_URL;
      const apiKey = config.HERMES_AGENT_API_KEY;
      const requestJson = this.options.host.requestJson;
      if (!base || !apiKey || typeof requestJson !== 'function') {
        return reply('对话服务尚未就绪。');
      }
      const url = new URL(base.replace(/\/+$/u, '') + '/chat/completions');
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        return reply('对话服务配置需要检查。');
      }
      if (imageUrls.length > 0) {
        const requestBuffer = this.options.host.requestBuffer;
        if (typeof requestBuffer !== 'function')
          return reply('图片服务尚未就绪。');
        userContent = [];
        if (text) userContent.push({ type: 'text', text });
        let remainingBytes = 6 * 1024 * 1024;
        for (const imageUrl of imageUrls) {
          if (remainingBytes <= 0)
            return reply('图片总大小超过 6 MiB，请分开发送。');
          const remainingMs = 55000 - (Date.now() - startedAt);
          if (remainingMs < 1000) return reply('图片读取超时，请重新发一下。');
          let bytes: Buffer;
          try {
            bytes = Buffer.from(
              (await requestBuffer({
                url: imageUrl,
                method: 'GET',
                timeoutMs: Math.min(8000, remainingMs),
                maxResponseBytes: Math.min(4 * 1024 * 1024, remainingBytes),
                context: 'QQ 图片读取',
              })) as Uint8Array,
            );
          } catch {
            return reply('图片读取失败或文件过大，请重新发一下。');
          }
          remainingBytes -= bytes.length;
          const imageDataUrl = toImageDataUrl(bytes);
          if (!imageDataUrl) return reply('这张图片的格式暂不支持。');
          userContent.push({
            type: 'image_url',
            image_url: { url: imageDataUrl },
          });
        }
      }
      const response = (await requestJson({
        url: url.toString(),
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': sessionKey,
          'Idempotency-Key': createHash('sha256')
            .update(JSON.stringify([sessionKey, event.eventId]))
            .digest('hex'),
        },
        body: JSON.stringify({
          model: 'kwitsukasa',
          messages: [
            {
              role: 'system',
              content:
                '这是 QQ 普通聊天。尽量简洁回复，不提供会话管理命令。长期记忆共享，但记录他人事实时保留发送者来源，避免混淆人物。' +
                `当前发送者标识：${JSON.stringify(event.senderKey)}；当前聊天标识：${sessionKey}。`,
            },
            { role: 'user', content: userContent },
          ],
          stream: false,
        }),
        timeoutMs: Math.max(1000, 55000 - (Date.now() - startedAt)),
        context: 'Hermes Agent',
        invalidJsonMessage: 'Hermes 返回格式错误',
        timeoutMessage: 'Hermes 回复超时',
      })) as HermesResponse;
      const content = response?.choices?.[0]?.message?.content;
      if (
        response?.error ||
        response?.hermes?.failed ||
        response?.hermes?.completed === false ||
        response?.hermes?.partial
      ) {
        return reply('这次没能生成回复，请稍后再试。');
      }
      if (
        response?.choices?.[0]?.finish_reason !== 'stop' ||
        typeof content !== 'string' ||
        !content.trim() ||
        /^HTTP [45]\d\d:/u.test(content)
      ) {
        return reply('这次没能生成回复，请稍后再试。');
      }
      return splitReply(content.trim(), event.scope);
    } catch {
      const warn = this.options.host.warn;
      if (typeof warn === 'function') {
        try {
          await warn('Hermes 对话调用失败，请检查私网服务健康与上游授权。');
        } catch {
          // 告警通道失败不改变面向用户的回复结果。
        }
      }
      return reply('暂时没连上对话服务，请稍后再试。');
    } finally {
      clearTimeout(queueTimeout);
      release();
    }
  }
}

/**
 * 依据文件签名编码常见图片，避免把临时 QQ 链接或伪装成图片的文本传给上游。
 * @param bytes - 宿主在大小与耗时边界内取得的图片二进制内容。
 * @returns 含真实 MIME 类型的图片数据地址；签名不支持时为空字符串。
 */
function toImageDataUrl(bytes: Buffer): string {
  let mime = '';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    mime = 'image/jpeg';
  } else if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    mime = 'image/png';
  } else if (
    ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
  ) {
    mime = 'image/gif';
  } else if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    mime = 'image/webp';
  }
  if (!mime) return '';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/**
 * 将单条文本封装成由宿主当前回复上下文发送的意图。
 * @param content - 已通过长度与错误信息边界检查的正文。
 * @returns 已处理事件及唯一文本回复。
 */
function reply(content: string): BotPluginEventResult {
  return { handled: true, replies: [{ kind: 'text', content }] };
}

/**
 * 按完整字符拆分回复并遵守私聊四条、群聊五条的被动回复预算，超限时明确说明未发送部分。
 * @param content - Hermes 已完成推理的正文。
 * @param scope - 宿主识别的当前聊天范围，用于选择回复条数上限。
 * @returns 预算内由宿主按原消息上下文发送的文本回复。
 */
function splitReply(
  content: string,
  scope: BotPluginMessageEvent['scope'],
): BotPluginEventResult {
  const characters = Array.from(content);
  const replies: BotPluginEventResult['replies'] = [];
  let maximumParts = 5;
  if (scope === 'direct') {
    maximumParts = 4;
  }
  const budget = maximumParts * 1800;
  const limit = Math.min(characters.length, budget);
  for (let offset = 0; offset < limit; offset += 1800) {
    let part = characters.slice(offset, offset + 1800).join('');
    if (offset === budget - 1800 && characters.length > budget) {
      part =
        characters.slice(offset, offset + 1700).join('') +
        '\n（回复超过本次消息长度限制，后续内容未发送，可让我继续。）';
    }
    replies.push({ kind: 'text', content: part });
  }
  return { handled: true, replies };
}
