import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SYSTEM_NOTICE_PUBLISHER,
  SystemNoticePublisher,
  throwVbenError,
  ToolsService,
} from '@/common';
import { AdminPasswordCryptoService } from '@/modules/admin/identity/auth/admin-password-crypto.service';
import { QqbotAccountAbility } from './qqbot-account-ability.entity';
import { QqbotAccount } from './qqbot-account.entity';
import type {
  QqbotAccountBodyDto,
  QqbotAccountQueryDto,
  QqbotAccountUpdateDto,
} from './qqbot-account.dto';
import { QqbotAccountNapcat } from '../../napcat/infrastructure/persistence/qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from '../../napcat/infrastructure/persistence/qqbot-napcat-container.entity';
import { QqbotNapcatContainerService } from '../../napcat/qqbot-napcat-container.service';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../contract/qqbot.constants';
import type {
  QqbotAccountAbilityType,
  QqbotAccountListItem,
  QqbotConnectionRole,
  QqbotNapcatRuntimeStatusSnapshot,
} from '../contract/qqbot.types';

const NAPCAT_RUNTIME_CHECK_TTL_MS = 30_000;
const NAPCAT_AUTO_LOGIN_CLEANUP_FAILED_MESSAGE =
  'NapCat 自动登录后运行态密码清理失败，请手动更新登录';
const INSECURE_ACCOUNT_SECRET_VALUES = new Set([
  'change-me',
  'kt-template-online-admin-token-secret',
]);

@Injectable()
export class QqbotAccountService {
  constructor(
    @InjectRepository(QqbotAccount)
    private readonly accountRepository: Repository<QqbotAccount>,
    @InjectRepository(QqbotAccountAbility)
    private readonly accountAbilityRepository: Repository<QqbotAccountAbility>,
    @InjectRepository(QqbotAccountNapcat)
    private readonly accountNapcatRepository: Repository<QqbotAccountNapcat>,
    @InjectRepository(QqbotNapcatContainer)
    private readonly napcatContainerRepository: Repository<QqbotNapcatContainer>,
    private readonly napcatContainerService: QqbotNapcatContainerService,
    private readonly toolsService: ToolsService,
    @Optional()
    @Inject(SYSTEM_NOTICE_PUBLISHER)
    private readonly systemNoticePublisher?: SystemNoticePublisher,
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    private readonly passwordCryptoService?: AdminPasswordCryptoService,
  ) {}

  async page(query: QqbotAccountQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      QQBOT_DEFAULT_PAGE_NO,
      QQBOT_DEFAULT_PAGE_SIZE,
    );
    const builder = this.accountRepository
      .createQueryBuilder('account')
      .where('account.isDeleted = :isDeleted', { isDeleted: false });

    if (query.selfId) {
      builder.andWhere('account.selfId LIKE :selfId', {
        selfId: `%${query.selfId}%`,
      });
    }
    if (query.name) {
      builder.andWhere('account.name LIKE :name', { name: `%${query.name}%` });
    }
    if (query.connectStatus) {
      builder.andWhere('account.connectStatus = :connectStatus', {
        connectStatus: query.connectStatus,
      });
    }

    const [accounts, total] = await builder
      .orderBy('account.createTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
    const list = await this.appendNapcatRuntime(accounts);
    return { list, pageNo, pageSize, total };
  }

  async allEnabled() {
    return this.accountRepository.find({
      order: {
        createTime: 'ASC',
      },
      where: {
        enabled: true,
        isDeleted: false,
      },
    });
  }

  async getBoundCommandIds(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'command');
  }

  async getBoundRuleIds(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'rule');
  }

  async getBoundEventPluginKeys(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'event_plugin');
  }

  async bindCommand(selfId: string, commandId: string) {
    return this.bindAbility(selfId, commandId, 'command');
  }

  async bindRule(selfId: string, ruleId: string) {
    return this.bindAbility(selfId, ruleId, 'rule');
  }

  async bindEventPlugin(selfId: string, pluginKey: string) {
    return this.bindAbility(selfId, pluginKey, 'event_plugin');
  }

  async unbindCommand(selfId: string, commandId: string) {
    return this.unbindAbility(selfId, commandId, 'command');
  }

  async unbindRule(selfId: string, ruleId: string) {
    return this.unbindAbility(selfId, ruleId, 'rule');
  }

  async unbindEventPlugin(selfId: string, pluginKey: string) {
    return this.unbindAbility(selfId, pluginKey, 'event_plugin');
  }

  async getDefaultAccount(selfId?: string) {
    if (selfId) {
      const account = await this.accountRepository.findOne({
        where: { enabled: true, isDeleted: false, selfId },
      });
      if (account) return account;
    }

    return this.accountRepository.findOne({
      order: {
        createTime: 'ASC',
      },
      where: {
        enabled: true,
        isDeleted: false,
      },
    });
  }

  async findEnabledBySelfIdWithToken(selfId: string) {
    return this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.accessToken')
      .where('account.selfId = :selfId', { selfId })
      .andWhere('account.enabled = :enabled', { enabled: true })
      .andWhere('account.isDeleted = :isDeleted', { isDeleted: false })
      .getOne();
  }

  async findById(id: string) {
    return this.accountRepository.findOne({
      where: {
        id,
        isDeleted: false,
      },
    });
  }

  async findByIdWithNapcatLoginSecret(id: string) {
    return this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.napcatLoginPasswordSecret')
      .where('account.id = :id', { id })
      .andWhere('account.isDeleted = :isDeleted', { isDeleted: false })
      .getOne();
  }

  async findBySelfId(selfId: string) {
    return this.accountRepository.findOne({
      where: {
        isDeleted: false,
        selfId,
      },
    });
  }

  async ensureScannedAccount(input: {
    accountId?: string;
    name?: string;
    selfId: string;
  }) {
    const selfId = `${input.selfId || ''}`.trim();
    if (!selfId) {
      throwVbenError('NapCat 未返回 QQ 账号');
    }

    const existing = input.accountId
      ? await this.accountRepository.findOne({ where: { id: input.accountId } })
      : await this.accountRepository.findOne({ where: { selfId } });
    const payload: Partial<QqbotAccount> = {
      accessToken: null,
      clientRole: null,
      connectStatus: 'offline',
      connectionMode: 'reverse-ws',
      enabled: true,
      isDeleted: false,
      lastError: null,
      name: input.name || existing?.name || `QQ ${selfId}`,
      selfId,
    };

    if (existing) {
      await this.accountRepository.update({ id: existing.id }, payload);
      await this.accountAbilityRepository.update(
        { accountId: existing.id },
        { selfId },
      );
      return existing.id;
    }

    const saved = await this.accountRepository.save(
      this.accountRepository.create({
        ...payload,
        remark: '',
      }),
    );
    return saved.id;
  }

  async ensureRuntimeAccount(selfId: string) {
    const normalizedSelfId = `${selfId || ''}`.trim();
    if (!normalizedSelfId) return;

    const existing = await this.accountRepository.findOne({
      where: {
        selfId: normalizedSelfId,
      },
    });
    if (existing && !existing.isDeleted) return;

    if (existing) {
      await this.accountRepository.update(
        { id: existing.id },
        {
          connectStatus: 'offline',
          enabled: true,
          isDeleted: false,
          lastError: null,
          name: existing.name || `QQ ${normalizedSelfId}`,
        },
      );
      return;
    }

    await this.accountRepository.save(
      this.accountRepository.create({
        connectionMode: 'reverse-ws',
        connectStatus: 'offline',
        enabled: true,
        name: `QQ ${normalizedSelfId}`,
        remark: '',
        selfId: normalizedSelfId,
      }),
    );
  }

  async save(body: QqbotAccountBodyDto) {
    const payload = this.normalizeBody(body);
    const restored = await this.restoreDeletedAccount(payload);
    if (restored) return restored.id;

    await this.assertSelfIdAvailable(payload.selfId || '');
    const account = this.accountRepository.create(payload);
    const saved = await this.accountRepository.save(account);
    return saved.id;
  }

  async update(body: QqbotAccountUpdateDto) {
    if (body.selfId) {
      await this.assertSelfIdAvailable(body.selfId, body.id);
    }
    const payload = this.normalizeBody(body);
    delete (payload as any).id;
    if (!body.accessToken) {
      delete payload.accessToken;
    }
    await this.accountRepository.update({ id: body.id }, payload);
    if (payload.selfId) {
      await this.accountAbilityRepository.update(
        { accountId: body.id },
        { selfId: payload.selfId },
      );
    }
    return true;
  }

  async remove(id: string) {
    const account = await this.accountRepository.findOne({
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!account) {
      throwVbenError('QQBot 账号不存在或已删除');
    }

    const containerResult =
      await this.napcatContainerService.removeAccountContainers(id);
    await this.accountRepository.update(
      { id },
      {
        connectStatus: 'offline',
        enabled: false,
        isDeleted: true,
      },
    );
    await this.accountAbilityRepository.update(
      { accountId: id },
      { isDeleted: true },
    );
    return {
      deletedContainers: containerResult.deletedContainers,
    };
  }

  async markOnline(
    selfId: string,
    clientRole: QqbotConnectionRole,
    lastError?: null | string,
  ) {
    const payload: Partial<QqbotAccount> = {
      clientRole,
      connectStatus: 'online',
      lastConnectedAt: new Date(),
    };
    if (lastError !== undefined) {
      payload.lastError = lastError
        ? this.toolsService.toColumnText(lastError, 500)
        : null;
    }
    await this.accountRepository.update(
      { selfId },
      payload,
    );
  }

  async markHeartbeat(selfId: string) {
    await this.accountRepository.update(
      { selfId },
      {
        connectStatus: 'online',
        lastHeartbeatAt: new Date(),
      },
    );
  }

  /**
   * 看门狗：主动巡检在线的已绑定账号，复用既有离线检测 + 站内信告警逻辑，
   * 让掉线/被踢能被及时发现并通知超管，而不必等管理员打开账号列表页。
   * 检测到离线后先尝试快速登录，再尝试密码登录；扫码登录仍只由管理员手动触发。
   */
  async runOfflineWatchdog(): Promise<{ checked: number }> {
    const accounts = await this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.napcatLoginPasswordSecret')
      .where('account.connectStatus = :connectStatus', {
        connectStatus: 'online',
      })
      .andWhere('account.enabled = :enabled', { enabled: true })
      .andWhere('account.isDeleted = :isDeleted', { isDeleted: false })
      .getMany();
    if (accounts.length <= 0) return { checked: 0 };

    await this.appendNapcatRuntime(accounts, { autoLogin: true });
    return { checked: accounts.length };
  }

  async markOffline(selfId: string, lastError?: string) {
    const payload: Partial<QqbotAccount> = {
      connectStatus: 'offline',
    };
    if (lastError !== undefined) {
      payload.lastError = lastError
        ? this.toolsService.toColumnText(lastError, 500)
        : null;
    }
    await this.accountRepository.update({ selfId }, payload);
  }

  async markQqLoginOffline(selfId: string, lastError: string) {
    await this.accountRepository.update(
      { selfId },
      {
        lastError: this.toolsService.toColumnText(lastError, 500),
      },
    );
  }

  getNapcatLoginPassword(
    account?: Pick<QqbotAccount, 'napcatLoginPasswordSecret'> | null,
  ) {
    const secret = this.toolsService.toTrimmedString(
      account?.napcatLoginPasswordSecret,
    );
    if (!secret) return '';
    return this.toolsService.decryptSecretText(
      secret,
      this.getAccountSecretKey(),
    );
  }

  private async appendNapcatRuntime(
    accounts: QqbotAccount[],
    options: { autoLogin?: boolean } = {},
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
    const bindingMap = new Map<string, QqbotAccountNapcat>();
    for (const binding of bindings) {
      if (!bindingMap.has(binding.accountId)) {
        bindingMap.set(binding.accountId, binding);
      }
    }

    const containerIds = Array.from(
      new Set(bindings.map((binding) => binding.containerId).filter(Boolean)),
    );
    const containerMap = new Map<string, QqbotNapcatContainer>();
    if (containerIds.length > 0) {
      const containerBuilder = this.napcatContainerRepository
        .createQueryBuilder('container');
      containerBuilder.addSelect?.('container.webuiToken');
      const containers = await containerBuilder
        .where('container.id IN (:...containerIds)', { containerIds })
        .andWhere('container.isDeleted = :isDeleted', { isDeleted: false })
        .getMany();
      for (const container of containers) {
        containerMap.set(container.id, container);
      }
    }

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
            webuiOnline: runtimeStatus?.webuiOnline,
            webuiPort: container?.webuiPort,
          },
        });
      }),
    );
  }

  private async syncNapcatRuntimeState(
    account: QqbotAccount,
    container?: QqbotNapcatContainer,
    options: { autoLogin?: boolean } = {},
  ) {
    const runtimeStatus = await this.getNapcatRuntimeStatus(account, container);
    if (!container || container.status !== 'running') return runtimeStatus;
    if (account.connectStatus !== 'online') return runtimeStatus;

    if (this.isRecentConnectNewerThanRuntimeCheck(account, container)) {
      return runtimeStatus;
    }

    const runtimeOfflineReason =
      this.getRuntimeStatusOfflineReason(runtimeStatus);
    if (runtimeOfflineReason) {
      if (options.autoLogin && (await this.tryAutoLogin(account, container))) {
        return this.toCachedNapcatRuntimeStatus(container);
      }
      await this.applyNapcatOfflineState(
        account,
        container,
        runtimeOfflineReason,
      );
      return runtimeStatus;
    }

    const cachedOfflineReason = this.getFreshCachedOfflineReason(container);
    if (cachedOfflineReason) {
      if (options.autoLogin && (await this.tryAutoLogin(account, container))) {
        return this.toCachedNapcatRuntimeStatus(container);
      }
      await this.applyNapcatOfflineState(
        account,
        container,
        cachedOfflineReason,
      );
      return runtimeStatus;
    }
    if (this.isFreshRuntimeCheck(container.lastCheckedAt)) {
      return runtimeStatus;
    }

    const offlineReason =
      await this.napcatContainerService.detectRuntimeOffline(container);
    if (!offlineReason) return runtimeStatus;

    if (options.autoLogin && (await this.tryAutoLogin(account, container))) {
      return this.toCachedNapcatRuntimeStatus(container);
    }

    await this.applyNapcatOfflineState(account, container, offlineReason);
    return {
      ...runtimeStatus,
      checkedAt: new Date(),
      lastError: offlineReason,
      qqLoginMessage: offlineReason,
      qqLoginStatus: 'offline',
    } as QqbotNapcatRuntimeStatusSnapshot;
  }

  private async getNapcatRuntimeStatus(
    account: QqbotAccount,
    container?: QqbotNapcatContainer,
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
    await this.clearQqLoginErrorIfConfirmedOnline(account, inspected);
    return inspected;
  }

  private async clearQqLoginErrorIfConfirmedOnline(
    account: QqbotAccount,
    runtimeStatus: QqbotNapcatRuntimeStatusSnapshot,
  ) {
    if (runtimeStatus.qqLoginStatus !== 'online') return;
    const lastError = this.toolsService.toTrimmedString(account.lastError);
    if (!lastError || !this.isQqLoginStateError(lastError)) return;

    await this.accountRepository.update(
      { selfId: account.selfId },
      { lastError: null },
    );
    account.lastError = null;
  }

  private toCachedNapcatRuntimeStatus(
    container: QqbotNapcatContainer,
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

  private isQqLoginStateError(message: string) {
    return (
      this.toolsService.isNapcatOfflineLoginMessage(message) ||
      message.includes('二维码已过期') ||
      message.includes('二维码过期')
    );
  }

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

  private async tryAutoLogin(
    account: QqbotAccount,
    container: QqbotNapcatContainer,
  ) {
    try {
      const result = await this.napcatContainerService.tryAutoLogin(container, {
        loginPassword: this.getNapcatLoginPassword(account),
        selfId: account.selfId,
      });
      if (result.cleanupFailed) {
        await this.applyNapcatOfflineState(
          account,
          container,
          NAPCAT_AUTO_LOGIN_CLEANUP_FAILED_MESSAGE,
        );
        return true;
      }
      if (!result.success) return false;

      await this.markOnline(account.selfId, 'Universal', null);
      account.clientRole = 'Universal';
      account.connectStatus = 'online';
      account.lastConnectedAt = new Date() as any;
      account.lastError = null;
      return true;
    } catch {
      return false;
    }
  }

  private async applyNapcatOfflineState(
    account: QqbotAccount,
    container: QqbotNapcatContainer,
    offlineReason: string,
  ) {
    await this.markQqLoginOffline(account.selfId, offlineReason);
    account.lastError = offlineReason;
    this.publishOfflineNotice(account.selfId, offlineReason, {
      containerId: container.id,
      containerName: container.name,
    });
  }

  private getFreshCachedOfflineReason(container: QqbotNapcatContainer) {
    if (!this.isFreshRuntimeCheck(container.lastCheckedAt)) return null;
    const reason = this.toolsService.toTrimmedString(container.lastError);
    return this.toolsService.isNapcatOfflineLoginMessage(reason)
      ? reason
      : null;
  }

  private isRecentConnectNewerThanRuntimeCheck(
    account: QqbotAccount,
    container: QqbotNapcatContainer,
  ) {
    const checkedAt = this.toTime(container.lastCheckedAt);
    if (!checkedAt) return false;
    const connectedAt = this.toTime(account.lastConnectedAt);
    if (connectedAt <= checkedAt) return false;

    return Date.now() - connectedAt < NAPCAT_RUNTIME_CHECK_TTL_MS;
  }

  private isFreshRuntimeCheck(lastCheckedAt?: Date | null) {
    if (!lastCheckedAt) return false;
    const checkedAt = this.toTime(lastCheckedAt);
    if (!Number.isFinite(checkedAt)) return false;
    return Date.now() - checkedAt < NAPCAT_RUNTIME_CHECK_TTL_MS;
  }

  private toTime(value?: Date | null) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  private publishOfflineNotice(
    selfId: string,
    offlineReason: string,
    metadata: Record<string, unknown>,
  ) {
    if (!this.systemNoticePublisher) return;

    void this.systemNoticePublisher
      .publishSystemNotice({
        content: offlineReason,
        dedupeKey: `qqbot:offline:${selfId}`,
        eventType: 'qqbot.account.offline',
        metadata: {
          ...metadata,
          selfId,
        },
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'qqbot',
        summary: offlineReason,
        title: `QQBot 账号已下线：${selfId}`,
      })
      .catch(() => undefined);
  }

  private async assertSelfIdAvailable(selfId: string, id?: string) {
    const exists = await this.accountRepository.findOne({
      where: {
        selfId,
      },
    });
    if (exists && exists.id !== id) {
      throwVbenError(
        exists.isDeleted
          ? 'QQBot 账号 selfId 已存在于已删除账号，请通过新增恢复该账号'
          : 'QQBot 账号 selfId 已存在',
      );
    }
  }

  private async restoreDeletedAccount(payload: Partial<QqbotAccount>) {
    if (!payload.selfId) return null;

    const existing = await this.accountRepository.findOne({
      where: {
        selfId: payload.selfId,
      },
    });
    if (!existing || !existing.isDeleted) return null;

    await this.accountRepository.update(
      { id: existing.id },
      {
        ...payload,
        clientRole: null,
        connectStatus: 'offline',
        isDeleted: false,
        lastError: null,
        lastHeartbeatAt: null,
      },
    );
    return existing;
  }

  private normalizeBody(body: Partial<QqbotAccountBodyDto>) {
    const payload: Partial<QqbotAccount> = {
      accessToken: this.toolsService.normalizeNullableString(body.accessToken),
      connectionMode: body.connectionMode || 'reverse-ws',
      enabled: body.enabled ?? true,
      name: body.name || '',
      remark: body.remark || '',
      selfId:
        typeof body.selfId === 'string' ? body.selfId.trim() : body.selfId,
    };
    const napcatLoginPasswordSecret = this.toNapcatLoginPasswordSecret(
      body.encryptedLoginPassword,
    );
    if (napcatLoginPasswordSecret !== undefined) {
      payload.napcatLoginPasswordSecret = napcatLoginPasswordSecret;
    }
    return payload;
  }

  private toNapcatLoginPasswordSecret(encryptedLoginPassword?: string) {
    if (!encryptedLoginPassword) return undefined;
    if (!this.passwordCryptoService) {
      throwVbenError('登录密码解密服务未配置');
    }

    const password = this.toolsService.toSecretText(
      this.passwordCryptoService.decryptPassword(encryptedLoginPassword),
    );
    return password
      ? this.toolsService.encryptSecretText(
          password,
          this.getAccountSecretKey(),
        )
      : null;
  }

  private getAccountSecretKey() {
    const secret = this.toolsService.pickFirstText(
      this.configService?.get<string>('QQBOT_ACCOUNT_SECRET_KEY'),
      this.configService?.get<string>('ADMIN_TOKEN_SECRET'),
    );
    if (!secret || INSECURE_ACCOUNT_SECRET_VALUES.has(secret)) {
      throwVbenError(
        'QQBot 账号登录密码密钥未配置，请设置 QQBOT_ACCOUNT_SECRET_KEY 或 ADMIN_TOKEN_SECRET',
      );
    }
    return secret;
  }

  private async bindAbility(
    selfId: string,
    abilityKey: string,
    type: QqbotAccountAbilityType,
  ) {
    const account = await this.assertConfigurableAccount(selfId);
    const normalizedKey = this.normalizeAbilityId(abilityKey);
    const existing = await this.accountAbilityRepository.findOne({
      where: {
        abilityKey: normalizedKey,
        abilityType: type,
        accountId: account.id,
      },
    });

    if (existing) {
      await this.accountAbilityRepository.update(
        { id: existing.id },
        { isDeleted: false, selfId: account.selfId },
      );
      return true;
    }

    await this.accountAbilityRepository.save(
      this.accountAbilityRepository.create({
        abilityKey: normalizedKey,
        abilityType: type,
        accountId: account.id,
        isDeleted: false,
        selfId: account.selfId,
      }),
    );
    return true;
  }

  private async unbindAbility(
    selfId: string,
    abilityKey: string,
    type: QqbotAccountAbilityType,
  ) {
    const account = await this.assertConfigurableAccount(selfId);
    const normalizedKey = this.normalizeAbilityId(abilityKey);
    await this.accountAbilityRepository.update(
      {
        abilityKey: normalizedKey,
        abilityType: type,
        accountId: account.id,
      },
      { isDeleted: true, selfId: account.selfId },
    );
    return true;
  }

  private async assertConfigurableAccount(selfId: string) {
    const normalizedSelfId = `${selfId || ''}`.trim();
    if (!normalizedSelfId) throwVbenError('请选择所属 QQBot 账号');
    const account = await this.findBySelfId(normalizedSelfId);
    if (!account || !account.enabled) {
      throwVbenError(`QQBot 账号不存在或已停用：${normalizedSelfId}`);
    }
    return account;
  }

  private normalizeAbilityId(abilityId: string) {
    const normalizedId = `${abilityId || ''}`.trim();
    if (!normalizedId) throwVbenError('绑定能力 ID 不能为空');
    return normalizedId;
  }

  private async getBoundAbilityKeys(
    selfId: string,
    abilityType: QqbotAccountAbilityType,
  ) {
    const account = await this.findBySelfId(`${selfId || ''}`.trim());
    if (!account || !account.enabled || account.isDeleted) return [];
    const bindings = await this.accountAbilityRepository.find({
      order: {
        createTime: 'ASC',
      },
      where: {
        abilityType,
        accountId: account.id,
        isDeleted: false,
      },
    });
    return bindings.map((item) => item.abilityKey);
  }
}
