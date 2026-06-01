import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { QqbotAccount } from './qqbot-account.entity';
import type {
  QqbotAccountBodyDto,
  QqbotAccountQueryDto,
  QqbotAccountUpdateDto,
} from './qqbot-account.dto';
import { QqbotNapcatContainerService } from '../napcat/qqbot-napcat-container.service';
import type { QqbotConnectionRole } from '../qqbot.types';
import { getPageParams, normalizeNullableString } from '../qqbot.utils';

@Injectable()
export class QqbotAccountService {
  constructor(
    @InjectRepository(QqbotAccount)
    private readonly accountRepository: Repository<QqbotAccount>,
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

    const [list, total] = await builder
      .orderBy('account.createTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
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
    await this.assertSelfIdAvailable(body.selfId);
    const account = this.accountRepository.create(this.normalizeBody(body));
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

  private async assertSelfIdAvailable(selfId: string, id?: string) {
    const exists = await this.accountRepository.findOne({
      where: {
        isDeleted: false,
        selfId,
      },
    });
    if (exists && exists.id !== id) {
      throwVbenError('QQBot 账号 selfId 已存在');
    }
  }

  private normalizeBody(body: Partial<QqbotAccountBodyDto>) {
    return {
      accessToken: normalizeNullableString(body.accessToken),
      connectionMode: body.connectionMode || 'reverse-ws',
      enabled: body.enabled ?? true,
      name: body.name || '',
      remark: body.remark || '',
      selfId: body.selfId,
    } as Partial<QqbotAccount>;
  }
}
