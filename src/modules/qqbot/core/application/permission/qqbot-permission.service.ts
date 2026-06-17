import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { QqbotAllowlist } from '../../infrastructure/persistence/permission/qqbot-allowlist.entity';
import { QqbotBlocklist } from '../../infrastructure/persistence/permission/qqbot-blocklist.entity';
import type {
  QqbotPermissionBodyDto,
  QqbotPermissionConfigDto,
  QqbotPermissionQueryDto,
  QqbotPermissionUpdateDto,
} from '../../contract/permission/qqbot-permission.dto';
import { QqbotConfigService } from '../config/qqbot-config.service';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../../contract/qqbot.constants';
import type {
  QqbotNormalizedMessage,
  QqbotPermissionEntity,
  QqbotPermissionKind,
} from '../../contract/qqbot.types';

@Injectable()
export class QqbotPermissionService {
  /**
   * 初始化 QqbotPermissionService 实例。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   * @param allowlistRepository - QQBot仓库依赖；影响 constructor 的返回值。
   * @param blocklistRepository - QQBot仓库依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly configService: QqbotConfigService,
    @InjectRepository(QqbotAllowlist)
    private readonly allowlistRepository: Repository<QqbotAllowlist>,
    @InjectRepository(QqbotBlocklist)
    private readonly blocklistRepository: Repository<QqbotBlocklist>,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 查询 QQBot 核心数据。
   */
  async getConfig() {
    return this.configService.getPermissionConfig();
  }

  /**
   * 更新Config。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async updateConfig(body: QqbotPermissionConfigDto) {
    return this.configService.updatePermissionConfig(body);
  }

  /**
   * 获取分页数据。
   * @param kind - kind 输入；驱动 `this.getRepository()` 的 QQBot步骤。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  async page(kind: QqbotPermissionKind, query: QqbotPermissionQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      QQBOT_DEFAULT_PAGE_NO,
      QQBOT_DEFAULT_PAGE_SIZE,
    );
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
    if (query.userId) {
      builder.andWhere('permission.userId LIKE :userId', {
        userId: `%${query.userId}%`,
      });
    }
    if (query.preciseUser !== undefined && `${query.preciseUser}` !== '') {
      builder.andWhere('permission.preciseUser = :preciseUser', {
        preciseUser: this.toolsService.normalizeBoolean(query.preciseUser),
      });
    }

    const [list, total] = await builder
      .orderBy('permission.createTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
    return { list, pageNo, pageSize, total };
  }

  /**
   * 保存数据。
   * @param kind - kind 输入；驱动 `this.getRepository()` 的 QQBot步骤。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async save(kind: QqbotPermissionKind, body: QqbotPermissionBodyDto) {
    const repository = this.getRepository(kind);
    const payload = this.normalizeBody(body);
    const saved = await repository.save(
      repository.create({
        ...payload,
      } as QqbotPermissionEntity),
    );
    return saved.id;
  }

  /**
   * 更新数据。
   * @param kind - kind 输入；驱动 `this.getRepository()` 的 QQBot步骤。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async update(kind: QqbotPermissionKind, body: QqbotPermissionUpdateDto) {
    const repository = this.getRepository(kind);
    const payload = this.normalizeBody(body);
    await repository.update(
      { id: body.id } as any,
      {
        ...payload,
      } as any,
    );
    return true;
  }

  /**
   * 删除数据。
   * @param kind - kind 输入；驱动 `this.getRepository()` 的 QQBot步骤。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
  async remove(kind: QqbotPermissionKind, id: string) {
    const repository = this.getRepository(kind);
    await repository.update({ id } as any, { isDeleted: true } as any);
    return true;
  }

  /**
   * 判断 QQBot 核心条件。
   * @param message - message 输入；驱动 `this.existsMatched()` 的 QQBot步骤。
   */
  async isBlocked(message: QqbotNormalizedMessage) {
    const config = await this.configService.getPermissionConfig();
    if (!config.blocklistEnabled) return false;
    return this.existsMatched(this.blocklistRepository, message);
  }

  /**
   * 判断 QQBot 核心条件。
   * @param message - message 输入；驱动 `this.existsMatched()` 的 QQBot步骤。
   */
  async isAllowed(message: QqbotNormalizedMessage) {
    const config = await this.configService.getPermissionConfig();
    if (!config.allowlistEnabled) return true;
    return this.existsMatched(this.allowlistRepository, message);
  }

  /**
   * 执行 QQBot 核心流程。
   * @param repository - repository 输入；影响 existsMatched 的返回值。
   * @param message - message 输入；使用 `selfId`、`userId`、`messageType`、`targetId` 字段生成结果。
   */
  private async existsMatched(
    repository: Repository<QqbotPermissionEntity>,
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
        new Brackets((qb) => {
          qb.where('permission.targetType = :all', { all: 'all' }).orWhere(
            '(permission.targetType IN (:...qqTargetTypes) AND permission.targetId = :userId)',
            {
              qqTargetTypes: ['qq', 'private'],
              userId: message.userId,
            },
          );

          if (message.messageType === 'group') {
            qb.orWhere(
              `(permission.targetType = :groupType
                AND permission.targetId = :targetId
                AND (
                  permission.preciseUser = :notPrecise
                  OR (permission.preciseUser = :precise AND permission.userId = :userId)
                ))`,
              {
                groupType: 'group',
                notPrecise: false,
                precise: true,
                targetId: message.targetId,
                userId: message.userId,
              },
            );
          }

          if (message.messageType === 'channel') {
            qb.orWhere(
              `(permission.targetType = :channelType
                AND permission.targetId = :targetId
                AND (
                  permission.preciseUser = :notPrecise
                  OR (permission.preciseUser = :precise AND permission.userId = :userId)
                ))`,
              {
                channelType: 'channel',
                notPrecise: false,
                precise: true,
                targetId: message.targetId,
                userId: message.userId,
              },
            );
          }
        }),
      )
      .getCount();
    return count > 0;
  }

  /**
   * 转换 QQBot 核心输入。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   * @returns QQBot 核心转换后的值。
   */
  private normalizeBody(
    body: Partial<QqbotPermissionBodyDto>,
  ): Partial<QqbotPermissionEntity> {
    const targetType = body.targetType === 'private' ? 'qq' : body.targetType;
    const normalizedTargetType = targetType || 'qq';
    const targetId = `${body.targetId || ''}`.trim();
    const userId = `${body.userId || ''}`.trim();
    const preciseUser =
      normalizedTargetType === 'group' || normalizedTargetType === 'channel'
        ? !!body.preciseUser
        : false;

    if (!targetId) {
      throwVbenError(
        normalizedTargetType === 'qq'
          ? '请填写 QQ 号'
          : normalizedTargetType === 'group'
            ? '请填写群号'
            : '请填写频道 ID',
      );
    }
    if (preciseUser && !userId) {
      throwVbenError('开启精确到 QQ 号后必须填写 QQ 号');
    }

    return {
      enabled: body.enabled ?? true,
      preciseUser,
      remark: body.remark || '',
      selfId: body.selfId || '',
      targetId,
      targetType: normalizedTargetType,
      userId: preciseUser ? userId : '',
    } as Partial<QqbotPermissionEntity>;
  }

  /**
   * 查询 QQBot 核心数据。
   * @param kind - kind 输入；限定 QQBot查询范围。
   */
  private getRepository(kind: QqbotPermissionKind) {
    return kind === 'allowlist'
      ? this.allowlistRepository
      : this.blocklistRepository;
  }
}
