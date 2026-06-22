import type { QrcodeLookupOptions } from '@/common/types';
import type { QqbotAccount } from '../infrastructure/persistence/account/qqbot-account.entity';
import type { QqbotCommand } from '../infrastructure/persistence/command/qqbot-command.entity';
import type { QqbotAllowlist } from '../infrastructure/persistence/permission/qqbot-allowlist.entity';
import type { QqbotBlocklist } from '../infrastructure/persistence/permission/qqbot-blocklist.entity';

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
  waitForReady?: boolean;
};

export type QqbotConnectionMode = 'reverse-ws';

export type QqbotConnectionRole = 'API' | 'Event' | 'Universal';

export type QqbotConnectionStatus = 'offline' | 'online';

export type QqbotLoginScanMode = 'create' | 'refresh';

export type QqbotLoginScanStatus = 'error' | 'expired' | 'pending' | 'success';

export type QqbotLoginNewDeviceStatus =
  | 'confirming'
  | 'expired'
  | 'failed'
  | 'qr-pending'
  | 'scanned'
  | 'verified';

export type QqbotMessageDirection = 'inbound' | 'outbound';

export type QqbotMessageType = 'channel' | 'group' | 'private';

export type QqbotRuntimeContainerStatus =
  | 'creating'
  | 'error'
  | 'running'
  | 'stopped'
  | 'unknown';

export type QqbotNapcatContainerStatus = QqbotRuntimeContainerStatus;

export type QqbotAccountNapcatBindStatus = 'bound' | 'disabled' | 'pending';

export type QqbotNapcatWebuiStatus = 'offline' | 'online' | 'unknown';

export type QqbotNapcatRuntimeLoginStatus =
  | 'offline'
  | 'online'
  | 'qrcode_expired'
  | 'qrcode_pending'
  | 'unknown';

export type QqbotNapcatRuntimeStatusSnapshot = {
  checkedAt?: Date;
  containerOnline: boolean;
  lastError?: null | string;
  qqLoginMessage?: null | string;
  qqLoginStatus: QqbotNapcatRuntimeLoginStatus;
  webuiOnline?: boolean | null;
};

export type QqbotAccountAbilityType = 'command' | 'event_plugin' | 'rule';

export type QqbotAccountNapcatRuntimeInfo = {
  bindStatus?: QqbotAccountNapcatBindStatus;
  containerId?: string;
  containerName?: string;
  containerOnline?: boolean;
  containerStatus?: QqbotRuntimeContainerStatus;
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
  qqLoginStatus?: QqbotNapcatRuntimeLoginStatus;
  webuiOnline?: boolean | null;
  webuiPort?: null | number;
};

export type QqbotAccountListItem = QqbotAccount & {
  napcat?: null | QqbotAccountNapcatRuntimeInfo;
};

export type QqbotRuleMatchType = 'equals' | 'keyword' | 'regex';

export type QqbotRuleTargetType = 'all' | 'channel' | 'group' | 'private';

export type QqbotCommandParserType = 'ff14Price' | 'fflogsCharacter' | 'plain';

export type QqbotCommandLogStatus = 'failed' | 'success';

export type QqbotCommandMatchResult = {
  alias: string;
  input: Record<string, any>;
  matched: true;
  rawArgs: string;
};

export type QqbotPluginHealthStatus = 'degraded' | 'healthy' | 'offline';

export type QqbotPluginHealth = {
  checkedAt: string;
  message?: string;
  name?: string;
  pluginKey?: string;
  status: QqbotPluginHealthStatus;
  triggerMode?: QqbotPluginTriggerMode;
};

export type QqbotPluginTriggerMode = 'command' | 'event';

export type QqbotPluginOperationContext = {
  args?: Record<string, any>;
  command?: QqbotCommand;
  message?: QqbotNormalizedMessage;
};

export type QqbotPluginOperation<Input = any, Output = any> = {
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
    context: QqbotPluginOperationContext,
  ) => Promise<Output>;
};

export type QqbotIntegrationPlugin = {
  activate?: () => Promise<unknown> | unknown;
  description?: string;
  healthCheck?: () => Promise<QqbotPluginHealth>;
  key: string;
  legacyKeys?: string[];
  name: string;
  operations: QqbotPluginOperation[];
  version: string;
};

export type QqbotEventPluginSummary = {
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

export type QqbotEventPluginDefinition = {
  description?: string;
  key: string;
  name: string;
  remark?: string;
  triggerType: 'message';
  version: string;
};

export type QqbotPluginSummary = {
  description?: string;
  key: string;
  name: string;
  operationCount: number;
  triggerMode: QqbotPluginTriggerMode;
  version: string;
};

export type QqbotPluginOperationSummary = {
  aliases?: string[];
  cacheTtlMs?: number;
  description?: string;
  inputSchema?: Record<string, any>;
  key: string;
  name: string;
  outputSchema?: Record<string, any>;
  pluginKey: string;
  timeoutMs?: number;
  triggerMode: QqbotPluginTriggerMode;
};

export type QqbotSendStatus = 'failed' | 'pending' | 'success';

export type QqbotPermissionTargetType = 'channel' | 'group' | 'private' | 'qq';

export type QqbotPermissionConfig = {
  allowlistEnabled: boolean;
  blocklistEnabled: boolean;
};

export type QqbotPermissionEntity = QqbotAllowlist | QqbotBlocklist;

export type QqbotPermissionKind = 'allowlist' | 'blocklist';

export type QqbotOneBotEvent = Record<string, any> & {
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

export type QqbotNormalizedMessage = {
  channelId?: string;
  eventTime: Date;
  groupId?: string;
  messageId: string;
  messageText: string;
  messageType: QqbotMessageType;
  rawEvent: QqbotOneBotEvent;
  rawMessage: string;
  selfId: string;
  senderNickname?: string;
  targetId: string;
  userId: string;
};

export type QqbotOneBotActionResponse = {
  data?: any;
  echo?: string;
  message?: string;
  retcode?: number;
  status?: string;
};

export type QqbotBusHandler = (payload: any) => Promise<void> | void;

export type QqbotLoginScanResult = {
  accountId?: string;
  captchaUrl?: string;
  containerId?: string;
  containerName?: string;
  deviceVerifyUrl?: string;
  errorMessage?: string;
  expiresAt?: number;
  mode: QqbotLoginScanMode;
  newDeviceQrcode?: string;
  newDeviceStatus?: QqbotLoginNewDeviceStatus;
  qrcode?: string;
  selfId?: string;
  sessionId?: string;
  status: QqbotLoginScanStatus;
  webuiPort?: null | number;
};

export type QqbotLoginScanEventStatus =
  | 'error'
  | 'info'
  | 'processing'
  | 'success';

export type QqbotLoginScanEvent = {
  createdAt: number;
  message: string;
  result?: QqbotLoginScanResult;
  status: QqbotLoginScanEventStatus;
  step: string;
};

export type QqbotLoginScanSession = {
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
  lastRestartedAt?: number;
  mode: QqbotLoginScanMode;
  newDeviceBytesToken?: string;
  newDevicePullQrCodeSig?: unknown;
  newDeviceQrcode?: string;
  newDeviceStatus?: QqbotLoginNewDeviceStatus;
  passwordMd5?: string;
  preparingContainer?: boolean;
  preparingRelogin?: boolean;
  qrcode?: string;
  runtimeRebuildCount?: number;
  sourceContainerOnline?: boolean;
  status: QqbotLoginScanStatus;
  webuiPort?: null | number;
};

export type QqbotLoginCaptchaSubmitInput = {
  randstr: string;
  sid?: string;
  ticket: string;
};

export type QqbotNapcatRuntime = {
  baseUrl: string;
  /** Heuristic for quick login: existing primary binding implies a reusable data volume may exist. */
  hasExistingPrimaryBinding?: boolean;
  id?: string;
  name: string;
  runtimeRebuildCount?: number;
  sourceContainerOnline?: boolean;
  webuiPort?: null | number;
  webuiToken?: null | string;
};

export type QqbotPendingAction = {
  reject: (reason: Error) => void;
  resolve: (value: QqbotOneBotActionResponse) => void;
  timer: NodeJS.Timeout;
};

export type QqbotReverseActionSender = {
  sendAction: (
    selfId: string,
    action: string,
    params: Record<string, any>,
  ) => Promise<QqbotOneBotActionResponse>;
};

export type QrcodeRefreshOptions = QrcodeLookupOptions & {
  fallbackStatus?: NapcatLoginStatus;
};
