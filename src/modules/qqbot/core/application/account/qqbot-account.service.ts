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
import {
  QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT,
  type QqbotAccountNapcatRuntimePort,
} from './qqbot-account-napcat-runtime.port';
import { QqbotAccountAbility } from '../../infrastructure/persistence/account/qqbot-account-ability.entity';
import { QqbotAccount } from '../../infrastructure/persistence/account/qqbot-account.entity';
import type {
  QqbotAccountBodyDto,
  QqbotAccountQueryDto,
  QqbotAccountUpdateDto,
} from '../../contract/account/qqbot-account.dto';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../../contract/qqbot.constants';
import type {
  QqbotAccountAbilityType,
  QqbotAccountListItem,
  QqbotConnectionRole,
  QqbotNapcatWebuiStatus,
  QqbotRuntimeContainerStatus,
} from '../../contract/qqbot.types';

const INSECURE_ACCOUNT_SECRET_VALUES = new Set([
  'change-me',
  'kt-template-online-admin-token-secret',
]);

@Injectable()
export class QqbotAccountService {
  /**
   * 初始化 QqbotAccountService 实例。
   * @param accountRepository - 账号仓库依赖；影响 constructor 的返回值。
   * @param accountAbilityRepository - 账号仓库依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param napcatRuntime - napcatRuntime 输入；影响 constructor 的返回值。
   * @param systemNoticePublisher - systemNoticePublisher 输入；影响 constructor 的返回值。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   * @param passwordCryptoService - passwordCryptoService 服务依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(QqbotAccount)
    private readonly accountRepository: Repository<QqbotAccount>,
    @InjectRepository(QqbotAccountAbility)
    private readonly accountAbilityRepository: Repository<QqbotAccountAbility>,
    private readonly toolsService: ToolsService,
    @Optional()
    @Inject(QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT)
    private readonly napcatRuntime?: QqbotAccountNapcatRuntimePort,
    @Optional()
    @Inject(SYSTEM_NOTICE_PUBLISHER)
    private readonly systemNoticePublisher?: SystemNoticePublisher,
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    private readonly passwordCryptoService?: AdminPasswordCryptoService,
  ) {}

  /**
   * 获取分页数据。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
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

  /**
   * 执行 QQBot 核心流程。
   */
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

  /**
   * 查询 QQBot 核心数据。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async getBoundCommandIds(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'command');
  }

  /**
   * 查询 QQBot 核心数据。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async getBoundRuleIds(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'rule');
  }

  /**
   * 查询 QQBot 核心数据。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async getBoundEventPluginKeys(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'event_plugin');
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param commandId - 命令 ID；定位本次读取、更新、删除或关联的命令。
   */
  async bindCommand(selfId: string, commandId: string) {
    return this.bindAbility(selfId, commandId, 'command');
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param ruleId - QQBot ID；定位本次读取、更新、删除或关联的QQBot。
   */
  async bindRule(selfId: string, ruleId: string) {
    return this.bindAbility(selfId, ruleId, 'rule');
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param pluginKey - pluginKey 输入；驱动 `this.bindAbility()` 的 QQBot步骤。
   */
  async bindEventPlugin(selfId: string, pluginKey: string) {
    return this.bindAbility(selfId, pluginKey, 'event_plugin');
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param commandId - 命令 ID；定位本次读取、更新、删除或关联的命令。
   */
  async unbindCommand(selfId: string, commandId: string) {
    return this.unbindAbility(selfId, commandId, 'command');
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param ruleId - QQBot ID；定位本次读取、更新、删除或关联的QQBot。
   */
  async unbindRule(selfId: string, ruleId: string) {
    return this.unbindAbility(selfId, ruleId, 'rule');
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param pluginKey - pluginKey 输入；驱动 `this.unbindAbility()` 的 QQBot步骤。
   */
  async unbindEventPlugin(selfId: string, pluginKey: string) {
    return this.unbindAbility(selfId, pluginKey, 'event_plugin');
  }

  /**
   * 查询 QQBot 核心数据。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
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

  /**
   * 查询 QQBot 核心数据。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async findEnabledBySelfIdWithToken(selfId: string) {
    return this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.accessToken')
      .where('account.selfId = :selfId', { selfId })
      .andWhere('account.enabled = :enabled', { enabled: true })
      .andWhere('account.isDeleted = :isDeleted', { isDeleted: false })
      .getOne();
  }

  /**
   * 查询 QQBot 核心数据。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
  async findById(id: string) {
    return this.accountRepository.findOne({
      where: {
        id,
        isDeleted: false,
      },
    });
  }

  /**
   * 查询 QQBot 核心数据。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
  async findByIdWithNapcatLoginSecret(id: string) {
    return this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.napcatLoginPasswordSecret')
      .where('account.id = :id', { id })
      .andWhere('account.isDeleted = :isDeleted', { isDeleted: false })
      .getOne();
  }

  /**
   * 查询 QQBot 核心数据。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async findBySelfId(selfId: string) {
    return this.accountRepository.findOne({
      where: {
        isDeleted: false,
        selfId,
      },
    });
  }

  /**
   * 确保Scanned Account。
   * @param input - input 输入；使用 `selfId`、`accountId`、`name` 字段生成结果。
   */
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
      containerStatus: 'unknown',
      connectStatus: 'offline',
      connectionMode: 'reverse-ws',
      enabled: true,
      isDeleted: false,
      lastError: null,
      name: input.name || existing?.name || `QQ ${selfId}`,
      oneBotStatus: 'offline',
      qqLoginStatus: 'unknown',
      selfId,
      webuiStatus: 'unknown',
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

  /**
   * 确保Runtime Account。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
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
          containerStatus: 'unknown',
          connectStatus: 'offline',
          enabled: true,
          isDeleted: false,
          lastError: null,
          name: existing.name || `QQ ${normalizedSelfId}`,
          oneBotStatus: 'offline',
          qqLoginStatus: 'unknown',
          webuiStatus: 'unknown',
        },
      );
      return;
    }

    await this.accountRepository.save(
      this.accountRepository.create({
        connectionMode: 'reverse-ws',
        containerStatus: 'unknown',
        connectStatus: 'offline',
        enabled: true,
        name: `QQ ${normalizedSelfId}`,
        oneBotStatus: 'offline',
        qqLoginStatus: 'unknown',
        remark: '',
        selfId: normalizedSelfId,
        webuiStatus: 'unknown',
      }),
    );
  }

  /**
   * 保存数据。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async save(body: QqbotAccountBodyDto) {
    const payload = this.normalizeBody(body);
    const restored = await this.restoreDeletedAccount(payload);
    if (restored) return restored.id;

    await this.assertSelfIdAvailable(payload.selfId || '');
    const account = this.accountRepository.create(payload);
    const saved = await this.accountRepository.save(account);
    return saved.id;
  }

  /**
   * 更新数据。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
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

  /**
   * 删除数据。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
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

    const containerResult = (await this.napcatRuntime?.removeAccountContainers(
      id,
    )) || {
      deletedContainers: 0,
    };
    await this.accountRepository.update(
      { id },
      {
        containerStatus: 'unknown',
        connectStatus: 'offline',
        enabled: false,
        isDeleted: true,
        oneBotStatus: 'offline',
        qqLoginStatus: 'unknown',
        webuiStatus: 'unknown',
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

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param clientRole - clientRole 输入；影响 markOnline 的返回值。
   * @param lastError - lastError 输入；驱动 `toolsService.toColumnText()` 的 QQBot步骤。
   */
  async markOnline(
    selfId: string,
    clientRole: QqbotConnectionRole,
    lastError?: null | string,
  ) {
    const payload: Partial<QqbotAccount> = {
      clientRole,
      connectStatus: 'online',
      lastConnectedAt: new Date(),
      oneBotStatus: 'online',
    };
    if (lastError !== undefined) {
      payload.lastError = lastError
        ? this.toolsService.toColumnText(lastError, 500)
        : null;
    }
    await this.accountRepository.update({ selfId }, payload);
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async markHeartbeat(selfId: string) {
    await this.accountRepository.update(
      { selfId },
      {
        connectStatus: 'online',
        lastHeartbeatAt: new Date(),
        oneBotStatus: 'online',
      },
    );
  }

  /**
   * 看门狗：主动巡检在线的已绑定账号，复用既有离线检测 + 站内信告警逻辑，
   * 让掉线/被踢能被及时发现并通知超管，而不必等管理员打开账号列表页。
   * 风控下线后不再自动尝试快速/密码登录，只通知管理员手动重新登录。
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

    await this.appendNapcatRuntime(accounts);
    return { checked: accounts.length };
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param lastError - lastError 输入；驱动 `toolsService.toColumnText()` 的 QQBot步骤。
   */
  async markOffline(selfId: string, lastError?: string) {
    const payload: Partial<QqbotAccount> = {
      connectStatus: 'offline',
      oneBotStatus: 'offline',
    };
    if (lastError !== undefined) {
      payload.lastError = lastError
        ? this.toolsService.toColumnText(lastError, 500)
        : null;
    }
    await this.accountRepository.update({ selfId }, payload);
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param lastError - lastError 输入；驱动 `toolsService.toColumnText()` 的 QQBot步骤。
   */
  async markQqLoginOffline(selfId: string, lastError: string) {
    await this.accountRepository.update(
      { selfId },
      {
        lastError: this.toolsService.toColumnText(lastError, 500),
        qqLoginStatus: 'offline',
      },
    );
  }

  /**
   * 查询 QQBot 核心数据。
   * @param account - account 输入；驱动 `toolsService.toTrimmedString()` 的 QQBot步骤。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param accounts - 账号列表；转换 QQBot列表项。
   * @returns 异步完成后的 QQBot 核心结果。
   */
  private async appendNapcatRuntime(
    accounts: QqbotAccount[],
  ): Promise<QqbotAccountListItem[]> {
    if (!this.napcatRuntime) {
      return accounts.map((account) =>
        Object.assign(account, { napcat: null }),
      );
    }

    const list = await this.napcatRuntime.appendRuntime(accounts, {
      /**
       * 执行 QQBot回调。
       * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
       */
      clearQqLoginError: async (selfId) => {
        await this.accountRepository.update({ selfId }, { lastError: null });
      },
      /**
       * 执行 QQBot回调。
       * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
       * @param lastError - lastError 输入；驱动 `this.markQqLoginOffline()` 的 QQBot步骤。
       */
      markQqLoginOffline: (selfId, lastError) =>
        this.markQqLoginOffline(selfId, lastError),
      /**
       * 执行 QQBot回调。
       * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
       * @param offlineReason - offlineReason 输入；驱动 `this.publishOfflineNotice()` 的 QQBot步骤。
       * @param metadata - metadata 输入；驱动 `this.publishOfflineNotice()` 的 QQBot步骤。
       */
      publishOfflineNotice: (selfId, offlineReason, metadata) =>
        this.publishOfflineNotice(selfId, offlineReason, metadata),
    });
    await Promise.all(
      list.map((account) => this.syncPersistedNapcatSplitStatus(account)),
    );
    return list;
  }

  /**
   * Persists computed NapCat split statuses back to qqbot_account when the entity exposes the v3 status columns.
   * @param account - Enriched account list row; its `napcat` snapshot is the latest runtime evidence produced for Admin.
   */
  private async syncPersistedNapcatSplitStatus(
    account: QqbotAccountListItem,
  ) {
    if (!this.hasPersistedNapcatSplitStatus(account)) return;

    const payload = this.buildNapcatSplitStatusPayload(account);
    const current = account as unknown as Record<string, unknown>;
    const changed = Object.entries(payload).some(
      ([key, value]) => current[key] !== value,
    );
    if (!changed) return;

    await this.accountRepository.update({ id: account.id }, payload);
    Object.assign(account, payload);
  }

  /**
   * Checks whether a hydrated account row includes the v3 split-status properties that should be kept in sync.
   * @param account - Account row or test double; legacy test doubles without these properties skip persistence.
   * @returns True when status synchronization can write meaningful column updates.
   */
  private hasPersistedNapcatSplitStatus(account: QqbotAccountListItem) {
    return [
      'oneBotStatus',
      'containerStatus',
      'webuiStatus',
      'qqLoginStatus',
    ].some((key) => Object.prototype.hasOwnProperty.call(account, key));
  }

  /**
   * Converts the latest account-list runtime evidence into qqbot_account split-status column values.
   * @param account - Account row plus optional NapCat runtime evidence returned from the runtime adapter.
   * @returns Partial account payload containing only the status columns owned by the split-status contract.
   */
  private buildNapcatSplitStatusPayload(
    account: QqbotAccountListItem,
  ): Pick<
    QqbotAccount,
    'containerStatus' | 'oneBotStatus' | 'qqLoginStatus' | 'webuiStatus'
  > {
    const napcat = account.napcat || null;
    return {
      containerStatus: this.toPersistedContainerStatus(napcat),
      oneBotStatus: account.connectStatus === 'online' ? 'online' : 'offline',
      qqLoginStatus: napcat?.qqLoginStatus || 'unknown',
      webuiStatus: this.toPersistedWebuiStatus(napcat?.webuiOnline),
    };
  }

  /**
   * Normalizes container evidence for the qqbot_account.container_status cache column.
   * @param napcat - Optional NapCat runtime info attached to the account-list row.
   * @returns Running/stopped/error/creating when known, otherwise unknown.
   */
  private toPersistedContainerStatus(
    napcat?: null | QqbotAccountListItem['napcat'],
  ): QqbotRuntimeContainerStatus {
    if (napcat?.containerStatus) return napcat.containerStatus;
    if (napcat?.containerOnline) return 'running';
    return 'unknown';
  }

  /**
   * Normalizes WebUI probe evidence for the qqbot_account.webui_status cache column.
   * @param webuiOnline - Runtime probe value; null/undefined means no fresh WebUI probe was performed.
   * @returns Persisted WebUI status suitable for filtering and raw DB inspection.
   */
  private toPersistedWebuiStatus(
    webuiOnline?: boolean | null,
  ): QqbotNapcatWebuiStatus {
    if (webuiOnline === true) return 'online';
    if (webuiOnline === false) return 'offline';
    return 'unknown';
  }

  /**
   * 投递 QQBot 核心消息或任务。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param offlineReason - offlineReason 输入；影响 publishOfflineNotice 的返回值。
   * @param metadata - metadata 输入；影响 publishOfflineNotice 的返回值。
   */
  private publishOfflineNotice(
    selfId: string,
    offlineReason: string,
    metadata: Record<string, unknown>,
  ) {
    if (!this.systemNoticePublisher) return;

    const noticeContent = `${offlineReason}\n请在 Admin 的 QQBot 账号页面手动点击「更新登录」重新登录。`;
    void this.systemNoticePublisher
      .publishSystemNotice({
        content: noticeContent,
        dedupeKey: `qqbot:offline:${selfId}`,
        eventType: 'qqbot.account.offline',
        metadata: {
          ...metadata,
          selfId,
        },
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'qqbot',
        summary: noticeContent,
        title: `QQBot 账号已下线：${selfId}`,
      })
      .catch(() => undefined);
  }

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param payload - payload 输入；使用 `selfId` 字段生成结果。
   */
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

  /**
   * 转换 QQBot 核心输入。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param encryptedLoginPassword - encryptedLoginPassword 输入；驱动 `toolsService.toSecretText()` 的 QQBot步骤。
   */
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

  /**
   * 查询 QQBot 核心数据。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param abilityKey - abilityKey 输入；驱动 `this.normalizeAbilityId()` 的 QQBot步骤。
   * @param type - type 输入；影响 bindAbility 的返回值。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param abilityKey - abilityKey 输入；驱动 `this.normalizeAbilityId()` 的 QQBot步骤。
   * @param type - type 输入；影响 unbindAbility 的返回值。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  private async assertConfigurableAccount(selfId: string) {
    const normalizedSelfId = `${selfId || ''}`.trim();
    if (!normalizedSelfId) throwVbenError('请选择所属 QQBot 账号');
    const account = await this.findBySelfId(normalizedSelfId);
    if (!account || !account.enabled) {
      throwVbenError(`QQBot 账号不存在或已停用：${normalizedSelfId}`);
    }
    return account;
  }

  /**
   * 转换 QQBot 核心输入。
   * @param abilityId - QQBot ID；定位本次读取、更新、删除或关联的QQBot。
   */
  private normalizeAbilityId(abilityId: string) {
    const normalizedId = `${abilityId || ''}`.trim();
    if (!normalizedId) throwVbenError('绑定能力 ID 不能为空');
    return normalizedId;
  }

  /**
   * 查询 QQBot 核心数据。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param abilityType - abilityType 输入；限定 QQBot查询范围。
   */
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
