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
} from '../../contract/qqbot.types';

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
      (await this.napcatRuntime?.removeAccountContainers(id)) || {
        deletedContainers: 0,
      };
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
    if (!this.napcatRuntime) {
      return accounts.map((account) => Object.assign(account, { napcat: null }));
    }

    return this.napcatRuntime.appendRuntime(accounts, options, {
      clearQqLoginError: async (selfId) => {
        await this.accountRepository.update({ selfId }, { lastError: null });
      },
      getLoginPassword: (account) => this.getNapcatLoginPassword(account),
      markOnline: (selfId, clientRole, lastError) =>
        this.markOnline(selfId, clientRole, lastError),
      markQqLoginOffline: (selfId, lastError) =>
        this.markQqLoginOffline(selfId, lastError),
      publishOfflineNotice: (selfId, offlineReason, metadata) =>
        this.publishOfflineNotice(selfId, offlineReason, metadata),
    });
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
