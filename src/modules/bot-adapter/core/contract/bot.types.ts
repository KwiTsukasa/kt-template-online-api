import type { QrcodeLookupOptions } from '@/common/types';
import type { BotAccount } from '../infrastructure/persistence/account/bot-account.entity';
import type { BotCommand } from '../infrastructure/persistence/command/bot-command.entity';
import type { BotAllowlist } from '../infrastructure/persistence/permission/bot-allowlist.entity';
import type { BotBlocklist } from '../infrastructure/persistence/permission/bot-blocklist.entity';

export type { QrcodeLookupOptions } from '@/common/types';

export type NapcatApiResponse<T> = {
  code: number;
  data?: T;
  message?: string;
};

export type NapcatCredential = {
  Credential?: string;
};

export type NapcatLoginInfo = Record<string, any> & {
  avatarUrl?: string;
  nick?: string;
  nickname?: string;
  online?: boolean;
  uin?: number | string;
};

export type NapcatLoginStatus = {
  captchaUrl?: string;
  isLogin?: boolean;
  isOffline?: boolean;
  loginError?: string;
  qrcodeRevision?: number;
  qrcodeUpdatedAt?: number;
  qrcodeurl?: string;
};

export type NapcatCaptchaLoginResult = {
  jumpUrl?: string;
  needCaptcha?: boolean;
  needNewDevice?: boolean;
  newDevicePullQrCodeSig?: unknown;
  proofWaterUrl?: string;
};

export type NapcatQrcode = {
  qrcode?: string;
  qrcodeurl?: string;
  url?: string;
};

export type NapcatRestartOptions = {
  processOnly?: boolean;
  waitForReady?: boolean;
};

export type BotConnectionMode =
  | 'official-webhook'
  | 'official-websocket'
  | 'reverse-ws';

export type BotConnectionRole = 'API' | 'Event' | 'Universal';

export type BotConnectionStatus = 'offline' | 'online';

export type BotLoginScanMode = 'create' | 'refresh';

export type BotLoginScanStatus = 'error' | 'expired' | 'pending' | 'success';

export type BotLoginNewDeviceStatus =
  | 'confirming'
  | 'expired'
  | 'failed'
  | 'qr-pending'
  | 'scanned'
  | 'verified';

export type BotMessageDirection = 'inbound' | 'outbound';

export type BotMessageType = 'channel' | 'group' | 'private';

export type BotRuntimeContainerStatus =
  | 'creating'
  | 'error'
  | 'running'
  | 'stopped'
  | 'unknown';

export type NapcatContainerStatus = BotRuntimeContainerStatus;

export type BotAccountNapcatBindStatus = 'bound' | 'disabled' | 'pending';

export type NapcatWebuiStatus = 'offline' | 'online' | 'unknown';

export type NapcatRuntimeLoginStatus =
  | 'offline'
  | 'online'
  | 'qrcode_expired'
  | 'qrcode_pending'
  | 'unknown';

export type NapcatRuntimeStatusSnapshot = {
  checkedAt?: Date;
  containerOnline: boolean;
  lastError?: null | string;
  qqLoginMessage?: null | string;
  qqLoginStatus: NapcatRuntimeLoginStatus;
  webuiOnline?: boolean | null;
};

export type BotAccountAbilityType = 'command' | 'event_plugin' | 'rule';

export type BotAccountNapcatRuntimeInfo = {
  bindStatus?: BotAccountNapcatBindStatus;
  containerId?: string;
  containerName?: string;
  containerOnline?: boolean;
  containerStatus?: BotRuntimeContainerStatus;
  profileStatus?: 'drift' | 'failed' | 'ok' | 'unknown';
  recoveryState?: 'idle' | 'password' | 'quick' | 'suspended';
  riskMode?: 'cooldown' | 'manual_only' | 'normal';
  runtimeProfile?: {
    desktopProfileVersion?: string;
    imageDigest?: string;
    imageRef?: string;
    locale?: string;
    shmSize?: string;
  };
  lastCheckedAt?: Date | null;
  lastError?: null | string;
  lastLoginAt?: Date | null;
  lastStartedAt?: Date | null;
  oneBotOnline?: boolean;
  qqLoginMessage?: null | string;
  qqLoginStatus?: NapcatRuntimeLoginStatus;
  webuiOnline?: boolean | null;
  webuiPort?: null | number;
};

export type BotAccountListItem = BotAccount & {
  napcat?: null | BotAccountNapcatRuntimeInfo;
};

export type BotRuleMatchType = 'equals' | 'keyword' | 'regex';

export type BotRuleTargetType = 'all' | 'channel' | 'group' | 'private';

export type BotCommandParserType = 'ff14Price' | 'fflogsCharacter' | 'plain';

export type BotCommandLogStatus = 'failed' | 'success';

export type BotCommandMatchResult = {
  alias: string;
  input: Record<string, any>;
  matched: true;
  rawArgs: string;
};

export type PluginHealthStatus = 'degraded' | 'healthy' | 'offline';

export type PluginHealth = {
  checkedAt: string;
  message?: string;
  name?: string;
  pluginKey?: string;
  status: PluginHealthStatus;
  triggerMode?: PluginTriggerMode;
};

export type PluginTriggerMode = 'command' | 'event';

export type PluginOperationContext = {
  args?: Record<string, any>;
  command?: BotCommand;
  message?: BotNormalizedMessage;
};

export type PluginOperation<Input = any, Output = any> = {
  aliases?: string[];
  cacheTtlMs?: number;
  description?: string;
  inputSchema?: Record<string, any>;
  key: string;
  name: string;
  outputSchema?: Record<string, any>;
  timeoutMs?: number;
  execute: (
    input: Input,
    context: PluginOperationContext,
  ) => Promise<Output>;
};

export type BotIntegrationPlugin = {
  activate?: () => Promise<unknown> | unknown;
  description?: string;
  healthCheck?: () => Promise<PluginHealth>;
  key: string;
  legacyKeys?: string[];
  name: string;
  operations: PluginOperation[];
  version: string;
};

export type BotEventPluginSummary = {
  accountName?: string;
  bound: boolean;
  connectStatus?: string;
  description?: string;
  key: string;
  name: string;
  remark?: string;
  selfId: string;
  triggerType: 'message';
  version: string;
};

export type BotEventPluginDefinition = {
  description?: string;
  key: string;
  name: string;
  remark?: string;
  triggerType: 'message';
  version: string;
};

export type PluginSummary = {
  description?: string;
  key: string;
  name: string;
  operationCount: number;
  triggerMode: PluginTriggerMode;
  version: string;
};

export type PluginOperationSummary = {
  aliases?: string[];
  cacheTtlMs?: number;
  description?: string;
  inputSchema?: Record<string, any>;
  key: string;
  name: string;
  outputSchema?: Record<string, any>;
  pluginKey: string;
  timeoutMs?: number;
  triggerMode: PluginTriggerMode;
};

export type BotSendStatus = 'failed' | 'pending' | 'success';

export type BotPermissionTargetType = 'channel' | 'group' | 'private' | 'qq';

export type BotPermissionConfig = {
  allowlistEnabled: boolean;
  blocklistEnabled: boolean;
};

export type BotPermissionEntity = BotAllowlist | BotBlocklist;

export type BotPermissionKind = 'allowlist' | 'blocklist';

export type BotOneBotEvent = Record<string, any> & {
  channel_id?: number | string;
  group_id?: number | string;
  guild_id?: number | string;
  message?: any;
  message_id?: number | string;
  message_type?: string;
  post_type?: string;
  raw_message?: string;
  self_id?: number | string;
  sender?: Record<string, any>;
  time?: number;
  user_id?: number | string;
};

export type BotNormalizedMessage = {
  channelId?: string;
  connectionMode?: BotConnectionMode;
  eventTime: Date;
  guildId?: string;
  groupId?: string;
  messageId: string;
  messageText: string;
  messageType: BotMessageType;
  adapterReplyContext?: unknown;
  rawEvent: BotOneBotEvent;
  rawMessage: string;
  replyMessageId?: string;
  selfId: string;
  senderNickname?: string;
  targetId: string;
  userId: string;
};

export type BotOneBotActionResponse = {
  data?: any;
  echo?: string;
  message?: string;
  retcode?: number;
  status?: string;
};

export type BotBusHandler = (payload: any) => Promise<void> | void;

export type BotLoginScanResult = {
  accountId?: string;
  captchaUrl?: string;
  containerId?: string;
  containerName?: string;
  deviceVerifyUrl?: string;
  errorMessage?: string;
  expiresAt?: number;
  mode: BotLoginScanMode;
  newDeviceQrcode?: string;
  newDeviceStatus?: BotLoginNewDeviceStatus;
  qrcode?: string;
  selfId?: string;
  sessionId?: string;
  status: BotLoginScanStatus;
  webuiPort?: null | number;
};

export type BotLoginScanEventStatus =
  | 'error'
  | 'info'
  | 'processing'
  | 'success';

export type BotLoginScanEvent = {
  createdAt: number;
  message: string;
  result?: BotLoginScanResult;
  status: BotLoginScanEventStatus;
  step: string;
};

export type BotLoginScanSession = {
  accountId?: string;
  captchaUrl?: string;
  containerId?: string;
  containerName?: string;
  createdAt: number;
  deviceVerifyUrl?: string;
  errorMessage?: string;
  expiresAt: number;
  expectedSelfId?: string;
  id: string;
  lastCaptchaLookupAt?: number;
  loginSelfIdMissingSince?: number;
  lastQrcodeRefreshAt?: number;
  lastRestartedAt?: number;
  loginPasswordAvailable?: boolean;
  mode: BotLoginScanMode;
  newDeviceBytesToken?: string;
  newDevicePullQrCodeSig?: unknown;
  newDeviceQrcode?: string;
  newDeviceStatus?: BotLoginNewDeviceStatus;
  onlineSourceWorkerRestartAttempted?: boolean;
  passwordMd5?: string;
  preparingContainer?: boolean;
  preparingRelogin?: boolean;
  qrcode?: string;
  runtimeRebuildCount?: number;
  sourceContainerOnline?: boolean;
  status: BotLoginScanStatus;
  webuiPort?: null | number;
};

export type BotLoginCaptchaSubmitInput = {
  randstr: string;
  sid?: string;
  ticket: string;
};

export type NapcatRuntime = {
  baseUrl: string;
  hasExistingPrimaryBinding?: boolean;
  id?: string;
  name: string;
  runtimeRebuildCount?: number;
  sourceContainerOnline?: boolean;
  webuiPort?: null | number;
  webuiToken?: null | string;
};

export type BotPendingAction = {
  reject: (reason: Error) => void;
  resolve: (value: BotOneBotActionResponse) => void;
  timer: NodeJS.Timeout;
};

export type BotReverseActionSender = {
  sendAction: (
    selfId: string,
    action: string,
    params: Record<string, any>,
  ) => Promise<BotOneBotActionResponse>;
};

export type QrcodeRefreshOptions = QrcodeLookupOptions & {
  fallbackStatus?: NapcatLoginStatus;
};
