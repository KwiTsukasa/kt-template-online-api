import { createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolsService } from '@/common';
import type {
  BotConnectionMode,
  BotMessageType,
  BotNormalizedMessage,
} from '@/modules/bot-adapter/core/contract/bot.types';
import type {
  TencentMenuItem,
  TencentPanelItem,
  TencentPanelScope,
  TencentPluginMenuProjection,
  TencentReplyContext,
} from '../contract/tencent-bot.types';
import {
  TENCENT_MANAGED_MENU_PREFIX,
  TENCENT_MANAGED_PANEL_REMARK_PREFIX,
  TENCENT_PANEL_SCOPES,
} from '../contract/tencent-bot.constants';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import { BotEventService } from '@/modules/bot-adapter/core/application/event/bot-event.service';
import { TencentBotPluginBindingService } from '../application/tencent-bot-plugin-binding.service';

type OfficialMessageResponse = {
  ext_info?: { ref_idx?: string };
  id: string;
  timestamp: number | string;
};

type OfficialImageSource = { buffer: Buffer } | { url: string };

type OfficialReplyTarget = TencentReplyContext;

type OfficialInboundMessage = {
  channelId?: string;
  content: string;
  groupOpenid?: string;
  guildId?: string;
  kind: 'c2c' | 'dm' | 'group' | 'guild';
  messageId: string;
  raw: Record<string, unknown>;
  rawEventType: string;
  replyTarget?: OfficialReplyTarget;
  senderId: string;
  senderIsBot?: boolean;
  senderName?: string;
  timestamp: string;
};

type OfficialSdkLogger = {
  debug(message: string): void;
  error(message: string): void;
  info(message: string): void;
  warn(message: string): void;
};

type OfficialBotClient = {
  api: {
    delete<T = unknown>(path: string): Promise<T>;
    get<T = unknown>(
      path: string,
      query?: Record<string, boolean | number | string>,
    ): Promise<T>;
    getToken(): Promise<string>;
    post<T = unknown>(path: string, body?: unknown): Promise<T>;
    put<T = unknown>(path: string, body?: unknown): Promise<T>;
  };
  messageApi: {
    getGatewayUrl(credentials: {
      appId: string;
      clientSecret: string;
    }): Promise<string>;
  };
  sendChannelMessage(
    channelId: string,
    content: string,
    options?: { msgId?: string },
  ): Promise<OfficialMessageResponse>;
  sendDmMessage(
    guildId: string,
    content: string,
    options?: { msgId?: string },
  ): Promise<OfficialMessageResponse>;
  sendImage(
    target: OfficialReplyTarget,
    source: OfficialImageSource,
    options?: { content?: string },
  ): Promise<{
    message?: OfficialMessageResponse;
    upload: unknown;
  }>;
  sendText(
    target: OfficialReplyTarget,
    content: string,
  ): Promise<OfficialMessageResponse>;
  on(
    event: string,
    handler: (...args: any[]) => Promise<void> | void,
  ): OfficialBotClient;
  start(signal?: AbortSignal): Promise<void>;
  stop(): void;
  tokenManager: {
    clearCache(appId?: string): void;
    startBackgroundRefresh(appId: string, clientSecret: string): void;
    stopBackgroundRefresh(appId?: string): void;
  };
};

type OfficialDispatchResult =
  | { action: 'ignore' }
  | { action: 'interaction'; event: unknown }
  | { action: 'message'; msg: OfficialInboundMessage }
  | { action: 'raw'; data: unknown; type: string }
  | { action: 'ready' | 'resumed'; data: unknown };

type OfficialRootModule = {
  QQBot: new (options: {
    accountId: string;
    appId: string;
    appSecret: string;
    intents?: number;
    logger: OfficialSdkLogger;
    markdownSupport: boolean;
    sessionPersistence?: OfficialSessionPersistence;
  }) => OfficialBotClient;
};

type OfficialProtocolModule = {
  FULL_INTENTS: number;
  dispatchEvent(
    eventType: string,
    data: unknown,
    accountId: string,
    logger: OfficialSdkLogger,
  ): OfficialDispatchResult;
  signValidationResponse(input: {
    botSecret: string;
    eventTs: string;
    plainToken: string;
  }): { plain_token: string; signature: string };
  verifyWebhookSignature(input: {
    body: Buffer;
    botSecret: string;
    signature: string;
    timestamp: string;
  }): boolean;
};

export type TencentBotSdkLoader = () => Promise<{
  protocol: OfficialProtocolModule;
  root: OfficialRootModule;
}>;

export const TENCENT_BOT_SDK_LOADER = Symbol('TENCENT_BOT_SDK_LOADER');

const importEsm = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;
const TENCENT_BOT_WEBHOOK_ALLOWED_PORTS = new Set([
  '',
  '80',
  '443',
  '8080',
  '8443',
]);

/**
 * 通过原生 ESM import 加载腾讯官方 SDK 高层发送与低层 Gateway/Webhook 协议入口。
 * @returns SDK 高层和 protocol 模块。
 */
export async function loadTencentBotSdk() {
  const [root, protocol] = await Promise.all([
    importEsm<OfficialRootModule>('@tencent-connect/qqbot-nodejs'),
    importEsm<OfficialProtocolModule>('@tencent-connect/qqbot-nodejs/protocol'),
  ]);
  return { protocol, root };
}

type OfficialAccountRuntime = {
  accountId: string;
  appId: string;
  appSecret: string;
  bot: OfficialBotClient;
  connectionMode: BotConnectionMode;
  selfId: string;
};

type OfficialGatewaySession = {
  lastSeq: null | number;
  sessionId: string;
};

type OfficialSessionPersistence = {
  clear(): void;
  load(): null | OfficialGatewaySession;
  save(session: OfficialGatewaySession): void;
};

type OfficialWebsocketRuntime = {
  abortController: AbortController;
  account: OfficialAccountRuntime;
  runPromise: Promise<void>;
};

type OfficialWebhookPayload = {
  d?: unknown;
  id?: string;
  op: number;
  s?: number;
  t?: string;
};

type OfficialMenuResponse = {
  menu?: { items?: TencentMenuItem[] };
  version: number;
};

type OfficialPanelRecord = {
  panel: {
    items?: TencentPanelItem[];
    remark?: string;
    version?: number;
  };
  panel_id: string;
  scope: TencentPanelScope;
  target_type: 'all' | 'specific';
  version: number;
};

type OfficialPanelListResponse = {
  is_end: boolean;
  next_cursor: string;
  records: OfficialPanelRecord[];
};

type OfficialPanelMutationPlan = {
  desiredItems: TencentPanelItem[];
  managedRecords: OfficialPanelRecord[];
  scope: TencentPanelScope;
};

export class TencentBotActionError extends Error {
  constructor(
    public readonly code:
      | 'official_disconnected'
      | 'official_rejected'
      | 'official_timeout',
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TencentBotActionError';
  }
}

@Injectable()
export class TencentBotService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly accounts = new Map<string, OfficialAccountRuntime>();
  private readonly logger = new Logger(TencentBotService.name);
  private readonly sessions = new Map<string, OfficialGatewaySession>();
  private readonly websockets = new Map<string, OfficialWebsocketRuntime>();

  constructor(
    @Inject(TENCENT_BOT_SDK_LOADER)
    private readonly loadSdk: TencentBotSdkLoader,
    private readonly accountService: BotAccountService,
    private readonly configService: ConfigService,
    private readonly eventService: BotEventService,
    private readonly toolsService: ToolsService,
    private readonly pluginBindingService: TencentBotPluginBindingService,
  ) {}

  onApplicationBootstrap() {
    void this.reconcileAll().catch((error) => {
      this.logger.error(`QQ 官方 Bot 恢复失败：${this.safeError(error)}`);
    });
  }

  async onModuleDestroy() {
    const selfIds = [...this.accounts.keys()];
    await Promise.all(selfIds.map((selfId) => this.stopAccount(selfId)));
  }

  /**
   * 逐项重建全部启用的官方运行态，隔离单账号失败并继续恢复其余账号。
   * @returns 扫描总数以及成功准备和失败账号数量。
   */
  async reconcileAll() {
    const accounts = await this.accountService.allEnabledOfficialWithSecret();
    let started = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        await this.startAccount(account);
        started += 1;
      } catch (error) {
        failed += 1;
        await this.accountService.markOfficialOffline(
          account.selfId,
          this.safeError(error),
        );
      }
    }
    return { failed, scanned: accounts.length, started };
  }

  /**
   * 在账号保存、启停或官方两种模式切换后原子停止旧运行态并按数据库配置重建。
   * @param accountId - 发生变更的 Bot 账号主键。
   * @param previousSelfId - AppID 改动前的内部账号键。
   * @returns 新模式、账号键、是否准备完成及可选 Webhook URL。
   */
  async reconcileAccount(accountId: string, previousSelfId?: string) {
    if (previousSelfId) await this.stopAccount(previousSelfId);
    const account =
      await this.accountService.findByIdWithOfficialSecret(accountId);
    if (!account) {
      return { connectionMode: null, selfId: null, started: false };
    }
    await this.stopAccount(account.selfId);
    if (!this.isOfficialMode(account.connectionMode) || !account.enabled) {
      return {
        connectionMode: account.connectionMode,
        selfId: account.selfId,
        started: false,
      };
    }
    try {
      const runtime = await this.startAccount(account);
      const result: Record<string, unknown> = {
        connectionMode: runtime.connectionMode,
        selfId: runtime.selfId,
        started: true,
      };
      if (runtime.connectionMode === 'official-webhook') {
        result.webhookUrl = this.webhookUrl(runtime);
      }
      return result;
    } catch (error) {
      await this.accountService.markOfficialOffline(
        account.selfId,
        this.safeError(error),
      );
      return {
        connectionMode: account.connectionMode,
        selfId: account.selfId,
        started: false,
      };
    }
  }

  /**
   * 强制重新准备官方账号；WebSocket 重建连接，Webhook 重新验证 token 并返回回调地址。
   * @param selfId - `qq-official:<AppID>` 稳定账号键。
   * @returns 重建数量、模式与可选 Webhook URL。
   * @throws 账号不存在、停用、模式不符或凭据无效时抛出错误。
   */
  async reconnect(selfId: string) {
    const account =
      await this.accountService.findEnabledOfficialBySelfIdWithSecret(selfId);
    if (!account) throw new Error('QQ 官方 Bot 账号不可用');
    await this.stopAccount(selfId);
    const runtime = await this.startAccount(account);
    const result: Record<string, unknown> = {
      connectionMode: runtime.connectionMode,
      count: 1,
      selfId,
    };
    if (runtime.connectionMode === 'official-webhook') {
      await runtime.bot.api.getToken();
      result.webhookUrl = this.webhookUrl(runtime);
    }
    return result;
  }

  /**
   * 停止官方账号的 WebSocket 与 token 刷新，并将通用连接状态标为离线。
   * @param selfId - `qq-official:<AppID>` 稳定账号键。
   * @returns 实际停止的账号运行态数量。
   */
  async disconnect(selfId: string) {
    const stopped = await this.stopAccount(selfId);
    await this.accountService.markOfficialOffline(selfId);
    let count = 0;
    if (stopped) count = 1;
    return { count };
  }

  /**
   * 读取官方 Webhook 账号的公网回调 URL，非 Webhook 账号失败关闭。
   * @param accountId - Bot 账号数据库主键。
   * @returns 可复制到 QQ 开放平台的 HTTPS 回调 URL。
   * @throws 账号不存在、未启用、非 Webhook 模式或公共基址未配置时抛出错误。
   */
  async getWebhookUrl(accountId: string) {
    const account =
      await this.accountService.findByIdWithOfficialSecret(accountId);
    if (
      !account ||
      !account.enabled ||
      account.connectionMode !== 'official-webhook'
    ) {
      throw new Error('QQ 官方 Webhook 账号不可用');
    }
    const runtime = await this.ensureAccountRuntime(account);
    return { url: this.webhookUrl(runtime) };
  }

  /**
   * 把插件平台投影同步到 QQ 官方全局自定义菜单与四场景指令面板，并仅改写带 KT 稳定标识的资源。
   * @param input - 官方账号稳定键以及已完成平台上限校验的菜单投影。
   * @returns 本次实际创建、更新、删除或保持不变的资源计数。
   * @throws 账号不可用、官方菜单容量不足或 OpenAPI 拒绝请求时抛出结构化官方调用错误。
   */
  async syncPluginMenus(input: {
    projection: TencentPluginMenuProjection;
    selfId: string;
  }) {
    const account =
      await this.accountService.findEnabledOfficialBySelfIdWithSecret(
        input.selfId,
      );
    if (!account) {
      throw new TencentBotActionError(
        'official_disconnected',
        'QQ 官方 Bot 账号不可用，无法同步插件菜单',
        true,
      );
    }
    const runtime = await this.ensureAccountRuntime(account);
    try {
      return await this.applyPluginMenuProjection(
        runtime.bot,
        input.projection,
      );
    } catch (error) {
      throw this.toActionError(error);
    }
  }

  /**
   * 先读取官方菜单与全部面板形成无副作用变更计划，再按差异顺序执行写入以保持重试幂等。
   * @param bot - 已绑定正确 AppID、AppSecret 与访问令牌管理器的官方客户端。
   * @param projection - 插件平台当前期望的菜单和四场景面板内容。
   * @returns 官方资源实际变更计数。
   * @throws 合并后菜单或面板总量超过官方上限时在任何写入前抛出错误。
   */
  private async applyPluginMenuProjection(
    bot: OfficialBotClient,
    projection: TencentPluginMenuProjection,
  ) {
    const menuResponse = await bot.api.get<OfficialMenuResponse>('/v2/menu');
    const panelRecords = new Map<TencentPanelScope, OfficialPanelRecord[]>();
    for (const scope of TENCENT_PANEL_SCOPES) {
      panelRecords.set(scope, await this.listOfficialPanels(bot, scope));
    }

    const currentMenuItems = menuResponse.menu?.items || [];
    const nextMenuItems = this.mergeManagedMenuItems(
      currentMenuItems,
      projection.menuItems,
    );
    const panelPlans = this.buildPanelMutationPlans(panelRecords, projection);
    this.assertProjectedPanelCapacity(panelRecords, panelPlans);

    let menuUpdated = 0;
    if (!isDeepStrictEqual(currentMenuItems, nextMenuItems)) {
      await bot.api.put<{ version: number }>('/v2/menu', {
        menu: { items: nextMenuItems },
      });
      menuUpdated = 1;
    }

    let panelsCreated = 0;
    let panelsDeleted = 0;
    let panelsUpdated = 0;
    for (const plan of panelPlans) {
      const result = await this.applyPanelMutationPlan(bot, plan);
      panelsCreated += result.created;
      panelsDeleted += result.deleted;
      panelsUpdated += result.updated;
    }
    return {
      menuUpdated,
      panelsCreated,
      panelsDeleted,
      panelsUpdated,
    };
  }

  /**
   * 分页读取单一场景的全部官方面板，并拒绝服务端重复游标造成的无限循环。
   * @param bot - 当前官方账号客户端。
   * @param scope - 待查询的 C2C、群、文字子频道或频道私信场景。
   * @returns 该场景所有面板记录。
   * @throws 官方分页游标不前进时抛出错误。
   */
  private async listOfficialPanels(
    bot: OfficialBotClient,
    scope: TencentPanelScope,
  ) {
    const records: OfficialPanelRecord[] = [];
    let cursor = '';
    for (;;) {
      const query: Record<string, number | string> = { limit: 50, scope };
      if (cursor) query.cursor = cursor;
      const response = await bot.api.get<OfficialPanelListResponse>(
        '/v2/panels',
        query,
      );
      records.push(...(response.records || []));
      if (response.is_end || !response.next_cursor) break;
      if (response.next_cursor === cursor) {
        throw new Error(`QQ 官方指令面板分页游标未前进：${scope}`);
      }
      cursor = response.next_cursor;
    }
    return records;
  }

  /**
   * 保留非 KT 菜单项并整体替换 KT 前缀项，保证绑定变化不会误删人工或第三方菜单。
   * @param currentItems - QQ 官方当前全局菜单项。
   * @param managedItems - 插件平台本次生成且必须带 KT 前缀的菜单项。
   * @returns 合并后的完整菜单配置。
   * @throws 托管项缺少稳定前缀或合并后超过十个顶级项时抛出错误。
   */
  private mergeManagedMenuItems(
    currentItems: TencentMenuItem[],
    managedItems: TencentMenuItem[],
  ) {
    const invalidManagedItem = managedItems.find(
      (item) => !item.name.startsWith(TENCENT_MANAGED_MENU_PREFIX),
    );
    if (invalidManagedItem) {
      throw new Error('QQ 官方插件菜单缺少 KT 托管前缀');
    }
    const preservedItems = currentItems.filter(
      (item) => !item.name.startsWith(TENCENT_MANAGED_MENU_PREFIX),
    );
    const merged = [...managedItems, ...preservedItems];
    if (merged.length > 10) {
      throw new Error(
        `QQ 官方自定义菜单合并后为 ${merged.length} 项，超过最多 10 项限制`,
      );
    }
    return merged;
  }

  /**
   * 为四个官方场景建立只包含同一 KT remark 资源的变更计划，外部面板始终保持只读。
   * @param recordsByScope - 按场景读取到的官方面板记录。
   * @param projection - 当前账号期望的菜单投影。
   * @returns 按官方场景固定顺序排列的变更计划。
   */
  private buildPanelMutationPlans(
    recordsByScope: Map<TencentPanelScope, OfficialPanelRecord[]>,
    projection: TencentPluginMenuProjection,
  ): OfficialPanelMutationPlan[] {
    const plans: OfficialPanelMutationPlan[] = [];
    for (const scope of TENCENT_PANEL_SCOPES) {
      const remark = this.managedPanelRemark(scope);
      const records = recordsByScope.get(scope) || [];
      plans.push({
        desiredItems: projection.panels[scope],
        managedRecords: records.filter(
          (record) => record.panel.remark === remark,
        ),
        scope,
      });
    }
    return plans;
  }

  /**
   * 在写入前计算去重和空面板删除后的机器人总面板数，避免前半段成功后才发现容量不足。
   * @param recordsByScope - 四个场景当前面板集合。
   * @param plans - 即将执行的 KT 面板计划。
   * @throws 预计结果超过一个机器人最多二十个面板时抛出错误。
   */
  private assertProjectedPanelCapacity(
    recordsByScope: Map<TencentPanelScope, OfficialPanelRecord[]>,
    plans: OfficialPanelMutationPlan[],
  ) {
    const panelIds = new Set<string>();
    recordsByScope.forEach((records) => {
      records.forEach((record) => panelIds.add(record.panel_id));
    });
    let projectedCount = panelIds.size;
    for (const plan of plans) {
      if (plan.desiredItems.length === 0) {
        projectedCount -= plan.managedRecords.length;
        continue;
      }
      if (plan.managedRecords.length === 0) {
        projectedCount += 1;
        continue;
      }
      projectedCount -= plan.managedRecords.length - 1;
    }
    if (projectedCount > 20) {
      throw new Error(
        `QQ 官方指令面板同步后为 ${projectedCount} 个，超过机器人最多 20 个面板限制`,
      );
    }
  }

  /**
   * 对单场景执行创建、覆盖、去重或清空，并只删除带精确 KT remark 的面板。
   * @param bot - 当前官方账号客户端。
   * @param plan - 单场景期望项与已有 KT 面板集合。
   * @returns 该场景创建、更新和删除数量。
   */
  private async applyPanelMutationPlan(
    bot: OfficialBotClient,
    plan: OfficialPanelMutationPlan,
  ) {
    let created = 0;
    let deleted = 0;
    let updated = 0;
    if (plan.desiredItems.length === 0) {
      for (const record of plan.managedRecords) {
        await bot.api.delete(
          `/v2/panels/${encodeURIComponent(record.panel_id)}`,
        );
        deleted += 1;
      }
      return { created, deleted, updated };
    }

    const desiredPanel = {
      items: plan.desiredItems,
      remark: this.managedPanelRemark(plan.scope),
    };
    const primary = plan.managedRecords[0];
    if (!primary) {
      await bot.api.post<{ panel_id: string }>('/v2/panels', {
        panel: desiredPanel,
        scope: plan.scope,
        target_type: 'all',
      });
      created = 1;
      return { created, deleted, updated };
    }

    const currentPanel = {
      items: primary.panel.items || [],
      remark: primary.panel.remark || '',
    };
    if (!isDeepStrictEqual(currentPanel, desiredPanel)) {
      await bot.api.put<{ version: number }>(
        `/v2/panels/${encodeURIComponent(primary.panel_id)}`,
        { panel: desiredPanel },
      );
      updated = 1;
    }
    for (const duplicate of plan.managedRecords.slice(1)) {
      await bot.api.delete(
        `/v2/panels/${encodeURIComponent(duplicate.panel_id)}`,
      );
      deleted += 1;
    }
    return { created, deleted, updated };
  }

  /**
   * 为场景生成不向用户展示的稳定资源归属标识，供重复同步精确定位自己的面板。
   * @param scope - 官方面板场景。
   * @returns 长度受控且跨进程稳定的 KT remark。
   */
  private managedPanelRemark(scope: TencentPanelScope) {
    return `${TENCENT_MANAGED_PANEL_REMARK_PREFIX}${scope}`;
  }

  /**
   * 处理 QQ 官方 Webhook 原始请求：校验账号级 URL token、challenge、Ed25519 签名并立即 ACK。
   * @param input - AppID、URL token、原始请求体和官方签名头。
   * @returns HTTP 状态和 JSON 响应体；事件业务处理在验签后异步执行。
   */
  async handleWebhook(input: {
    appId: string;
    body: Buffer;
    signature: string;
    timestamp: string;
    webhookToken: string;
  }) {
    if (
      !/^\d{5,20}$/u.test(input.appId) ||
      !/^[a-f0-9]{64}$/u.test(input.webhookToken)
    ) {
      return { body: { error: 'not found' }, status: 404 };
    }
    const account =
      await this.accountService.findEnabledOfficialByAppIdWithSecret(
        input.appId,
      );
    if (!account || account.connectionMode !== 'official-webhook') {
      return { body: { error: 'not found' }, status: 404 };
    }
    const runtime = await this.ensureAccountRuntime(account);
    if (!this.isWebhookTokenValid(runtime, input.webhookToken)) {
      return { body: { error: 'not found' }, status: 404 };
    }
    let payload: OfficialWebhookPayload;
    try {
      payload = JSON.parse(input.body.toString('utf8'));
    } catch {
      return { body: { error: 'invalid json' }, status: 400 };
    }
    const sdk = await this.loadSdk();
    if (payload.op === 13) {
      const validation = this.validationPayload(payload.d);
      if (!validation) {
        return { body: { error: 'invalid validation' }, status: 400 };
      }
      const body = sdk.protocol.signValidationResponse({
        botSecret: runtime.appSecret,
        eventTs: validation.eventTs,
        plainToken: validation.plainToken,
      });
      void this.accountService
        .markOfficialOnline(runtime.selfId)
        .catch((error) => {
          this.logger.warn(
            `QQ 官方 Webhook 状态更新失败 ${runtime.selfId}：${this.safeError(error)}`,
          );
        });
      return { body, status: 200 };
    }
    if (!input.timestamp || !input.signature) {
      return { body: { error: 'missing signature' }, status: 401 };
    }
    const valid = sdk.protocol.verifyWebhookSignature({
      body: input.body,
      botSecret: runtime.appSecret,
      signature: input.signature,
      timestamp: input.timestamp,
    });
    if (!valid) {
      return { body: { error: 'invalid signature' }, status: 401 };
    }
    void this.accountService
      .markOfficialActivity(runtime.selfId)
      .catch((error) => {
        this.logger.warn(
          `QQ 官方 Webhook 活动状态更新失败 ${runtime.selfId}：${this.safeError(error)}`,
        );
      });
    if (payload.op === 0) {
      void this.dispatchWebhook(runtime, sdk.protocol, payload).catch(
        (error) => {
          this.logger.warn(
            `QQ 官方 Webhook 事件失败 ${runtime.selfId}：${this.safeError(error)}`,
          );
        },
      );
    }
    return { body: { d: 0, op: 12 }, status: 200 };
  }

  /**
   * 通过当前官方发送客户端投递私聊、群聊、频道或频道私信文本，并保留被动回复 message ID。
   * @param input - 账号、目标、频道上下文、正文和可选入站消息关联。
   * @returns 腾讯官方消息响应中的消息 ID、时间与引用索引。
   * @throws 账号、目标或官方 API 不可用时抛出结构化发送错误。
   */
  async sendText(input: {
    channelId?: string;
    guildId?: string;
    message: string;
    adapterReplyContext?: unknown;
    replyMessageId?: string;
    selfId: string;
    targetId: string;
    targetType: BotMessageType;
  }) {
    let runtime = this.accounts.get(input.selfId);
    if (!runtime) {
      const account =
        await this.accountService.findEnabledOfficialBySelfIdWithSecret(
          input.selfId,
        );
      if (!account) {
        throw new TencentBotActionError(
          'official_disconnected',
          'QQ 官方 Bot 账号不可用',
          true,
        );
      }
      runtime = await this.ensureAccountRuntime(account);
    }
    try {
      if (input.targetType === 'private') {
        return await this.sendDirectMessage(runtime.bot, {
          message: input.message,
          adapterReplyContext: input.adapterReplyContext,
          replyMessageId: input.replyMessageId,
          scope: 'c2c',
          targetId: input.targetId,
        });
      }
      if (input.targetType === 'group') {
        return await this.sendDirectMessage(runtime.bot, {
          message: input.message,
          adapterReplyContext: input.adapterReplyContext,
          replyMessageId: input.replyMessageId,
          scope: 'group',
          targetId: input.targetId,
        });
      }
      if (input.guildId && input.channelId === input.guildId) {
        return await runtime.bot.sendDmMessage(input.guildId, input.message, {
          msgId: input.replyMessageId,
        });
      }
      const channelId = input.channelId || input.targetId;
      if (!channelId) throw new Error('QQ 官方频道 ID 不能为空');
      return await runtime.bot.sendChannelMessage(channelId, input.message, {
        msgId: input.replyMessageId,
      });
    } catch (error) {
      throw this.toActionError(error);
    }
  }

  /**
   * 向 C2C 或群目标发送文本，并把现有插件生成的 CQ 图片段转换为官方媒体上传。
   * @param bot - 当前账号的官方发送客户端。
   * @param input - 目标范围、OpenID、正文和可选被动回复消息 ID。
   * @returns 最后一次文本或图片消息的官方响应。
   * @throws 图片来源非法、图片过大或官方上传未返回消息时抛出错误。
   */
  private async sendDirectMessage(
    bot: OfficialBotClient,
    input: {
      message: string;
      adapterReplyContext?: unknown;
      replyMessageId?: string;
      scope: 'c2c' | 'group';
      targetId: string;
    },
  ) {
    const parsed = this.parseCqImages(input.message);
    const replyTarget = this.resolveOutboundReplyTarget(input);
    if (parsed.images.length === 0) {
      return bot.sendText(replyTarget, parsed.text);
    }

    let response: OfficialMessageResponse | undefined;
    for (const [index, source] of parsed.images.entries()) {
      const target: OfficialReplyTarget = {
        scope: input.scope,
        targetId: input.targetId,
      };
      if (index === 0 && input.replyMessageId) {
        target.msgId = input.replyMessageId;
      }
      const options: { content?: string } = {};
      if (index === 0 && parsed.text) options.content = parsed.text;
      const sent = await bot.sendImage(target, source, options);
      if (!sent.message) {
        throw new Error('QQ 官方图片上传后未返回消息结果');
      }
      response = sent.message;
    }
    if (!response) throw new Error('QQ 官方图片消息未发送');
    return response;
  }

  /**
   * 对被动回复复用 SDK 原始 ReplyTarget，并校验它与当前发送目标和 msgId 完全一致；主动发送才按参数构造目标。
   * @param input - C2C/群范围、OpenID、可选入站 msgId 与 SDK ReplyTarget。
   * @returns 可安全交给官方 `sendText`/`sendImage` 的目标。
   * @throws SDK ReplyTarget 与当前发送身份不一致时抛出错误。
   */
  private resolveOutboundReplyTarget(input: {
    adapterReplyContext?: unknown;
    replyMessageId?: string;
    scope: 'c2c' | 'group';
    targetId: string;
  }): OfficialReplyTarget {
    const expected: OfficialReplyTarget = {
      msgId: input.replyMessageId,
      scope: input.scope,
      targetId: input.targetId,
    };
    if (!input.adapterReplyContext) return expected;
    if (!this.isReplyContext(input.adapterReplyContext)) {
      throw new Error('Tencent 被动回复上下文格式无效');
    }
    if (
      input.adapterReplyContext.scope !== expected.scope ||
      input.adapterReplyContext.targetId !== expected.targetId ||
      input.adapterReplyContext.msgId !== expected.msgId
    ) {
      throw new Error('QQ 官方被动回复目标与入站消息身份不一致');
    }
    return input.adapterReplyContext;
  }

  /**
   * 校验 Bot 核心传入的 opaque 回复上下文是否符合 Tencent ReplyTarget 合同。
   * @param value - Bot 核心不解释的适配器回复上下文。
   * @returns 包含合法 scope、targetId 与可选 msgId 时返回 true。
   */
  private isReplyContext(value: unknown): value is OfficialReplyTarget {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (record.scope !== 'c2c' && record.scope !== 'group') return false;
    if (typeof record.targetId !== 'string' || !record.targetId) return false;
    if (record.msgId !== undefined && typeof record.msgId !== 'string') {
      return false;
    }
    return true;
  }

  /**
   * 从 OneBot 兼容正文抽取 CQ 图片段，支持 HTTPS URL 与 base64 数据并保留其余文本。
   * @param message - 现有命令、规则或插件生成的消息正文。
   * @returns 去除 CQ 图片段后的文本及按原顺序得到的官方图片来源。
   * @throws 图片 URL 非 HTTPS、base64 非法或解码后超过 25 MiB 时抛出错误。
   */
  private parseCqImages(message: string) {
    const images: OfficialImageSource[] = [];
    const pattern = /\[CQ:image,file=([^\]]+)\]/gu;
    const text = message.replace(pattern, (_segment, encoded: string) => {
      const value = this.decodeCqValue(encoded).trim();
      if (value.startsWith('base64://')) {
        const base64 = value.slice('base64://'.length);
        if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) {
          throw new Error('QQ 官方图片 base64 数据无效');
        }
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > 25 * 1024 * 1024) {
          throw new Error('QQ 官方图片不能超过 25 MiB');
        }
        images.push({ buffer });
        return '';
      }
      const url = new URL(value);
      if (url.protocol !== 'https:') {
        throw new Error('QQ 官方远程图片只允许 HTTPS URL');
      }
      images.push({ url: url.toString() });
      return '';
    });
    return { images, text: text.trim() };
  }

  /**
   * 按 OneBot CQ 参数顺序还原逗号、方括号和与号实体。
   * @param value - CQ 图片 file 参数原文。
   * @returns 可用于 URL 或 base64 解析的原始参数值。
   */
  private decodeCqValue(value: string) {
    return value
      .replace(/&#44;/gu, ',')
      .replace(/&#91;/gu, '[')
      .replace(/&#93;/gu, ']')
      .replace(/&amp;/gu, '&');
  }

  /**
   * 返回 WebSocket 与 Webhook 双 transport 运行摘要，不包含凭据、访问 token、Gateway session ID 或 URL token。
   * @returns 官方 provider、两种模式账号数和 WebSocket 活动账号稳定键。
   */
  getRuntimeStatus() {
    let webhookAccounts = 0;
    let websocketAccounts = 0;
    this.accounts.forEach((account) => {
      if (account.connectionMode === 'official-webhook') {
        webhookAccounts += 1;
      }
      if (account.connectionMode === 'official-websocket') {
        websocketAccounts += 1;
      }
    });
    return {
      provider: '@tencent-connect/qqbot-nodejs',
      webhookAccounts,
      websocketAccounts,
      websocketSessions: [...this.websockets.keys()],
    };
  }

  /**
   * 为官方账号创建或复用发送客户端，并按模式决定是否建立 WebSocket Gateway。
   * @param account - 已启用并显式加载密文的官方账号。
   * @returns 当前账号运行态。
   */
  private async startAccount(account: {
    connectionMode: BotConnectionMode;
    id: string;
    officialAppId: null | string;
    officialAppSecretCiphertext: null | string;
    selfId: string;
  }) {
    const runtime = await this.ensureAccountRuntime(account);
    if (runtime.connectionMode === 'official-websocket') {
      await this.startWebsocket(runtime);
    }
    return runtime;
  }

  /**
   * 创建官方高层客户端；WebSocket 由官方 start 统一管理 token/Gateway，Webhook 仅启动发送 token 刷新。
   * @param account - 已显式加载 AppID 与 AppSecret 密文的官方账号。
   * @returns 可供双 transport 共用的发送运行态。
   * @throws AppID、AppSecret 或官方连接模式缺失时拒绝创建运行态。
   */
  private async ensureAccountRuntime(account: {
    connectionMode: BotConnectionMode;
    id: string;
    officialAppId: null | string;
    officialAppSecretCiphertext: null | string;
    selfId: string;
  }) {
    const existing = this.accounts.get(account.selfId);
    if (existing && existing.connectionMode === account.connectionMode) {
      return existing;
    }
    if (existing) await this.stopAccount(existing.selfId);
    const appId = `${account.officialAppId || ''}`.trim();
    const appSecret = this.accountService.getOfficialAppSecret(account);
    if (!appId || !appSecret || !this.isOfficialMode(account.connectionMode)) {
      throw new Error('QQ 官方 Bot 凭据或模式不完整');
    }
    const sdk = await this.loadSdk();
    const bot = new sdk.root.QQBot({
      accountId: account.selfId,
      appId,
      appSecret,
      intents: sdk.protocol.FULL_INTENTS,
      logger: this.sdkLogger(account.selfId),
      markdownSupport: false,
      sessionPersistence: this.sessionPersistence(account.selfId),
    });
    if (account.connectionMode === 'official-webhook') {
      bot.tokenManager.startBackgroundRefresh(appId, appSecret);
    }
    const runtime: OfficialAccountRuntime = {
      accountId: account.id,
      appId,
      appSecret,
      bot,
      connectionMode: account.connectionMode,
      selfId: account.selfId,
    };
    this.accounts.set(account.selfId, runtime);
    return runtime;
  }

  /**
   * 为账号注册唯一 Gateway generation，并把 READY、消息、原始事件、错误和 RESUME 会话接回领域端口。
   * @param account - 已初始化发送客户端的 WebSocket 官方账号。
   */
  private async startWebsocket(account: OfficialAccountRuntime) {
    if (this.websockets.has(account.selfId)) return;
    const abortController = new AbortController();
    const runtime: OfficialWebsocketRuntime = {
      abortController,
      account,
      runPromise: Promise.resolve(),
    };
    this.websockets.set(account.selfId, runtime);
    account.bot
      .on('ready', () => {
        void this.markWebsocketReady(runtime);
      })
      .on('resumed', () => {
        void this.markWebsocketReady(runtime);
      })
      .on('message', (_context: unknown, message: OfficialInboundMessage) => {
        void this.consumeMessage(account, message);
      })
      .on('interaction', (_context: unknown, data: unknown) => {
        void this.consumeRawEvent(account, 'INTERACTION_CREATE', data);
      })
      .on('rawEvent', (context: { data: unknown; eventType: string }) => {
        void this.consumeRawEvent(account, context.eventType, context.data);
      })
      .on('error', (error: unknown) => {
        const normalized = (() => {
          if (error instanceof Error) return error;
          return new Error(`${error}`);
        })();
        void this.handleWebsocketError(runtime, normalized);
      });
    runtime.runPromise = account.bot.start(abortController.signal);
    const runPromise = runtime.runPromise;
    void runPromise.catch((error) => {
      if (!this.isCurrentWebsocket(runtime)) return;
      this.websockets.delete(account.selfId);
      void this.accountService.markOfficialOffline(
        account.selfId,
        this.safeError(error),
      );
    });
  }

  /**
   * 将 Webhook 事件交给 SDK 官方 dispatchEvent，并复用同一消息与 raw event 入口。
   * @param account - Webhook 账号运行态。
   * @param protocol - 已加载的官方协议模块。
   * @param payload - 已验签的官方 Webhook 载荷。
   */
  private async dispatchWebhook(
    account: OfficialAccountRuntime,
    protocol: OfficialProtocolModule,
    payload: OfficialWebhookPayload,
  ) {
    const result = protocol.dispatchEvent(
      payload.t || '',
      payload.d,
      account.selfId,
      this.sdkLogger(account.selfId),
    );
    if (result.action === 'message') {
      await this.consumeMessage(account, result.msg);
      return;
    }
    if (result.action === 'interaction') {
      await this.consumeRawEvent(account, 'INTERACTION_CREATE', result.event);
      return;
    }
    if (result.action === 'raw') {
      await this.consumeRawEvent(account, result.type, result.data);
      return;
    }
    if (result.action === 'ready' || result.action === 'resumed') {
      await this.accountService.markOfficialOnline(account.selfId);
    }
  }

  /**
   * 将官方消息转换为 transport-neutral 领域消息并交给统一去重、日志、命令、规则和插件链。
   * @param account - 当前官方账号运行态。
   * @param message - SDK protocol 层统一消息。
   */
  private async consumeMessage(
    account: OfficialAccountRuntime,
    message: OfficialInboundMessage,
  ) {
    try {
      if (message.senderIsBot) return;
      const normalized = this.normalizeMessage(account, message);
      await this.accountService.markOfficialActivity(account.selfId);
      await this.eventService.handleRawEvent(
        account.selfId,
        normalized.rawEvent,
      );
      const pluginKeys = await this.pluginBindingService.listBoundPluginKeys(
        account.accountId,
      );
      await this.eventService.handleNormalizedMessage(normalized, {
        pluginKeys,
      });
    } catch (error) {
      this.logger.warn(
        `QQ 官方 Bot 消息失败 ${account.selfId}：${this.safeError(error)}`,
      );
    }
  }

  /**
   * 发布官方非消息事件的安全投影，保留事件类型但不记录 SDK debug 或凭据。
   * @param account - 当前官方账号运行态。
   * @param eventType - QQ Gateway 原始事件类型。
   * @param data - 官方事件数据。
   */
  private async consumeRawEvent(
    account: OfficialAccountRuntime,
    eventType: string,
    data: unknown,
  ) {
    let payload: Record<string, unknown>;
    if (data && typeof data === 'object') {
      payload = { ...(data as Record<string, unknown>) };
    } else {
      payload = { data };
    }
    payload.connection_mode = account.connectionMode;
    payload.official_event_type = eventType;
    await this.eventService.handleRawEvent(account.selfId, payload);
  }

  /**
   * 将 C2C、群、频道及频道私信消息映射为 KT 统一消息合同。
   * @param account - 当前官方账号运行态。
   * @param message - SDK protocol 层统一消息。
   * @returns 可直接进入既有 Bot 业务内核的规范消息。
   * @throws 消息类型或关键目标标识缺失时抛出错误。
   */
  private normalizeMessage(
    account: OfficialAccountRuntime,
    message: OfficialInboundMessage,
  ): BotNormalizedMessage {
    let messageType: BotMessageType;
    let targetId = '';
    let groupId: string | undefined;
    let channelId: string | undefined;
    if (message.kind === 'c2c') {
      messageType = 'private';
      targetId = message.senderId;
    } else if (message.kind === 'group') {
      messageType = 'group';
      targetId = `${message.groupOpenid || ''}`;
      groupId = targetId;
    } else if (message.kind === 'guild') {
      messageType = 'channel';
      targetId = `${message.channelId || ''}`;
      channelId = targetId;
    } else if (message.kind === 'dm') {
      messageType = 'channel';
      targetId = `${message.guildId || ''}`;
      channelId = targetId;
    } else {
      throw new Error('QQ 官方 Bot 消息类型不受支持');
    }
    if (!targetId || !message.senderId || !message.messageId) {
      throw new Error('QQ 官方 Bot 消息缺少关键身份');
    }
    const eventTime = new Date(message.timestamp);
    const rawEvent = {
      ...message.raw,
      connection_mode: account.connectionMode,
      official_event_type: message.rawEventType,
      official_kind: message.kind,
    };
    let normalizedEventTime = eventTime;
    if (Number.isNaN(eventTime.getTime())) normalizedEventTime = new Date();
    return {
      channelId,
      connectionMode: account.connectionMode,
      eventTime: normalizedEventTime,
      groupId,
      guildId: message.guildId,
      messageId: message.messageId,
      messageText: this.stripOfficialMention(message.content, message.kind),
      messageType,
      adapterReplyContext: this.resolveInboundReplyTarget(message),
      rawEvent,
      rawMessage: message.content,
      replyMessageId: message.messageId,
      selfId: account.selfId,
      senderNickname: message.senderName || '',
      targetId,
      userId: message.senderId,
    };
  }

  /**
   * 优先保留官方 SDK 随入站消息派生的 ReplyTarget；底层 Webhook 消息仅对 C2C/群按官方同一规则补齐。
   * @param message - 官方 SDK 的统一入站消息。
   * @returns 可直接交回 `bot.sendText` 的被动回复目标；频道与频道私信返回 undefined。
   * @throws SDK ReplyTarget 与入站 kind、OpenID 或 messageId 不一致时抛出错误。
   */
  private resolveInboundReplyTarget(
    message: OfficialInboundMessage,
  ): OfficialReplyTarget | undefined {
    let expected: OfficialReplyTarget | undefined;
    if (message.kind === 'c2c') {
      expected = {
        msgId: message.messageId,
        scope: 'c2c',
        targetId: message.senderId,
      };
    }
    if (message.kind === 'group' && message.groupOpenid) {
      expected = {
        msgId: message.messageId,
        scope: 'group',
        targetId: message.groupOpenid,
      };
    }
    if (!message.replyTarget) return expected;
    if (
      !expected ||
      message.replyTarget.scope !== expected.scope ||
      message.replyTarget.targetId !== expected.targetId ||
      message.replyTarget.msgId !== expected.msgId
    ) {
      throw new Error('QQ 官方 SDK ReplyTarget 与入站消息身份不一致');
    }
    return message.replyTarget;
  }

  /**
   * 仅对群和频道正文移除官方 mention 标记，C2C 与频道私信保留原文后裁剪空白。
   * @param content - 官方消息正文。
   * @param kind - SDK 归一化会话类型。
   * @returns 可供现有命令解析器直接匹配的正文。
   */
  private stripOfficialMention(
    content: string,
    kind: OfficialInboundMessage['kind'],
  ) {
    if (kind !== 'group' && kind !== 'guild') return content.trim();
    return content.replace(/<@!?[^>]+>/g, '').trim();
  }

  /**
   * 只让当前 WebSocket generation 的 READY/RESUMED 更新在线状态。
   * @param runtime - 触发 READY 或 RESUMED 的 WebSocket 运行态。
   */
  private async markWebsocketReady(runtime: OfficialWebsocketRuntime) {
    if (!this.isCurrentWebsocket(runtime)) return;
    await this.accountService.markOfficialOnline(runtime.account.selfId);
  }

  /**
   * 记录当前 WebSocket 错误并保留 SDK 自动重连，旧 generation 不覆盖新状态。
   * @param runtime - 触发错误的 WebSocket 运行态。
   * @param error - SDK WebSocket 错误。
   */
  private async handleWebsocketError(
    runtime: OfficialWebsocketRuntime,
    error: Error,
  ) {
    if (!this.isCurrentWebsocket(runtime)) return;
    await this.accountService.markOfficialOffline(
      runtime.account.selfId,
      this.safeError(error),
    );
  }

  /**
   * 停止账号 WebSocket 与 token 刷新并移除运行态；Webhook 没有额外长连接。
   * @param selfId - 需要停止的官方稳定账号键。
   * @returns 是否实际停止了账号运行态。
   */
  private async stopAccount(selfId: string) {
    const websocket = this.websockets.get(selfId);
    if (websocket) {
      this.websockets.delete(selfId);
      websocket.abortController.abort();
      websocket.account.bot.stop();
      await websocket.runPromise.catch(() => undefined);
    }
    const account = this.accounts.get(selfId);
    if (!account) return !!websocket;
    this.accounts.delete(selfId);
    account.bot.tokenManager.stopBackgroundRefresh(account.appId);
    return true;
  }

  /**
   * 为 WebSocket RESUME 提供进程内同步 session port；Pod 重启后重新 IDENTIFY。
   * @param selfId - session 所属官方稳定账号键。
   * @returns 供官方连接恢复使用的同步会话读写接口。
   */
  private sessionPersistence(selfId: string) {
    return {
      clear: () => this.sessions.delete(selfId),
      load: () => this.sessions.get(selfId) || null,
      save: (session: { lastSeq: null | number; sessionId: string }) => {
        this.sessions.set(selfId, { ...session });
      },
    };
  }

  /**
   * 从 challenge 载荷提取 plain_token 和 event_ts，字段缺失时返回 null。
   * @param data - op:13 的未知 d 载荷。
   * @returns 可签名的 challenge 字段或 null。
   */
  private validationPayload(data: unknown) {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const plainToken = `${record.plain_token || ''}`;
    const eventTs = `${record.event_ts || ''}`;
    if (!plainToken || !eventTs) return null;
    return { eventTs, plainToken };
  }

  /**
   * 使用 AppSecret 派生账号级 URL capability token，并以常量时间比较防止旁路探测。
   * @param account - Webhook 账号运行态。
   * @param candidate - 回调 URL 中的 token。
   * @returns token 长度与内容均一致时返回 true。
   */
  private isWebhookTokenValid(
    account: OfficialAccountRuntime,
    candidate: string,
  ) {
    const expected = this.webhookToken(account);
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(candidate, 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  /**
   * 使用 AppSecret 为 HMAC 密钥绑定固定用途和 AppID，用于防止回调路径跨账号复用。
   * @param account - 提供 AppID 与 AppSecret 的 Webhook 账号运行态。
   * @returns 64 位小写十六进制路径能力 token。
   */
  private webhookToken(account: OfficialAccountRuntime) {
    return createHmac('sha256', account.appSecret)
      .update(`kt-tencent-bot-webhook:${account.appId}`)
      .digest('hex');
  }

  /**
   * 组合配置的公网 HTTPS 基址、AppID 与 capability token，拒绝非 HTTPS 或根路径逃逸。
   * @param account - Webhook 账号运行态。
   * @returns 可直接配置到 QQ 开放平台的完整回调 URL。
   * @throws 公共基址缺失、非 HTTPS 或带 query/hash 时抛出错误。
   */
  private webhookUrl(account: OfficialAccountRuntime) {
    const configured = `${
      this.configService.get<string>('TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL') ||
      ''
    }`.trim();
    if (!configured) {
      throw new Error('TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL 未配置');
    }
    const base = new URL(configured);
    if (
      base.protocol !== 'https:' ||
      base.search ||
      base.hash ||
      !TENCENT_BOT_WEBHOOK_ALLOWED_PORTS.has(base.port)
    ) {
      throw new Error(
        'QQ 官方 Webhook 公共基址必须是无 query/hash 且端口为 80/443/8080/8443 的 HTTPS URL',
      );
    }
    const prefix = base.pathname.replace(/\/+$/, '');
    base.pathname = `${prefix}/bot-adapter/tencent/webhook/${encodeURIComponent(
      account.appId,
    )}/${this.webhookToken(account)}`;
    return base.toString();
  }

  /**
   * 为官方 SDK 提供禁用 debug 的日志适配器，避免复制消息正文、openid、token 或 session。
   * @param selfId - 不包含 AppSecret 的内部稳定账号键。
   * @returns 仅转发 info/warn/error 摘要的 SDK logger。
   */
  private sdkLogger(selfId: string): OfficialSdkLogger {
    return {
      debug: () => undefined,
      error: (message) =>
        this.logger.error(`${selfId} ${this.redactSensitiveText(message)}`),
      info: (message) =>
        this.logger.log(`${selfId} ${this.redactSensitiveText(message)}`),
      warn: (message) =>
        this.logger.warn(`${selfId} ${this.redactSensitiveText(message)}`),
    };
  }

  /**
   * 从 SDK 日志和错误中移除凭据、授权头、Gateway/Webhook URL、session 及长 token，再限制持久化长度。
   * @param value - SDK 或网络层生成的未知文本。
   * @returns 不含当前账号 AppSecret 和常见认证材料的日志摘要。
   */
  private redactSensitiveText(value: unknown) {
    let text = `${value || ''}`;
    this.accounts.forEach((account) => {
      if (account.appSecret) {
        text = text.split(account.appSecret).join('[redacted-secret]');
      }
    });
    text = text
      .replace(/(?:https?|wss?):\/\/\S+/gi, '[redacted-url]')
      .replace(/\b(?:Bearer|Bot)\s+[^\s,;]+/gi, '[redacted-auth]')
      .replace(
        /\b(?:access[_-]?token|authorization|client[_-]?secret|session[_-]?id|token)\s*[=:]\s*[^\s,;]+/gi,
        '[redacted-credential]',
      )
      .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, '[redacted-token]');
    return this.toolsService.toColumnText(text, 500);
  }

  /**
   * 判断 WebSocket 回调是否仍属于账号当前 generation。
   * @param runtime - 待核对的 WebSocket 运行态。
   * @returns registry 仍指向该实例时返回 true。
   */
  private isCurrentWebsocket(runtime: OfficialWebsocketRuntime) {
    return this.websockets.get(runtime.account.selfId) === runtime;
  }

  /**
   * 将连接模式归入 QQ 官方 provider 家族，供凭据、生命周期和发送路由共用同一边界。
   * @param connectionMode - 待归类的账号连接模式。
   * @returns 官方 WebSocket/Webhook 返回 true，NapCat 返回 false。
   */
  private isOfficialMode(connectionMode: BotConnectionMode) {
    return (
      connectionMode === 'official-websocket' ||
      connectionMode === 'official-webhook'
    );
  }

  /**
   * 把 SDK API 错误归一为稳定发送分类，网络、限流和服务端错误允许耐久投递重试。
   * @param error - SDK API 或网络层抛出的未知错误。
   * @returns 带稳定错误码和 retryable 语义的官方发送异常。
   */
  private toActionError(error: unknown) {
    if (error instanceof TencentBotActionError) return error;
    const record = error as { httpStatus?: unknown };
    const httpStatus = Number(record?.httpStatus);
    const message = this.safeError(error);
    if (
      httpStatus === 0 ||
      httpStatus === 408 ||
      httpStatus === 429 ||
      httpStatus >= 500 ||
      /timeout|network|socket|connect/i.test(message)
    ) {
      return new TencentBotActionError('official_timeout', message, true);
    }
    return new TencentBotActionError('official_rejected', message, false);
  }

  /**
   * 将未知异常裁剪为可持久化且不主动附带凭据的错误摘要。
   * @param error - SDK、数据库或事件链抛出的未知异常。
   * @returns 最长 500 字符的错误文本。
   */
  private safeError(error: unknown) {
    return this.redactSensitiveText(
      this.toolsService.getErrorMessage(error, 'QQ 官方 Bot 调用失败'),
    );
  }
}
