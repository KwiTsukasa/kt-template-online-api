import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ToolsService } from '@/common';
import type {
  BotAccountNapcatRuntimeActions,
  BotAccountNapcatRuntimePort,
} from '@/modules/bot-adapter/core/application/account/bot-account-napcat-runtime.port';
import { BotAccount } from '@/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity';
import type {
  BotAccountListItem,
  NapcatRuntimeStatusSnapshot,
} from '@/modules/bot-adapter/core/contract/bot.types';
import { NapcatRuntimeProfileInspectorService } from '../runtime/napcat-runtime-profile-inspector.service';
import { NapcatContainerService } from '../../infrastructure/integration/container/napcat-container.service';
import { NapcatAccountBinding } from '../../infrastructure/persistence/napcat-account-binding.entity';
import { NapcatContainer } from '../../infrastructure/persistence/napcat-container.entity';

const NAPCAT_RUNTIME_CHECK_TTL_MS = 30_000;

@Injectable()
export class NapcatAccountRuntimeService implements BotAccountNapcatRuntimePort {
  constructor(
    @InjectRepository(NapcatAccountBinding)
    private readonly accountNapcatRepository: Repository<NapcatAccountBinding>,
    @InjectRepository(NapcatContainer)
    private readonly napcatContainerRepository: Repository<NapcatContainer>,
    private readonly napcatContainerService: NapcatContainerService,
    private readonly toolsService: ToolsService,
    private readonly runtimeProfileInspector?: NapcatRuntimeProfileInspectorService,
  ) {}

  /**
   * 根据`accounts`、`actions`更新运行态；把变更持久化到当前存储（`accountNapcatRepository.createQueryBuilder`）。
   * @param accounts - 用于运行态的领域对象，包含 `length` 字段。
   * @param actions - 决定运行态内容、边界或目标的 `actions` 值。
   * @returns 按输入顺序得到的运行态列表；没有匹配项时为空数组。
   */
  async appendRuntime(
    accounts: BotAccount[],
    actions: BotAccountNapcatRuntimeActions,
  ): Promise<BotAccountListItem[]> {
    if (accounts.length <= 0) return [];

    const accountIds = accounts.map((account) => account.id);
    const bindings = await this.accountNapcatRepository
      .createQueryBuilder('binding')
      .where('binding.accountId IN (:...accountIds)', { accountIds })
      .andWhere('binding.isDeleted = :isDeleted', { isDeleted: false })
      .orderBy('binding.isPrimary', 'DESC')
      .addOrderBy('binding.updateTime', 'DESC')
      .getMany();
    const bindingMap = new Map<string, NapcatAccountBinding>();
    for (const binding of bindings) {
      if (!bindingMap.has(binding.accountId)) {
        bindingMap.set(binding.accountId, binding);
      }
    }

    const containerIds = Array.from(
      new Set(bindings.map((binding) => binding.containerId).filter(Boolean)),
    );
    const containerMap = new Map<string, NapcatContainer>();
    if (containerIds.length > 0) {
      const containerBuilder =
        this.napcatContainerRepository.createQueryBuilder('container');
      containerBuilder.addSelect?.('container.webuiToken');
      const containers = await containerBuilder
        .where('container.id IN (:...containerIds)', { containerIds })
        .andWhere('container.isDeleted = :isDeleted', { isDeleted: false })
        .getMany();
      for (const container of containers) {
        containerMap.set(container.id, container);
      }
    }
    const runtimeProfileSummaryMap =
      (await this.runtimeProfileInspector?.getAccountRuntimeSummaryMap(
        accountIds,
      )) || new Map();

    return Promise.all(
      accounts.map(async (account) => {
        const binding = bindingMap.get(account.id);
        if (!binding) {
          return Object.assign(account, { napcat: null });
        }

        const container = containerMap.get(binding.containerId);
        const runtimeStatus = await this.syncNapcatRuntimeState(
          account,
          container,
          actions,
        );
        return Object.assign(account, {
          napcat: {
            bindStatus: binding.bindStatus,
            containerId: binding.containerId,
            containerName: container?.name,
            containerOnline:
              runtimeStatus?.containerOnline ??
              (container?.status === 'running' || false),
            containerStatus: container?.status,
            lastCheckedAt: runtimeStatus?.checkedAt || container?.lastCheckedAt,
            lastError: runtimeStatus?.lastError ?? container?.lastError,
            lastLoginAt: binding.lastLoginAt,
            lastStartedAt: container?.lastStartedAt,
            oneBotOnline: account.connectStatus === 'online',
            qqLoginMessage: runtimeStatus?.qqLoginMessage,
            qqLoginStatus: runtimeStatus?.qqLoginStatus,
            ...runtimeProfileSummaryMap.get(account.id),
            webuiOnline: runtimeStatus?.webuiOnline,
            webuiPort: container?.webuiPort,
          },
        });
      }),
    );
  }

  /**
   * 按账号标识移除其全部 NapCat 容器，并采用容器服务的清理结果。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 账号Containers。
   */
  removeAccountContainers(accountId: string) {
    return this.napcatContainerService.removeAccountContainers(accountId);
  }

  /**
   * 根据`account`、`container`、`actions`处理NapCat运行态状态；当 `this.isRecentConnectNewerThanRuntimeCheck(account, container)` 成立时返回 `runtimeStatus`。
   * @param account - 用于NapCat运行态状态的领域对象，包含 `connectStatus` 字段。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param actions - 决定NapCat运行态状态内容、边界或目标的 `actions` 值。
   * @returns 包含 `checkedAt`、`lastError`、`qqLoginMessage`、`qqLoginStatus` 字段的NapCat运行态状态。
   */
  private async syncNapcatRuntimeState(
    account: BotAccount,
    container: NapcatContainer | undefined,
    actions: BotAccountNapcatRuntimeActions,
  ) {
    const runtimeStatus = await this.getNapcatRuntimeStatus(
      account,
      container,
      actions,
    );
    if (!container || container.status !== 'running') return runtimeStatus;
    if (account.connectStatus !== 'online') return runtimeStatus;

    if (this.isRecentConnectNewerThanRuntimeCheck(account, container)) {
      return runtimeStatus;
    }

    const runtimeOfflineReason =
      this.getRuntimeStatusOfflineReason(runtimeStatus);
    if (runtimeOfflineReason) {
      await this.applyNapcatOfflineState(
        account,
        container,
        runtimeOfflineReason,
        actions,
      );
      return runtimeStatus;
    }

    const cachedOfflineReason = this.getFreshCachedOfflineReason(container);
    if (cachedOfflineReason) {
      await this.applyNapcatOfflineState(
        account,
        container,
        cachedOfflineReason,
        actions,
      );
      return runtimeStatus;
    }
    if (this.isFreshRuntimeCheck(container.lastCheckedAt)) {
      return runtimeStatus;
    }

    const offlineReason =
      await this.napcatContainerService.detectRuntimeOffline(container);
    if (!offlineReason) return runtimeStatus;

    await this.applyNapcatOfflineState(
      account,
      container,
      offlineReason,
      actions,
    );
    return {
      ...runtimeStatus,
      checkedAt: new Date(),
      lastError: offlineReason,
      qqLoginMessage: offlineReason,
      qqLoginStatus: 'offline',
    } as NapcatRuntimeStatusSnapshot;
  }

  /**
   * 按`account`、`container`、`actions`读取NapCat运行态状态；当 `this.isRecentConnectNewerThanRuntimeCheck(account, container)` 成立时返回 `cached`。
   * @param account - 决定NapCat运行态状态内容、边界或目标的 `account` 值。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param actions - 决定NapCat运行态状态内容、边界或目标的 `actions` 值。
   * @returns NapCat运行态状态；没有可用结果或提前结束时为 `undefined`。
   */
  private async getNapcatRuntimeStatus(
    account: BotAccount,
    container: NapcatContainer | undefined,
    actions: BotAccountNapcatRuntimeActions,
  ): Promise<NapcatRuntimeStatusSnapshot | undefined> {
    if (!container) return undefined;
    const cached = this.toCachedNapcatRuntimeStatus(container);
    if (container.status !== 'running') return cached;
    if (this.isRecentConnectNewerThanRuntimeCheck(account, container)) {
      return cached;
    }
    if (this.isFreshRuntimeCheck(container.lastCheckedAt)) return cached;
    if (
      typeof this.napcatContainerService.inspectRuntimeStatus !== 'function'
    ) {
      return cached;
    }

    const inspected =
      await this.napcatContainerService.inspectRuntimeStatus(container);
    container.lastCheckedAt = inspected.checkedAt as any;
    container.lastError = inspected.lastError || null;
    await this.clearQqLoginErrorIfConfirmedOnline(account, inspected, actions);
    return inspected;
  }

  /**
   * 仅在运行态确认 QQ 已在线且旧错误属于登录状态错误时清除账号错误，并同步更新内存实体。
   * @param account - 用于QqLogin错误IfConfirmedOnline的领域对象，包含 `lastError`、`selfId` 字段。
   * @param runtimeStatus - 用于QqLogin错误IfConfirmedOnline的领域对象，包含 `qqLoginStatus` 字段。
   * @param actions - 用于QqLogin错误IfConfirmedOnline的领域对象，包含 `clearQqLoginError` 字段。
   */
  private async clearQqLoginErrorIfConfirmedOnline(
    account: BotAccount,
    runtimeStatus: NapcatRuntimeStatusSnapshot,
    actions: BotAccountNapcatRuntimeActions,
  ) {
    if (runtimeStatus.qqLoginStatus !== 'online') return;
    const lastError = this.toolsService.toTrimmedString(account.lastError);
    if (!lastError || !this.isQqLoginStateError(lastError)) return;

    await actions.clearQqLoginError(account.selfId);
    account.lastError = null;
  }

  /**
   * 将`container`转换为缓存会话NapCat运行态状态。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 包含 `checkedAt`、`containerOnline`、`lastError`、`qqLoginMessage`、`qqLoginStatus` 字段的缓存会话NapCat运行态状态；没有可用结果或提前结束时为 `undefined`。
   */
  private toCachedNapcatRuntimeStatus(
    container: NapcatContainer,
  ): NapcatRuntimeStatusSnapshot {
    const containerOnline = container.status === 'running';
    const lastError = this.toolsService.toTrimmedString(container.lastError);
    const offlineReason = (() => {
      if (this.toolsService.isNapcatOfflineLoginMessage(
      lastError,
    )) {
        return lastError;
      }
      return null;
    })();
    return {
      checkedAt: container.lastCheckedAt || undefined,
      containerOnline,
      lastError: lastError || null,
      qqLoginMessage: offlineReason,
      qqLoginStatus: this.toCachedQqLoginStatus(containerOnline, lastError),
      webuiOnline: (() => {
        if (containerOnline) {
          return null;
        }
        return false;
      })(),
    };
  }

  /**
   * 将`containerOnline`、`lastError`转换为缓存会话QqLogin状态；当 `lastError.includes('二维码已过期') || lastError.includes('二维码过期')` 成立时返回 `'qrcode_expired'`。
   * @param containerOnline - 决定缓存会话QqLogin状态内容、边界或目标的 `containerOnline` 值。
   * @param lastError - 决定缓存会话QqLogin状态内容、边界或目标的 `lastError` 值。
   * @returns 当前状态对应的缓存会话QqLogin状态，取值为 `'offline'`、`'qrcode_expired'`、`'unknown'`。
   */
  private toCachedQqLoginStatus(
    containerOnline: boolean,
    lastError: string,
  ): NapcatRuntimeStatusSnapshot['qqLoginStatus'] {
    if (!containerOnline) return 'offline';
    if (
      lastError.includes('二维码已过期') ||
      lastError.includes('二维码过期')
    ) {
      return 'qrcode_expired';
    }
    if (this.toolsService.isNapcatOfflineLoginMessage(lastError)) {
      return 'offline';
    }
    return 'unknown';
  }

  /**
   * 通过 `toolsService.isNapcatOfflineLoginMessage` 判断输入是否满足函数约束。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 满足QqLogin状态错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isQqLoginStateError(message: string) {
    return (
      this.toolsService.isNapcatOfflineLoginMessage(message) ||
      message.includes('二维码已过期') ||
      message.includes('二维码过期')
    );
  }

  /**
   * 按`runtimeStatus`读取运行态状态OfflineReason；当 `runtimeStatus.qqLoginStatus !== 'offline' && runtimeStatus.qq…` 成立时返回 `null`。
   * @param runtimeStatus - 用于运行态状态OfflineReason的领域对象，包含 `qqLoginStatus`、`qqLoginMessage`、`lastError` 字段；为空时采用 `'NapCat QQ 登录态不可用'` 作为兜底。
   * @returns 规范化后的运行态状态OfflineReason；主值为空时采用 `'NapCat QQ 登录态不可用'` 兜底；无法解析或未命中时为 `null`。
   */
  private getRuntimeStatusOfflineReason(
    runtimeStatus?: NapcatRuntimeStatusSnapshot,
  ) {
    if (!runtimeStatus) return null;
    if (
      runtimeStatus.qqLoginStatus !== 'offline' &&
      runtimeStatus.qqLoginStatus !== 'qrcode_expired'
    ) {
      return null;
    }
    return (
      this.toolsService.toTrimmedString(runtimeStatus.qqLoginMessage) ||
      this.toolsService.toTrimmedString(runtimeStatus.lastError) ||
      'NapCat QQ 登录态不可用'
    );
  }

  /**
   * 通过 `actions.publishOfflineNotice` 发布领域状态，同时更新 `account.lastError` 状态。
   * @param account - 用于NapCatOffline状态的领域对象，包含 `selfId`、`lastError` 字段。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param offlineReason - 决定NapCatOffline状态内容、边界或目标的 `offlineReason` 值。
   * @param actions - 用于NapCatOffline状态的领域对象，包含 `markQqLoginOffline`、`publishOfflineNotice` 字段。
   */
  private async applyNapcatOfflineState(
    account: BotAccount,
    container: NapcatContainer,
    offlineReason: string,
    actions: BotAccountNapcatRuntimeActions,
  ) {
    await actions.markQqLoginOffline(account.selfId, offlineReason);
    account.lastError = offlineReason;
    actions.publishOfflineNotice(account.selfId, offlineReason, {
      containerId: container.id,
      containerName: container.name,
    });
  }

  /**
   * 通过 `isFreshRuntimeCheck` 判断输入是否满足函数约束。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 有效缓存会话OfflineReason；无法解析或未命中时为 `null`。
   */
  private getFreshCachedOfflineReason(container: NapcatContainer) {
    if (!this.isFreshRuntimeCheck(container.lastCheckedAt)) return null;
    const reason = this.toolsService.toTrimmedString(container.lastError);
    if (this.toolsService.isNapcatOfflineLoginMessage(reason)) {
      return reason;
    }
    return null;
  }

  /**
   * 仅当账号最近连接晚于容器检查，且连接时间仍在运行态 TTL 内时返回 `true`。
   * @param account - 用于仅当账号最近连接晚于容器检查，且连接时间仍在运行态 TTL 内时返回 `true`的领域对象，包含 `lastConnectedAt` 字段。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 满足最近日志ConnectNewerThan运行态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isRecentConnectNewerThanRuntimeCheck(
    account: BotAccount,
    container: NapcatContainer,
  ) {
    const checkedAt = this.toTime(container.lastCheckedAt);
    if (!checkedAt) return false;
    const connectedAt = this.toTime(account.lastConnectedAt);
    if (connectedAt <= checkedAt) return false;

    return Date.now() - connectedAt < NAPCAT_RUNTIME_CHECK_TTL_MS;
  }

  /**
   * 仅当运行态检查时间有效且距今未超过固定 TTL 时返回 `true`。
   * @param lastCheckedAt - 用于过期、排序或租约判定的时间基准；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足仅当运行态检查时间有效且距今未超过固定 TTL 时返回 `true`约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isFreshRuntimeCheck(lastCheckedAt?: Date | null) {
    if (!lastCheckedAt) return false;
    const checkedAt = this.toTime(lastCheckedAt);
    if (!Number.isFinite(checkedAt)) return false;
    return Date.now() - checkedAt < NAPCAT_RUNTIME_CHECK_TTL_MS;
  }

  /**
   * 将`value`转换为时间；当 `Number.isFinite(time)` 成立时返回 `time`。
   * @param value - 待转换为时间的原始值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的时间，取值为 `0`。
   */
  private toTime(value?: Date | null) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) {
      return time;
    }
    return 0;
  }
}
