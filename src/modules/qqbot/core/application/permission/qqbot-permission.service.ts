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
  constructor(
    private readonly configService: QqbotConfigService,
    @InjectRepository(QqbotAllowlist)
    private readonly allowlistRepository: Repository<QqbotAllowlist>,
    @InjectRepository(QqbotBlocklist)
    private readonly blocklistRepository: Repository<QqbotBlocklist>,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 按当前运行态读取配置；从 `configService.getPermissionConfig` 读取配置。
   * @returns 配置。
   */
  async getConfig() {
    return this.configService.getPermissionConfig();
  }

  /**
   * 将 QQBot 权限请求交给配置服务持久化，并返回更新后的权限配置。
   * @param body - 用于配置的结构化输入。
   * @returns 配置。
   */
  async updateConfig(body: QqbotPermissionConfigDto) {
    return this.configService.updatePermissionConfig(body);
  }

  /**
   * 根据白名单或黑名单类型选择仓库，按查询条件筛选未删除记录并分页。
   * @param kind - 决定根据白名单或黑名单类型选择仓库，按查询条件筛选未删除记录并分页内容、边界或目标的 `kind` 值。
   * @param query - 限定根据白名单或黑名单类型选择仓库，按查询条件筛选未删除记录并分页筛选、排序与分页范围的查询条件，包含 `selfId`、`targetType`、`targetId`、`userId` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的根据白名单或黑名单类型选择仓库，按查询条件筛选未删除记录并分页。
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
   * 根据`kind`、`body`更新`save` 对应结果；把变更持久化到当前存储（`repository.save`）。
   * @param kind - 决定`save` 对应结果内容、边界或目标的 `kind` 值。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @returns `save` 对应。
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
   * 根据`kind`、`body`更新`update` 对应结果；把变更持久化到当前存储（`repository.update`）。
   * @param kind - 决定`update` 对应结果内容、边界或目标的 `kind` 值。
   * @param body - 用于`update` 对应结果的结构化输入，包含 `id` 字段。
   * @returns 满足`update` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 按`kind`、`id`移除`remove` 对应结果；把变更持久化到当前存储（`repository.update`）。
   * @param kind - 决定`remove` 对应结果内容、边界或目标的 `kind` 值。
   * @param id - 决定`remove` 对应结果内容、边界或目标的 `id` 值。
   * @returns 满足`remove` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async remove(kind: QqbotPermissionKind, id: string) {
    const repository = this.getRepository(kind);
    await repository.update({ id } as any, { isDeleted: true } as any);
    return true;
  }

  /**
   * 根据`message`与当前约束判定Blocked；从 `configService.getPermissionConfig` 读取Blocked。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 满足Blocked约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async isBlocked(message: QqbotNormalizedMessage) {
    const config = await this.configService.getPermissionConfig();
    if (!config.blocklistEnabled) return false;
    return this.existsMatched(this.blocklistRepository, message);
  }

  /**
   * 根据`message`与当前约束判定许可范围；从 `configService.getPermissionConfig` 读取许可范围。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 满足许可范围约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async isAllowed(message: QqbotNormalizedMessage) {
    const config = await this.configService.getPermissionConfig();
    if (!config.allowlistEnabled) return true;
    return this.existsMatched(this.allowlistRepository, message);
  }

  /**
   * 根据`repository`、`message`处理existsMatched；把变更持久化到当前存储（`repository.createQueryBuilder`）。
   * @param repository - 负责查询或持久化existsMatched的仓库实例。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `selfId`、`userId`、`messageType`、`targetId` 字段。
   * @returns 满足existsMatched约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 将`body`规范为请求内容，使等价输入得到一致表示。
   * @param body - 用于请求内容的结构化输入，包含 `targetType`、`targetId`、`userId`、`preciseUser` 字段。
   * @returns 包含 `enabled`、`preciseUser`、`remark`、`selfId`、`targetId` 字段的请求内容。
   */
  private normalizeBody(
    body: Partial<QqbotPermissionBodyDto>,
  ): Partial<QqbotPermissionEntity> {
    const targetType = (() => {
      if (body.targetType === 'private') {
        return 'qq';
      }
      return body.targetType;
    })();
    const normalizedTargetType = targetType || 'qq';
    const targetId = `${body.targetId || ''}`.trim();
    const userId = `${body.userId || ''}`.trim();
    const preciseUser =
      (() => {
        if (normalizedTargetType === 'group' || normalizedTargetType === 'channel') {
          return !!body.preciseUser;
        }
        return false;
      })();

    if (!targetId) {
      throwVbenError(
        (() => {
          if (normalizedTargetType === 'qq') {
            return '请填写 QQ 号';
          }
          if (normalizedTargetType === 'group') {
            return '请填写群号';
          }
          return '请填写频道 ID';
        })(),
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
      userId: (() => {
        if (preciseUser) {
          return userId;
        }
        return '';
      })(),
    } as Partial<QqbotPermissionEntity>;
  }

  /**
   * 按`kind`读取数据仓库；当 `kind === 'allowlist'` 成立时返回 `this.allowlistRepository`。
   * @param kind - 决定数据仓库内容、边界或目标的 `kind` 值。
   * @returns 数据仓库。
   */
  private getRepository(kind: QqbotPermissionKind) {
    if (kind === 'allowlist') {
      return this.allowlistRepository;
    }
    return this.blocklistRepository;
  }
}
