export type BilibiliVideoReference =
  | {
      canonicalVideoId: string;
      kind: 'bvid';
      sourceUrl: string;
      value: string;
    }
  | {
      canonicalVideoId: string;
      kind: 'aid';
      sourceUrl: string;
      value: string;
    };

export type BilibiliUrlExtractionInput = {
  messageText?: string;
  rawEvent?: Record<string, unknown>;
  rawMessage?: string;
};

export type BilibiliCardRuntimeConfig = {
  dedupeTtlMs: number;
  descMaxLength: number;
  httpTimeoutMs: number;
  maxRedirects: number;
};

export type BilibiliCardHostJsonRequest = {
  context: string;
  failureMessage: (statusCode: number) => string;
  invalidJsonMessage: string;
  method?: string;
  timeoutMessage: string;
  timeoutMs: number;
  url: URL;
};

export type BilibiliCardRedirectRequest = {
  context?: string;
  maxRedirects: number;
  timeoutMessage?: string;
  timeoutMs: number;
  url: string;
};

export type BilibiliCardRedirectResult = {
  finalUrl: string;
  redirects: string[];
};

export type BilibiliCardPluginHost = {
  getBoundEventPluginKeys: (selfId: string) => Promise<string[]>;
  getConfig: <T = string>(key: string) => T | undefined;
  requestJson: <T = unknown>(
    request: BilibiliCardHostJsonRequest,
  ) => Promise<T>;
  resolveRedirect: (
    request: BilibiliCardRedirectRequest,
  ) => Promise<BilibiliCardRedirectResult>;
  sendText: (input: {
    channelId?: string;
    guildId?: string;
    message: string;
    selfId: string;
    targetId: string;
    targetType: string;
  }) => Promise<unknown>;
  warn?: (message: string) => void;
};

export type BilibiliVideoInfo = {
  aid: number;
  bvid: string;
  desc: string;
  duration: number;
  ownerName: string;
  pic: string;
  stat: {
    danmaku: number;
    like: number;
    view: number;
  };
  title: string;
};
