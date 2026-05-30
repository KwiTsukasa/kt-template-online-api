import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QqbotAllowlist } from './qqbot-allowlist.entity';
import { QqbotBlocklist } from './qqbot-blocklist.entity';
import type {
  QqbotPermissionBodyDto,
  QqbotPermissionQueryDto,
  QqbotPermissionUpdateDto,
} from './qqbot-permission.dto';
import type { QqbotNormalizedMessage } from '../qqbot.types';
import { getPageParams } from '../qqbot.utils';

type PermissionKind = 'allowlist' | 'blocklist';
type PermissionEntity = QqbotAllowlist | QqbotBlocklist;

@Injectable()
export class QqbotPermissionService {
  constructor(
    @InjectRepository(QqbotAllowlist)
    private readonly allowlistRepository: Repository<QqbotAllowlist>,
    @InjectRepository(QqbotBlocklist)
    private readonly blocklistRepository: Repository<QqbotBlocklist>,
  ) {}

  async page(kind: PermissionKind, query: QqbotPermissionQueryDto) {
    const { pageNo, pageSize, skip } = getPageParams(query);
    const repository = this.getRepository(kind);
    const builder = repository
      .createQueryBuilder('permission')
      .where('permission.isDeleted = :isDeleted', { isDeleted: false });

    if (query.selfId) {
      builder.andWhere('permission.selfId = :selfId', {
        selfId: query.selfId,
      });
    }
    if (query.targetType) {
      builder.andWhere('permission.targetType = :targetType', {
        targetType: query.targetType,
      });
    }
    if (query.targetId) {
      builder.andWhere('permission.targetId LIKE :targetId', {
        targetId: `%${query.targetId}%`,
      });
    }

    const [list, total] = await builder
      .orderBy('permission.createTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
    return { list, pageNo, pageSize, total };
  }

  async save(kind: PermissionKind, body: QqbotPermissionBodyDto) {
    const repository = this.getRepository(kind);
    const saved = await repository.save(
      repository.create({
        enabled: body.enabled ?? true,
        remark: body.remark || '',
        selfId: body.selfId || '',
        targetId: body.targetId || '',
        targetType: body.targetType || 'all',
      } as PermissionEntity),
    );
    return saved.id;
  }

  async update(kind: PermissionKind, body: QqbotPermissionUpdateDto) {
    const repository = this.getRepository(kind);
    await repository.update(
      { id: body.id } as any,
      {
        enabled: body.enabled ?? true,
        remark: body.remark || '',
        selfId: body.selfId || '',
        targetId: body.targetId || '',
        targetType: body.targetType || 'all',
      } as any,
    );
    return true;
  }

  async remove(kind: PermissionKind, id: string) {
    const repository = this.getRepository(kind);
    await repository.update({ id } as any, { isDeleted: true } as any);
    return true;
  }

  async isBlocked(message: QqbotNormalizedMessage) {
    return this.existsMatched(this.blocklistRepository, message);
  }

  async isAllowed(message: QqbotNormalizedMessage) {
    const requireAllowlist =
      `${process.env.QQBOT_REQUIRE_ALLOWLIST ?? 'true'}` !== 'false';
    if (!requireAllowlist) return true;

    const hasRule = await this.allowlistRepository.count({
      where: {
        enabled: true,
        isDeleted: false,
      },
    });
    if (hasRule <= 0) return false;
    return this.existsMatched(this.allowlistRepository, message);
  }

  private async existsMatched(
    repository: Repository<PermissionEntity>,
    message: QqbotNormalizedMessage,
  ) {
    const count = await repository
      .createQueryBuilder('permission')
      .where('permission.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('permission.enabled = :enabled', { enabled: true })
      .andWhere('(permission.selfId = :selfId OR permission.selfId = :empty)', {
        empty: '',
        selfId: message.selfId,
      })
      .andWhere(
        '(permission.targetType = :all OR (permission.targetType = :targetType AND permission.targetId = :targetId))',
        {
          all: 'all',
          targetId: message.targetId,
          targetType: message.messageType,
        },
      )
      .getCount();
    return count > 0;
  }

  private getRepository(kind: PermissionKind) {
    return kind === 'allowlist'
      ? this.allowlistRepository
      : this.blocklistRepository;
  }
}
