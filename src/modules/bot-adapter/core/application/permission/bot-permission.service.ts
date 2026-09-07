import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Not, Repository, type FindOptionsWhere } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { BotAllowlist } from '../../infrastructure/persistence/permission/bot-allowlist.entity';
import { BotBlocklist } from '../../infrastructure/persistence/permission/bot-blocklist.entity';
import type {
  BotPermissionBodyDto,
  BotPermissionConfigDto,
  BotPermissionQueryDto,
  BotPermissionUpdateDto,
} from '../../contract/permission/bot-permission.dto';
import { BotConfigService } from '../config/bot-config.service';
import {
  BOT_DEFAULT_PAGE_NO,
  BOT_DEFAULT_PAGE_SIZE,
} from '../../contract/bot.constants';
import type {
  BotNormalizedMessage,
  BotPermissionEntity,
  BotPermissionKind,
} from '../../contract/bot.types';

@Injectable()
export class BotPermissionService {
  constructor(
    private readonly configService: BotConfigService,
    @InjectRepository(BotAllowlist)
    private readonly allowlistRepository: Repository<BotAllowlist>,
    @InjectRepository(BotBlocklist)
    private readonly blocklistRepository: Repository<BotBlocklist>,
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
   * 将 Bot 权限请求交给配置服务持久化，并返回更新后的权限配置。
   * @param body - 用于配置的结构化输入。
   * @returns 配置。
   */
  async updateConfig(body: BotPermissionConfigDto) {
    return this.configService.updatePermissionConfig(body);
  }

  /**
   * 筛选未删除的白名单或黑名单；普通视图分页，树表视图读取完整筛选结果供账号分组。
   * @param kind - 决定根据白名单或黑名单类型选择仓库，按查询条件筛选未删除记录并分页内容、边界或目标的 `kind` 值。
   * @param query - 限定根据白名单或黑名单类型选择仓库，按查询条件筛选未删除记录并分页筛选、排序与分页范围的查询条件，包含 `selfId`、`targetType`、`targetId`、`userId` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的根据白名单或黑名单类型选择仓库，按查询条件筛选未删除记录并分页。
   */
  async page(kind: BotPermissionKind, query: BotPermissionQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      BOT_DEFAULT_PAGE_NO,
      BOT_DEFAULT_PAGE_SIZE,
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
      builder.andWhere(
        `(JSON_CONTAINS(permission.userIds, JSON_QUOTE(:selectedUserId))
        OR (permission.userIds IS NULL AND permission.userId = :selectedUserId))`,
        {
          selectedUserId: query.userId,
        },
      );
    }
    if (query.preciseUser !== undefined && `${query.preciseUser}` !== '') {
      builder.andWhere('permission.preciseUser = :preciseUser', {
        preciseUser: this.toolsService.normalizeBoolean(query.preciseUser),
      });
    }

    builder.orderBy('permission.createTime', 'DESC');
    if (query.view !== 'tree') builder.skip(skip).take(pageSize);
    const [list, total] = await builder.getManyAndCount();
    return { list, pageNo, pageSize, total };
  }

  /**
   * 同一账号的群或频道及多选成员只创建一个实体，成员数量不会增加名单记录数。
   * @param kind - 要写入的白名单或黑名单类型。
   * @param body - 同一账号与会话的名单配置，可包含精确用户数组。
   * @returns 新增名单记录的标识。
   */
  async save(kind: BotPermissionKind, body: BotPermissionBodyDto) {
    const repository = this.getRepository(kind);
    const payload = this.normalizeBody(body);
    await this.assertConversationAvailable(repository, payload);
    const saved = await repository.save(
      repository.create(payload as BotPermissionEntity),
    );
    return saved.id;
  }

  /**
   * 用当前名单标识覆盖成员集合，移除取消勾选的成员并保持记录身份不变。
   * @param kind - 当前规则所属的白名单或黑名单类型。
   * @param body - 当前规则标识与更新后的账号、会话及用户选择。
   * @returns 更新成功后返回 true。
   */
  async update(kind: BotPermissionKind, body: BotPermissionUpdateDto) {
    const repository = this.getRepository(kind);
    const payload = this.normalizeBody(body);
    await this.assertConversationAvailable(repository, payload, body.id);
    await repository.update({ id: body.id }, payload);
    return true;
  }

  /**
   * 按`kind`、`id`移除`remove` 对应结果；把变更持久化到当前存储（`repository.update`）。
   * @param kind - 决定`remove` 对应结果内容、边界或目标的 `kind` 值。
   * @param id - 决定`remove` 对应结果内容、边界或目标的 `id` 值。
   * @returns 满足`remove` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async remove(kind: BotPermissionKind, id: string) {
    const repository = this.getRepository(kind);
    await repository.update({ id } as any, { isDeleted: true } as any);
    return true;
  }

  /**
   * 根据`message`与当前约束判定Blocked；从 `configService.getPermissionConfig` 读取Blocked。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 满足Blocked约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async isBlocked(message: BotNormalizedMessage) {
    const config = await this.configService.getPermissionConfig();
    if (!config.blocklistEnabled) return false;
    return this.existsMatched(this.blocklistRepository, message);
  }

  /**
   * 根据`message`与当前约束判定许可范围；从 `configService.getPermissionConfig` 读取许可范围。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 满足许可范围约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async isAllowed(message: BotNormalizedMessage) {
    const config = await this.configService.getPermissionConfig();
    if (!config.allowlistEnabled) return true;
    return this.existsMatched(this.allowlistRepository, message);
  }

  /**
   * 在当前账号和全局规则中匹配启用的目标；群和频道精确规则按成员集合匹配，并兼容旧单成员记录。
   * @param repository - 当前白名单或黑名单的持久化仓库。
   * @param message - 包含账号、会话类型、会话标识及发送者身份的标准消息。
   * @returns 存在符合目标及成员约束的启用规则时返回 true。
   */
  private async existsMatched(
    repository: Repository<BotPermissionEntity>,
    message: BotNormalizedMessage,
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
                  OR (permission.preciseUser = :precise AND (
                    JSON_CONTAINS(permission.userIds, JSON_QUOTE(:userId))
                    OR (permission.userIds IS NULL AND permission.userId = :userId)
                  ))
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
                  OR (permission.preciseUser = :precise AND (
                    JSON_CONTAINS(permission.userIds, JSON_QUOTE(:userId))
                    OR (permission.userIds IS NULL AND permission.userId = :userId)
                  ))
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
   * 兼容旧单成员输入并生成去重成员数组；非群聊、非频道目标强制关闭精确匹配。
   * @param body - 单条名单的目标与成员选择，兼容旧版单成员字段。
   * @returns 可持久化为一条规则的账号、目标、开关和成员集合。
   */
  private normalizeBody(
    body: Partial<BotPermissionBodyDto>,
  ): Partial<BotPermissionEntity> {
    const targetType = (() => {
      if (body.targetType === 'private') {
        return 'qq';
      }
      return body.targetType;
    })();
    const normalizedTargetType = targetType || 'qq';
    const targetId = `${body.targetId || ''}`.trim();
    const userId = `${body.userId || ''}`.trim();
    const preciseUser = (() => {
      if (
        normalizedTargetType === 'group' ||
        normalizedTargetType === 'channel'
      ) {
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
    let userIds: string[] = [];
    if (preciseUser) {
      let selected = body.userIds;
      if (selected === undefined) selected = [userId].filter(Boolean);
      if (
        !Array.isArray(selected) ||
        selected.length === 0 ||
        selected.length > 100 ||
        selected.some(
          (value) =>
            typeof value !== 'string' || !/^[\w-]{1,64}$/u.test(value.trim()),
        )
      ) {
        throwVbenError('请选择 1 至 100 个有效的精确用户');
      }
      userIds = [...new Set(selected.map((value) => value.trim()))];
    }

    return {
      enabled: body.enabled ?? true,
      preciseUser,
      remark: body.remark || '',
      selfId: body.selfId || '',
      targetId,
      targetType: normalizedTargetType,
      userId: '',
      userIds,
    } as Partial<BotPermissionEntity>;
  }

  /**
   * 拒绝在同一账号、同一种名单中重复新增群或频道，引导管理员修改已有记录的成员集合。
   * @param repository - 当前白名单或黑名单仓库。
   * @param payload - 已规范化的账号与会话身份。
   * @param editingId - 更新时排除的当前名单标识。
   */
  private async assertConversationAvailable(
    repository: Repository<BotPermissionEntity>,
    payload: Partial<BotPermissionEntity>,
    editingId?: string,
  ) {
    if (payload.targetType !== 'group' && payload.targetType !== 'channel')
      return;
    const where: FindOptionsWhere<BotPermissionEntity> = {
      isDeleted: false,
      selfId: payload.selfId,
      targetId: payload.targetId,
      targetType: payload.targetType,
    };
    if (editingId) where.id = Not(editingId);
    if (await repository.exists({ where })) {
      throwVbenError('该账号的群或频道已有名单，请编辑原有记录的成员选择');
    }
  }

  /**
   * 按`kind`读取数据仓库；当 `kind === 'allowlist'` 成立时返回 `this.allowlistRepository`。
   * @param kind - 决定数据仓库内容、边界或目标的 `kind` 值。
   * @returns 数据仓库。
   */
  private getRepository(kind: BotPermissionKind) {
    if (kind === 'allowlist') {
      return this.allowlistRepository;
    }
    return this.blocklistRepository;
  }
}
