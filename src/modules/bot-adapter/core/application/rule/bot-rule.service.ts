import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { BotAccountService } from '../account/bot-account.service';
import { BotRule } from '../../infrastructure/persistence/rule/bot-rule.entity';
import type {
  BotRuleBodyDto,
  BotRuleQueryDto,
  BotRuleUpdateDto,
} from '../../contract/rule/bot-rule.dto';
import type {
  BotNormalizedMessage,
  BotRuleMatchType,
  BotRuleTargetType,
} from '../../contract/bot.types';
import {
  BOT_DEFAULT_PAGE_NO,
  BOT_DEFAULT_PAGE_SIZE,
} from '../../contract/bot.constants';
import { isWithinCooldown } from '../../domain/bot-cooldown.policy';

@Injectable()
export class BotRuleService {
  constructor(
    @InjectRepository(BotRule)
    private readonly ruleRepository: Repository<BotRule>,
    private readonly accountService: BotAccountService,
    private readonly toolsService: ToolsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 按自动回复规则查询条件筛选未删除记录并分页。
   * @param query - 限定按自动回复规则查询条件筛选未删除记录并分页筛选、排序与分页范围的查询条件，包含 `keyword`、`selfId`、`targetType`、`enabled` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的按自动回复规则查询条件筛选未删除记录并分页。
   */
  async page(query: BotRuleQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      BOT_DEFAULT_PAGE_NO,
      BOT_DEFAULT_PAGE_SIZE,
    );
    const builder = this.ruleRepository
      .createQueryBuilder('rule')
      .where('rule.isDeleted = :isDeleted', { isDeleted: false });

    if (query.keyword) {
      builder.andWhere(
        '(rule.name LIKE :keyword OR rule.keyword LIKE :keyword)',
        {
          keyword: `%${query.keyword}%`,
        },
      );
    }
    if (query.selfId) {
      const boundIds = await this.accountService.getBoundRuleIds(query.selfId);
      if (boundIds.length === 0) {
        return { list: [], pageNo, pageSize, total: 0 };
      }
      builder.andWhere('rule.id IN (:...boundIds)', { boundIds });
    }
    if (query.targetType) {
      builder.andWhere('rule.targetType = :targetType', {
        targetType: query.targetType,
      });
    }
    if (query.enabled !== undefined && `${query.enabled}` !== '') {
      builder.andWhere('rule.enabled = :enabled', {
        enabled: this.toolsService.normalizeBoolean(query.enabled),
      });
    }

    const [list, total] = await builder
      .orderBy('rule.priority', 'DESC')
      .addOrderBy('rule.createTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
    return {
      list,
      pageNo,
      pageSize,
      total,
    };
  }

  /**
   * 按`message`读取启用状态消息；把变更持久化到当前存储（`ruleRepository.createQueryBuilder`）。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `selfId`、`messageType` 字段。
   * @returns 启用状态消息。
   */
  async listEnabledForMessage(message: BotNormalizedMessage) {
    const boundIds = await this.accountService.getBoundRuleIds(message.selfId);
    if (boundIds.length === 0) return [];
    return this.ruleRepository
      .createQueryBuilder('rule')
      .where('rule.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('rule.enabled = :enabled', { enabled: true })
      .andWhere('rule.id IN (:...boundIds)', { boundIds })
      .andWhere('rule.targetType IN (:...targetTypes)', {
        targetTypes: ['all', message.messageType],
      })
      .orderBy('rule.priority', 'DESC')
      .addOrderBy('rule.createTime', 'ASC')
      .getMany();
  }

  /**
   * 根据`body`更新`save` 对应结果；把变更持久化到当前存储（`ruleRepository.save`）。
   * @param body - 用于`save` 对应结果的结构化输入，包含 `matchType`、`keyword` 字段。
   * @returns `save` 对应。
   */
  async save(body: BotRuleBodyDto) {
    this.assertRuleValid(body.matchType, body.keyword);
    const saved = await this.ruleRepository.save(
      this.ruleRepository.create(this.normalizeBody(body)),
    );
    return saved.id;
  }

  /**
   * 根据`body`更新`update` 对应结果；把变更持久化到当前存储（`ruleRepository.update`）。
   * @param body - 用于`update` 对应结果的结构化输入，包含 `matchType`、`keyword`、`id` 字段。
   * @returns 满足`update` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async update(body: BotRuleUpdateDto) {
    if (body.matchType || body.keyword) {
      this.assertRuleValid(body.matchType || 'keyword', body.keyword || '');
    }
    const payload = this.normalizeBody(body);
    delete (payload as any).id;
    await this.ruleRepository.update({ id: body.id }, payload);
    return true;
  }

  /**
   * 按自动回复规则标识设置软删除标记，写入完成后固定返回 `true`。
   * @param id - 决定按自动回复规则标识设置软删除标记，写入完成后固定返回 `true`内容、边界或目标的 `id` 值。
   * @returns 满足按自动回复规则标识设置软删除标记，写入完成后固定返回 `true`约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async remove(id: string) {
    await this.ruleRepository.update({ id }, { isDeleted: true });
    return true;
  }

  /**
   * 按自动回复规则标识更新启用状态，写入完成后固定返回 `true`。
   * @param id - 决定按自动回复规则标识更新启用状态，写入完成后固定返回 `true`内容、边界或目标的 `id` 值。
   * @param enabled - 决定按自动回复规则标识更新启用状态，写入完成后固定返回 `true`内容、边界或目标的 `enabled` 值。
   * @returns 满足按自动回复规则标识更新启用状态，写入完成后固定返回 `true`约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async toggle(id: string, enabled: boolean) {
    await this.ruleRepository.update({ id }, { enabled });
    return true;
  }

  /**
   * 按自动回复规则标识将最后命中时间更新为当前时间。
   * @param rule - 用于按自动回复规则标识将最后命中时间更新为当前时间的领域对象，包含 `id` 字段。
   */
  async markHit(rule: BotRule) {
    await this.ruleRepository.update(
      { id: rule.id },
      { lastHitAt: new Date() },
    );
  }

  /**
   * 根据`rule`、`message`与当前约束判定Matched；当 `rule.matchType === 'regex'` 成立时返回 `new RegExp(rule.keyword).test(source)`。
   * @param rule - 用于Matched的领域对象，包含 `matchType`、`keyword` 字段。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `messageText` 字段。
   * @returns 满足Matched约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isMatched(rule: BotRule, message: BotNormalizedMessage) {
    const source = message.messageText || '';
    if (!source) return false;

    if (rule.matchType === 'equals') return source === rule.keyword;
    if (rule.matchType === 'regex') {
      try {
        return new RegExp(rule.keyword).test(source);
      } catch {
        return false;
      }
    }
    return source.includes(rule.keyword);
  }

  /**
   * 通过 `isWithinCooldown` 判断输入是否满足函数约束。
   * @param rule - 用于冷却时间的领域对象，包含 `cooldownMs`、`lastHitAt` 字段。
   * @returns 满足冷却时间约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isInCooldown(rule: BotRule) {
    return isWithinCooldown({
      cooldownMs: rule.cooldownMs,
      lastHitAt: rule.lastHitAt,
      minCooldownMs: this.getMinCooldownMs(),
    });
  }

  /**
   * 校验`matchType`、`keyword`是否满足权限规则Valid约束，并拒绝不合法输入。
   * @param matchType - 决定权限规则Valid内容、边界或目标的 `matchType` 值。
   * @param keyword - 决定权限规则Valid内容、边界或目标的 `keyword` 值。
   */
  private assertRuleValid(matchType: BotRuleMatchType, keyword: string) {
    if (!keyword?.trim()) {
      throwVbenError('规则关键词不能为空');
    }
    if (matchType === 'regex') {
      try {
        new RegExp(keyword);
      } catch {
        throwVbenError('正则表达式不合法');
      }
    }
  }

  /**
   * 通过 `Math.max` 收敛数值边界。
   * @param body - 用于请求内容的结构化输入，包含 `cooldownMs`、`enabled`、`keyword`、`matchType` 字段。
   * @returns 包含 `cooldownMs`、`enabled`、`keyword`、`matchType`、`name` 字段的请求内容。
   */
  private normalizeBody(body: Partial<BotRuleBodyDto>) {
    return {
      cooldownMs: Math.max(
        Number(body.cooldownMs ?? this.getMinCooldownMs()),
        this.getMinCooldownMs(),
      ),
      enabled: body.enabled ?? true,
      keyword: body.keyword || '',
      matchType: (body.matchType || 'keyword') as BotRuleMatchType,
      name: body.name || body.keyword || '',
      priority: Number(body.priority || 0),
      remark: body.remark || '',
      replyContent: body.replyContent || '',
      targetType: (body.targetType || 'all') as BotRuleTargetType,
    } as Partial<BotRule>;
  }

  /**
   * 按当前运行态读取Min冷却时间Ms；当 `Number.isInteger(value) && value > 0` 成立时返回 `value`。
   * @returns 当前状态对应的Min冷却时间Ms，取值为 `30000`。
   */
  private getMinCooldownMs() {
    const value = Number(this.configService.get('BOT_RULE_MIN_COOLDOWN_MS'));
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    return 30000;
  }
}
