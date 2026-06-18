import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ToolsService } from '@/common';
import type {
  QqbotAccountNapcatRuntimeActions,
  QqbotAccountNapcatRuntimePort,
} from '@/modules/qqbot/core/application/account/qqbot-account-napcat-runtime.port';
import { QqbotAccount } from '@/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';
import type {
  QqbotAccountListItem,
  QqbotNapcatRuntimeStatusSnapshot,
} from '@/modules/qqbot/core/contract/qqbot.types';
import { NapcatRuntimeProfileInspectorService } from '../runtime/napcat-runtime-profile-inspector.service';
import { QqbotNapcatContainerService } from '../../infrastructure/integration/container/qqbot-napcat-container.service';
import { NapcatAccountBinding } from '../../infrastructure/persistence/napcat-account-binding.entity';
import { NapcatContainer } from '../../infrastructure/persistence/napcat-container.entity';

const NAPCAT_RUNTIME_CHECK_TTL_MS = 30_000;
const NAPCAT_AUTO_LOGIN_CLEANUP_FAILED_MESSAGE =
  'NapCat 自动登录后运行态密码清理失败，请手动更新登录';

@Injectable()
export class QqbotNapcatAccountRuntimeService implements QqbotAccountNapcatRuntimePort {
  /**
   * Creates the account-list runtime adapter that joins persisted bindings, container status, and optional profile summaries.
   * @param accountNapcatRepository - Binding repository used to pick the primary NapCat container for each QQBot account.
   * @param napcatContainerRepository - Container repository used for cached Docker/WebUI status and non-secret metadata.
   * @param napcatContainerService - Runtime integration service for bounded NapCat/WebUI status probes and auto-login.
   * @param toolsService - Shared helpers for status text normalization and NapCat offline-message classification.
   * @param runtimeProfileInspector - Optional profile reader that enriches list rows without changing login state.
   */
  constructor(
    @InjectRepository(NapcatAccountBinding)
    private readonly accountNapcatRepository: Repository<NapcatAccountBinding>,
    @InjectRepository(NapcatContainer)
    private readonly napcatContainerRepository: Repository<NapcatContainer>,
    private readonly napcatContainerService: QqbotNapcatContainerService,
    private readonly toolsService: ToolsService,
    private readonly runtimeProfileInspector?: NapcatRuntimeProfileInspectorService,
  ) {}

  /**
   * 执行 NapCat 登录运行态流程。
   * @param accounts - 账号列表；使用 `length` 字段生成结果。
   * @param options - NapCat列表；驱动 `this.syncNapcatRuntimeState()` 的 NapCat步骤。
   * @param actions - NapCat列表；驱动 `this.syncNapcatRuntimeState()` 的 NapCat步骤。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
  async appendRuntime(
    accounts: QqbotAccount[],
    options: { autoLogin?: boolean },
    actions: QqbotAccountNapcatRuntimeActions,
  ): Promise<QqbotAccountListItem[]> {
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
          options,
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
   * 清理 NapCat 登录运行态状态。
   * @param accountId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  removeAccountContainers(accountId: string) {
    return this.napcatContainerService.removeAccountContainers(accountId);
  }

  /**
   * 更新 NapCat 登录运行态状态。
   * @param account - account 输入；使用 `connectStatus` 字段生成结果。
   * @param container - container 输入；使用 `status`、`lastCheckedAt` 字段生成结果。
   * @param options - NapCat列表；使用 `autoLogin` 字段生成结果。
   * @param actions - NapCat列表；驱动 `this.getNapcatRuntimeStatus()`、`this.applyNapcatOfflineState()` 的 NapCat步骤。
   */
  private async syncNapcatRuntimeState(
    account: QqbotAccount,
    container: NapcatContainer | undefined,
    options: { autoLogin?: boolean },
    actions: QqbotAccountNapcatRuntimeActions,
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
      if (
        options.autoLogin &&
        (await this.tryAutoLogin(account, container, actions))
      ) {
        return this.toCachedNapcatRuntimeStatus(container);
      }
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
      if (
        options.autoLogin &&
        (await this.tryAutoLogin(account, container, actions))
      ) {
        return this.toCachedNapcatRuntimeStatus(container);
      }
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

    if (
      options.autoLogin &&
      (await this.tryAutoLogin(account, container, actions))
    ) {
      return this.toCachedNapcatRuntimeStatus(container);
    }

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
    } as QqbotNapcatRuntimeStatusSnapshot;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param account - account 输入；驱动 `this.clearQqLoginErrorIfConfirmedOnline()` 的 NapCat步骤。
   * @param container - container 输入；使用 `status`、`lastCheckedAt`、`lastError` 字段生成结果。
   * @param actions - NapCat列表；驱动 `this.clearQqLoginErrorIfConfirmedOnline()` 的 NapCat步骤。
   * @returns NapCat 登录运行态查询结果。
   */
  private async getNapcatRuntimeStatus(
    account: QqbotAccount,
    container: NapcatContainer | undefined,
    actions: QqbotAccountNapcatRuntimeActions,
  ): Promise<QqbotNapcatRuntimeStatusSnapshot | undefined> {
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
   * 清理Qq Login Error If Confirmed Online。
   * @param account - account 输入；使用 `lastError`、`selfId` 字段生成结果。
   * @param runtimeStatus - NapCat列表；使用 `qqLoginStatus` 字段生成结果。
   * @param actions - NapCat列表；执行 `actions.clearQqLoginError()` 对应的 NapCat步骤。
   */
  private async clearQqLoginErrorIfConfirmedOnline(
    account: QqbotAccount,
    runtimeStatus: QqbotNapcatRuntimeStatusSnapshot,
    actions: QqbotAccountNapcatRuntimeActions,
  ) {
    if (runtimeStatus.qqLoginStatus !== 'online') return;
    const lastError = this.toolsService.toTrimmedString(account.lastError);
    if (!lastError || !this.isQqLoginStateError(lastError)) return;

    await actions.clearQqLoginError(account.selfId);
    account.lastError = null;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；使用 `status`、`lastError`、`lastCheckedAt` 字段生成结果。
   * @returns NapCat 登录运行态产出的 QqbotNapcatRuntimeStatusSnapshot。
   */
  private toCachedNapcatRuntimeStatus(
    container: NapcatContainer,
  ): QqbotNapcatRuntimeStatusSnapshot {
    const containerOnline = container.status === 'running';
    const lastError = this.toolsService.toTrimmedString(container.lastError);
    const offlineReason = this.toolsService.isNapcatOfflineLoginMessage(
      lastError,
    )
      ? lastError
      : null;
    return {
      checkedAt: container.lastCheckedAt || undefined,
      containerOnline,
      lastError: lastError || null,
      qqLoginMessage: offlineReason,
      qqLoginStatus: this.toCachedQqLoginStatus(containerOnline, lastError),
      webuiOnline: containerOnline ? null : false,
    };
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param containerOnline - containerOnline 输入；决定 NapCat条件分支。
   * @param lastError - lastError 输入；计算 NapCat布尔判断。
   * @returns NapCat 登录运行态产出的 QqbotNapcatRuntimeStatusSnapshot['qqLoginStatus']。
   */
  private toCachedQqLoginStatus(
    containerOnline: boolean,
    lastError: string,
  ): QqbotNapcatRuntimeStatusSnapshot['qqLoginStatus'] {
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
   * 判断 NapCat 登录运行态条件。
   * @param message - message 输入；计算 NapCat布尔判断。
   */
  private isQqLoginStateError(message: string) {
    return (
      this.toolsService.isNapcatOfflineLoginMessage(message) ||
      message.includes('二维码已过期') ||
      message.includes('二维码过期')
    );
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param runtimeStatus - NapCat列表；使用 `qqLoginStatus`、`qqLoginMessage`、`lastError` 字段生成结果。
   */
  private getRuntimeStatusOfflineReason(
    runtimeStatus?: QqbotNapcatRuntimeStatusSnapshot,
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
   * 执行 NapCat 登录运行态流程。
   * @param account - account 输入；使用 `selfId`、`clientRole`、`connectStatus`、`lastConnectedAt` 字段生成结果。
   * @param container - container 输入；驱动 `napcatContainerService.tryAutoLogin()`、`this.applyNapcatOfflineState()` 的 NapCat步骤。
   * @param actions - NapCat列表；执行 `actions.getLoginPassword()`、`actions.markOnline()` 对应的 NapCat步骤。
   */
  private async tryAutoLogin(
    account: QqbotAccount,
    container: NapcatContainer,
    actions: QqbotAccountNapcatRuntimeActions,
  ) {
    try {
      const result = await this.napcatContainerService.tryAutoLogin(container, {
        loginPassword: actions.getLoginPassword(account),
        selfId: account.selfId,
      });
      if (result.cleanupFailed) {
        await this.applyNapcatOfflineState(
          account,
          container,
          NAPCAT_AUTO_LOGIN_CLEANUP_FAILED_MESSAGE,
          actions,
        );
        return true;
      }
      if (!result.success) return false;

      await actions.markOnline(account.selfId, 'Universal', null);
      account.clientRole = 'Universal';
      account.connectStatus = 'online';
      account.lastConnectedAt = new Date() as any;
      account.lastError = null;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param account - account 输入；使用 `selfId`、`lastError` 字段生成结果。
   * @param container - container 输入；使用 `id`、`name` 字段生成结果。
   * @param offlineReason - offlineReason 输入；驱动 `actions.markQqLoginOffline()`、`actions.publishOfflineNotice()` 的 NapCat步骤。
   * @param actions - NapCat列表；执行 `actions.markQqLoginOffline()`、`actions.publishOfflineNotice()` 对应的 NapCat步骤。
   */
  private async applyNapcatOfflineState(
    account: QqbotAccount,
    container: NapcatContainer,
    offlineReason: string,
    actions: QqbotAccountNapcatRuntimeActions,
  ) {
    await actions.markQqLoginOffline(account.selfId, offlineReason);
    account.lastError = offlineReason;
    actions.publishOfflineNotice(account.selfId, offlineReason, {
      containerId: container.id,
      containerName: container.name,
    });
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param container - container 输入；使用 `lastCheckedAt`、`lastError` 字段生成结果。
   */
  private getFreshCachedOfflineReason(container: NapcatContainer) {
    if (!this.isFreshRuntimeCheck(container.lastCheckedAt)) return null;
    const reason = this.toolsService.toTrimmedString(container.lastError);
    return this.toolsService.isNapcatOfflineLoginMessage(reason)
      ? reason
      : null;
  }

  /**
   * 判断 NapCat 登录运行态条件。
   * @param account - account 输入；使用 `lastConnectedAt` 字段计算判断结果。
   * @param container - container 输入；使用 `lastCheckedAt` 字段计算判断结果。
   */
  private isRecentConnectNewerThanRuntimeCheck(
    account: QqbotAccount,
    container: NapcatContainer,
  ) {
    const checkedAt = this.toTime(container.lastCheckedAt);
    if (!checkedAt) return false;
    const connectedAt = this.toTime(account.lastConnectedAt);
    if (connectedAt <= checkedAt) return false;

    return Date.now() - connectedAt < NAPCAT_RUNTIME_CHECK_TTL_MS;
  }

  /**
   * 判断 NapCat 登录运行态条件。
   * @param lastCheckedAt - lastCheckedAt 输入；驱动 `this.toTime()` 的 NapCat步骤。
   */
  private isFreshRuntimeCheck(lastCheckedAt?: Date | null) {
    if (!lastCheckedAt) return false;
    const checkedAt = this.toTime(lastCheckedAt);
    if (!Number.isFinite(checkedAt)) return false;
    return Date.now() - checkedAt < NAPCAT_RUNTIME_CHECK_TTL_MS;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param value - 待转换时间值；构造时间对象。
   */
  private toTime(value?: Date | null) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }
}
