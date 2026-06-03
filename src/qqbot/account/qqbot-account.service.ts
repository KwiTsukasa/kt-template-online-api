import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import {
  QqbotAccountAbility,
  type QqbotAccountAbilityType,
} from './qqbot-account-ability.entity';
import { QqbotAccount } from './qqbot-account.entity';
import type {
  QqbotAccountBodyDto,
  QqbotAccountQueryDto,
  QqbotAccountUpdateDto,
} from './qqbot-account.dto';
import { QqbotAccountNapcat } from '../napcat/qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from '../napcat/qqbot-napcat-container.entity';
import { QqbotNapcatContainerService } from '../napcat/qqbot-napcat-container.service';
import type {
  QqbotAccountNapcatBindStatus,
  QqbotConnectionRole,
  QqbotNapcatContainerStatus,
} from '../qqbot.types';
import { getPageParams, normalizeNullableString } from '../qqbot.utils';

export type QqbotAccountNapcatRuntimeInfo = {
  bindStatus?: QqbotAccountNapcatBindStatus;
  containerId?: string;
  containerName?: string;
  containerStatus?: QqbotNapcatContainerStatus;
  lastCheckedAt?: Date | null;
  lastError?: null | string;
  lastLoginAt?: Date | null;
  lastStartedAt?: Date | null;
  webuiPort?: null | number;
};

export type QqbotAccountListItem = QqbotAccount & {
  napcat?: null | QqbotAccountNapcatRuntimeInfo;
};

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
  ) {}

  async page(query: QqbotAccountQueryDto) {
    const { pageNo, pageSize, skip } = getPageParams(query);
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
    lastError: null | string = null,
  ) {
    await this.accountRepository.update(
      { selfId },
      {
        clientRole,
        connectStatus: 'online',
        lastConnectedAt: new Date(),
        lastError,
      },
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

  async markOffline(selfId: string, lastError?: string) {
    await this.accountRepository.update(
      { selfId },
      {
        connectStatus: 'offline',
        lastError: lastError || null,
      },
    );
  }

  private async appendNapcatRuntime(
    accounts: QqbotAccount[],
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
      const containers = await this.napcatContainerRepository
        .createQueryBuilder('container')
        .where('container.id IN (:...containerIds)', { containerIds })
        .andWhere('container.isDeleted = :isDeleted', { isDeleted: false })
        .getMany();
      for (const container of containers) {
        containerMap.set(container.id, container);
      }
    }

    return accounts.map((account) => {
      const binding = bindingMap.get(account.id);
      if (!binding) {
        return Object.assign(account, { napcat: null });
      }

      const container = containerMap.get(binding.containerId);
      return Object.assign(account, {
        napcat: {
          bindStatus: binding.bindStatus,
          containerId: binding.containerId,
          containerName: container?.name,
          containerStatus: container?.status,
          lastCheckedAt: container?.lastCheckedAt,
          lastError: container?.lastError,
          lastLoginAt: binding.lastLoginAt,
          lastStartedAt: container?.lastStartedAt,
          webuiPort: container?.webuiPort,
        },
      });
    });
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
    return {
      accessToken: normalizeNullableString(body.accessToken),
      connectionMode: body.connectionMode || 'reverse-ws',
      enabled: body.enabled ?? true,
      name: body.name || '',
      remark: body.remark || '',
      selfId:
        typeof body.selfId === 'string' ? body.selfId.trim() : body.selfId,
    } as Partial<QqbotAccount>;
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
