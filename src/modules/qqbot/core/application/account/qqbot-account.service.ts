import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type EntityManager } from 'typeorm';
import {
  SYSTEM_NOTICE_PUBLISHER,
  SystemNoticePublisher,
  throwVbenError,
  ToolsService,
} from '@/common';
import {
  QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT,
  type QqbotAccountNapcatRuntimePort,
} from './qqbot-account-napcat-runtime.port';
import { QqbotAccountAbility } from '../../infrastructure/persistence/account/qqbot-account-ability.entity';
import { QqbotAccount } from '../../infrastructure/persistence/account/qqbot-account.entity';
import { QqbotMessageDelivery } from '../../infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessagePublishBinding } from '../../infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
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
  QqbotNapcatRuntimeLoginStatus,
  QqbotNapcatWebuiStatus,
  QqbotRuntimeContainerStatus,
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
  ) {}

  /**
   * 按 QQ 号、名称与连接状态筛选未删除账号并分页，再附加对应 NapCat 运行态。
   * @param query - 限定按 QQ 号、名称与连接状态筛选未删除账号并分页，再附加对应 NapCat 运行态筛选、排序与分页范围的查询条件，包含 `selfId`、`name`、`connectStatus` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的QQBot 管理分页结果。
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
   * 根据当前运行态处理启用状态。
   * @returns 启用状态。
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
   * 按`selfId`读取Bound命令标识集合；从 `getBoundAbilityKeys` 读取Bound命令标识集合。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns Bound命令标识集合。
   */
  async getBoundCommandIds(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'command');
  }

  /**
   * 按`selfId`读取Bound权限规则标识集合；从 `getBoundAbilityKeys` 读取Bound权限规则标识集合。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns Bound权限规则标识集合。
   */
  async getBoundRuleIds(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'rule');
  }

  /**
   * 按`selfId`读取Bound事件插件Keys；从 `getBoundAbilityKeys` 读取Bound事件插件Keys。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns Bound事件插件Keys。
   */
  async getBoundEventPluginKeys(selfId: string) {
    return this.getBoundAbilityKeys(selfId, 'event_plugin');
  }

  /**
   * 校验账号与命令标识后恢复或新建命令能力绑定，并保持重复调用幂等。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param commandId - 用于精确定位命令的标识。
   * @returns 命令。
   */
  async bindCommand(selfId: string, commandId: string) {
    return this.bindAbility(selfId, commandId, 'command');
  }

  /**
   * 根据`selfId`、`ruleId`处理权限规则。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param ruleId - 用于精确定位权限规则的标识。
   * @returns 权限规则。
   */
  async bindRule(selfId: string, ruleId: string) {
    return this.bindAbility(selfId, ruleId, 'rule');
  }

  /**
   * 根据`selfId`、`pluginKey`处理事件插件。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param pluginKey - 用于读取或更新事件插件的稳定键。
   * @returns 事件插件。
   */
  async bindEventPlugin(selfId: string, pluginKey: string) {
    return this.bindAbility(selfId, pluginKey, 'event_plugin');
  }

  /**
   * 校验账号与命令标识后软删除命令能力绑定，并保持记录供后续恢复。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param commandId - 用于精确定位命令的标识。
   * @returns 命令。
   */
  async unbindCommand(selfId: string, commandId: string) {
    return this.unbindAbility(selfId, commandId, 'command');
  }

  /**
   * 校验账号与规则标识后软删除权限规则绑定，并保持记录供后续恢复。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param ruleId - 用于精确定位权限规则的标识。
   * @returns 权限规则。
   */
  async unbindRule(selfId: string, ruleId: string) {
    return this.unbindAbility(selfId, ruleId, 'rule');
  }

  /**
   * 校验账号与插件键后软删除事件插件绑定，并保持记录供后续恢复。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param pluginKey - 用于读取或更新事件插件的稳定键。
   * @returns 事件插件。
   */
  async unbindEventPlugin(selfId: string, pluginKey: string) {
    return this.unbindAbility(selfId, pluginKey, 'event_plugin');
  }

  /**
   * 按`selfId`读取账号；当 `selfId` 成立时返回 `account`。
   * @param selfId - 用于精确定位QQ 账号的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 账号。
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
   * 按`selfId`读取启用状态QQ 账号标识令牌；把变更持久化到当前存储（`accountRepository.createQueryBuilder`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 启用状态QQ 账号标识令牌。
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
   * 按`id`读取标识；从 `accountRepository.findOne` 读取标识。
   * @param id - 决定标识内容、边界或目标的 `id` 值。
   * @returns 标识。
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
   * 按`id`读取标识NapCatLogin密钥；把变更持久化到当前存储（`accountRepository.createQueryBuilder`）。
   * @param id - 决定标识NapCatLogin密钥内容、边界或目标的 `id` 值。
   * @returns 标识NapCatLogin密钥。
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
   * 按`selfId`读取QQ 账号标识；从 `accountRepository.findOne` 读取QQ 账号标识。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns QQ 账号标识。
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
   * 确保Scanned账号存在且保持一致；缺失时根据`input`补齐对应状态；当 `existing` 成立时返回 `existing.id`。
   * @param input - 用于Scanned账号的结构化输入，包含 `selfId`、`accountId`、`name` 字段。
   * @returns Scanned账号。
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

    const existing = await (async () => {
      if (input.accountId) {
        return await this.accountRepository.findOne({ where: { id: input.accountId } });
      }
      return await this.accountRepository.findOne({ where: { selfId } });
    })();
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
   * 确保运行态账号存在且保持一致；缺失时根据`selfId`补齐对应状态；当 `existing` 成立时直接结束且不产生返回值。
   * @param selfId - 用于精确定位QQ 账号的标识。
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
   * 根据`body`更新`save` 对应结果；把变更持久化到当前存储（`accountRepository.create`）。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @returns `save` 对应。
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
   * 根据`body`更新QQBot账号记录；先通过 `assertSelfIdAvailable` 校验输入边界。
   * @param body - 用于QQBot账号记录的结构化输入，包含 `selfId`、`id`、`accessToken` 字段。
   * @returns 满足QQBot账号记录约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
    await this.accountRepository.manager.transaction(async (manager) => {
      const accounts = manager.getRepository(QqbotAccount);
      const current = await accounts.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: body.id, isDeleted: false },
      });
      if (!current) {
        throwVbenError('QQBot 账号不存在或已删除');
      }
      const selfIdChanged =
        typeof payload.selfId === 'string' && payload.selfId !== current.selfId;
      await accounts.update({ id: body.id }, payload);
      if (selfIdChanged) {
        await manager
          .getRepository(QqbotAccountAbility)
          .update({ accountId: body.id }, { selfId: payload.selfId! });
      }
      if (selfIdChanged || payload.enabled === false) {
        await this.cancelAccountDeliveries(manager, body.id);
      }
    });
    return true;
  }

  /**
   * 按`id`移除QQBot账号记录；从 `accountRepository.findOne` 读取QQBot账号记录。
   * @param id - 决定QQBot账号记录内容、边界或目标的 `id` 值。
   * @returns 包含 `deletedContainers` 字段的QQBot账号记录。
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
    await this.accountRepository.manager.transaction(async (manager) => {
      const accounts = manager.getRepository(QqbotAccount);
      const current = await accounts.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id, isDeleted: false },
      });
      if (!current) {
        throwVbenError('QQBot 账号不存在或已删除');
      }
      await accounts.update(
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
      await manager
        .getRepository(QqbotAccountAbility)
        .update({ accountId: id }, { isDeleted: true });
      await this.cancelAccountDeliveries(manager, id);
    });
    return {
      deletedContainers: containerResult.deletedContainers,
    };
  }

  /**
   * 根据`selfId`、`clientRole`、`lastError`处理Online；把变更持久化到当前存储（`accountRepository.update`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param clientRole - 决定Online内容、边界或目标的 `clientRole` 值。
   * @param lastError - 决定Online内容、边界或目标的 `lastError` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
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
      if (lastError) {
        payload.lastError = this.toolsService.toColumnText(lastError, 500);
      } else {
        payload.lastError = null;
      }
    }
    await this.accountRepository.update({ selfId }, payload);
  }

  /**
   * 根据`manager`、`accountId`与当前约束判定账号投递记录；从 `manager.getRepository` 读取账号投递记录。
   * @param manager - 保证账号投递记录读写处于同一事务中的实体管理器。
   * @param accountId - 用于精确定位账号的标识。
   */
  private async cancelAccountDeliveries(
    manager: EntityManager,
    accountId: string,
  ): Promise<void> {
    const bindings = await manager
      .getRepository(QqbotMessagePublishBinding)
      .find({
        select: { id: true },
        where: { accountId: String(accountId) },
      });
    if (!bindings.length) return;
    await manager.getRepository(QqbotMessageDelivery).update(
      {
        bindingId: In(bindings.map((binding) => binding.id)),
        status: In(['waiting_ddns', 'pending', 'retry']),
      },
      { nextAttemptAt: null, processingLeaseUntil: null, status: 'cancelled' },
    );
  }

  /**
   * 按 QQ 号将账号与 OneBot 连接状态更新为在线，并记录当前心跳时间。
   * @param selfId - 用于精确定位QQ 账号的标识。
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
   * 看门狗：主动巡检在线的已绑定账号，复用既有离线检测 + 站内信告警逻辑， 让掉线/被踢能被及时发现并通知超管，而不必等管理员打开账号列表页。 风控下线后不再自动尝试快速/密码登录，只通知管理员手动重新登录。
   * @returns 返回包含 `checked` 字段的看门狗：主动巡检在线的已绑定账号，复用既有离线检测 + 站内信告警逻辑， 让掉线/被踢能被及时发现并通知超管，而不必等管理员打开账号列表页。 风控下线后不再自动尝试快速/密码登录，只通知管理员手动重新登录投影。
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
   * 根据`selfId`、`lastError`处理Offline；把变更持久化到当前存储（`accountRepository.update`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param lastError - 决定Offline内容、边界或目标的 `lastError` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  async markOffline(selfId: string, lastError?: string) {
    const payload: Partial<QqbotAccount> = {
      connectStatus: 'offline',
      oneBotStatus: 'offline',
    };
    if (lastError !== undefined) {
      if (lastError) {
        payload.lastError = this.toolsService.toColumnText(lastError, 500);
      } else {
        payload.lastError = null;
      }
    }
    await this.accountRepository.update({ selfId }, payload);
  }

  /**
   * 根据`selfId`、`lastError`处理QqLoginOffline；把变更持久化到当前存储（`accountRepository.update`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param lastError - 决定QqLoginOffline内容、边界或目标的 `lastError` 值。
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
   * 根据`selfId`、`qqLoginStatus`、`lastError`处理标记QQ登录状态；把变更持久化到当前存储（`accountRepository.update`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param qqLoginStatus - 决定标记QQ登录状态内容、边界或目标的 `qqLoginStatus` 值。
   * @param lastError - 决定标记QQ登录状态内容、边界或目标的 `lastError` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  async markQqLoginStatus(
    selfId: string,
    qqLoginStatus: QqbotNapcatRuntimeLoginStatus,
    lastError?: null | string,
  ) {
    const payload: Partial<QqbotAccount> = {
      qqLoginStatus,
    };
    if (lastError !== undefined) {
      if (lastError) {
        payload.lastError = this.toolsService.toColumnText(lastError, 500);
      } else {
        payload.lastError = null;
      }
    }
    await this.accountRepository.update({ selfId }, payload);
  }

  /**
   * 按`account`读取NapCatLogin密码；从 `getAccountSecretKey` 读取NapCatLogin密码。
   * @param account - 用于NapCatLogin密码的领域对象，包含 `napcatLoginPasswordSecret` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的NapCatLogin密码，取值为 `''`。
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
   * 根据`accounts`更新NapCat运行态；当 `!this.napcatRuntime` 成立时返回 `accounts.map((account) => Object.assign(acc…`。
   * @param accounts - 决定NapCat运行态内容、边界或目标的 `accounts` 值。
   * @returns 按输入顺序得到的NapCat运行态列表；无法解析或未命中时为 `null`，没有匹配项时为空数组。
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
      clearQqLoginError: async (selfId) => {
        await this.accountRepository.update({ selfId }, { lastError: null });
      },
      markQqLoginOffline: (selfId, lastError) =>
        this.markQqLoginOffline(selfId, lastError),
      publishOfflineNotice: (selfId, offlineReason, metadata) =>
        this.publishOfflineNotice(selfId, offlineReason, metadata),
    });
    await Promise.all(
      list.map((account) => this.syncPersistedNapcatSplitStatus(account)),
    );
    return list;
  }

  /**
   * 根据`account`处理已持久化的NapCat拆分状态；把变更持久化到当前存储（`accountRepository.update`）。
   * @param account - 用于已持久化的NapCat拆分状态的领域对象，包含 `id` 字段。
   */
  private async syncPersistedNapcatSplitStatus(account: QqbotAccountListItem) {
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
   * 根据`account`与当前约束判定已持久化的NapCat拆分状态是否存在。
   * @param account - 决定已持久化的NapCat拆分状态是否存在内容、边界或目标的 `account` 值。
   * @returns 满足已持久化的NapCat拆分状态是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 根据`account`构造NapCat拆分状态载荷。
   * @param account - 用于NapCat拆分状态载荷的领域对象，包含 `napcat`、`connectStatus` 字段。
   * @returns 包含 `containerStatus`、`oneBotStatus`、`qqLoginStatus`、`webuiStatus` 字段的NapCat拆分状态载荷。
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
      oneBotStatus: (() => {
        if (account.connectStatus === 'online') {
          return 'online';
        }
        return 'offline';
      })(),
      qqLoginStatus: napcat?.qqLoginStatus || 'unknown',
      webuiStatus: this.toPersistedWebuiStatus(napcat?.webuiOnline),
    };
  }

  /**
   * 将输入收敛并投影为已持久化的容器状态。
   * @param napcat - 用于已持久化的容器状态的领域对象，包含 `containerStatus`、`containerOnline` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的已持久化的容器状态，取值为 `'running'`、`'unknown'`。
   */
  private toPersistedContainerStatus(
    napcat?: null | QqbotAccountListItem['napcat'],
  ): QqbotRuntimeContainerStatus {
    if (napcat?.containerStatus) return napcat.containerStatus;
    if (napcat?.containerOnline) return 'running';
    return 'unknown';
  }

  /**
   * 将输入收敛并投影为已持久化的WebUI状态。
   * @param webuiOnline - 决定已持久化的WebUI状态内容、边界或目标的 `webuiOnline` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的已持久化的WebUI状态，取值为 `'online'`、`'offline'`、`'unknown'`。
   */
  private toPersistedWebuiStatus(
    webuiOnline?: boolean | null,
  ): QqbotNapcatWebuiStatus {
    if (webuiOnline === true) return 'online';
    if (webuiOnline === false) return 'offline';
    return 'unknown';
  }

  /**
   * 按账号发布可去重的离线系统通知，并提示管理员从账号页面手动更新登录。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param offlineReason - 决定Offline通知内容、边界或目标的 `offlineReason` 值。
   * @param metadata - 决定Offline通知内容、边界或目标的 `metadata` 值。
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
   * 校验`selfId`、`id`是否满足QQ 账号标识Available约束，并拒绝不合法输入；从 `accountRepository.findOne` 读取QQ 账号标识Available。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param id - 决定QQ 账号标识Available内容、边界或目标的 `id` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private async assertSelfIdAvailable(selfId: string, id?: string) {
    const exists = await this.accountRepository.findOne({
      where: {
        selfId,
      },
    });
    if (exists && exists.id !== id) {
      throwVbenError(
        (() => {
          if (exists.isDeleted) {
            return 'QQBot 账号 selfId 已存在于已删除账号，请通过新增恢复该账号';
          }
          return 'QQBot 账号 selfId 已存在';
        })(),
      );
    }
  }

  /**
   * 根据`payload`处理restoreDeleted账号；把变更持久化到当前存储（`accountRepository.update`）。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `selfId` 字段。
   * @returns restoreDeleted账号；无法解析或未命中时为 `null`。
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
   * 将`body`规范为请求内容，使等价输入得到一致表示。
   * @param body - 用于请求内容的结构化输入，包含 `accessToken`、`connectionMode`、`enabled`、`name` 字段。
   * @returns 请求内容。
   */
  private normalizeBody(body: Partial<QqbotAccountBodyDto>) {
    const payload: Partial<QqbotAccount> = {
      accessToken: this.toolsService.normalizeNullableString(body.accessToken),
      connectionMode: body.connectionMode || 'reverse-ws',
      enabled: body.enabled ?? true,
      name: body.name || '',
      remark: body.remark || '',
      selfId:
        (() => {
          if (typeof body.selfId === 'string') {
            return body.selfId.trim();
          }
          return body.selfId;
        })(),
    };
    const napcatLoginPasswordSecret = this.toNapcatLoginPasswordSecret(
      body.loginPassword,
    );
    if (napcatLoginPasswordSecret !== undefined) {
      payload.napcatLoginPasswordSecret = napcatLoginPasswordSecret;
    }
    return payload;
  }

  /**
   * 将`loginPassword`转换为NapCatLogin密码密钥；从 `getAccountSecretKey` 读取NapCatLogin密码密钥。
   * @param loginPassword - 决定NapCatLogin密码密钥内容、边界或目标的 `loginPassword` 值；为空时采用 `''` 作为兜底。
   * @returns NapCatLogin密码密钥；没有可用结果或提前结束时为 `undefined`。
   */
  private toNapcatLoginPasswordSecret(loginPassword?: string) {
    if (!`${loginPassword ?? ''}`.trim()) return undefined;
    return this.toolsService.encryptSecretText(
      loginPassword,
      this.getAccountSecretKey(),
    );
  }

  /**
   * 按当前运行态读取账号密钥键；从 `configService.get` 读取账号密钥键。
   * @returns 账号密钥键。
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
   * 根据`selfId`、`abilityKey`、`type`处理插件能力；当 `existing` 成立时返回 `true`。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param abilityKey - 用于读取或更新插件能力的稳定键。
   * @param type - 决定插件能力内容、边界或目标的 `type` 值。
   * @returns 满足插件能力约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 按`selfId`、`abilityKey`、`type`移除插件能力；把变更持久化到当前存储（`accountAbilityRepository.update`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param abilityKey - 用于读取或更新插件能力的稳定键。
   * @param type - 决定插件能力内容、边界或目标的 `type` 值。
   * @returns 满足插件能力约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 校验`selfId`是否满足Configurable账号约束，并拒绝不合法输入；从 `findBySelfId` 读取Configurable账号。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns Configurable账号。
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
   * 将`abilityId`规范为插件能力标识，使等价输入得到一致表示。
   * @param abilityId - 用于精确定位插件能力的标识。
   * @returns 插件能力标识。
   */
  private normalizeAbilityId(abilityId: string) {
    const normalizedId = `${abilityId || ''}`.trim();
    if (!normalizedId) throwVbenError('绑定能力 ID 不能为空');
    return normalizedId;
  }

  /**
   * 按`selfId`、`abilityType`读取Bound插件能力Keys；从 `findBySelfId` 读取Bound插件能力Keys。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param abilityType - 决定Bound插件能力Keys内容、边界或目标的 `abilityType` 值。
   * @returns Bound插件能力Keys。
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
