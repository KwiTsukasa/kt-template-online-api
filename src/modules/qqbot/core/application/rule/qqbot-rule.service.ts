import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { QqbotAccountService } from '../account/qqbot-account.service';
import { QqbotRule } from '../../infrastructure/persistence/rule/qqbot-rule.entity';
import type {
  QqbotRuleBodyDto,
  QqbotRuleQueryDto,
  QqbotRuleUpdateDto,
} from '../../contract/rule/qqbot-rule.dto';
import type {
  QqbotNormalizedMessage,
  QqbotRuleMatchType,
  QqbotRuleTargetType,
} from '../../contract/qqbot.types';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../../contract/qqbot.constants';
import { isWithinCooldown } from '../../domain/qqbot-cooldown.policy';

@Injectable()
export class QqbotRuleService {
  /**
   * 初始化 QqbotRuleService 实例。
   * @param ruleRepository - QQBot仓库依赖；影响 constructor 的返回值。
   * @param accountService - accountService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(QqbotRule)
    private readonly ruleRepository: Repository<QqbotRule>,
    private readonly accountService: QqbotAccountService,
    private readonly toolsService: ToolsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 获取分页数据。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  async page(query: QqbotRuleQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      QQBOT_DEFAULT_PAGE_NO,
      QQBOT_DEFAULT_PAGE_SIZE,
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
   * 列出Enabled For Message。
   * @param message - message 输入；使用 `selfId`、`messageType` 字段生成结果。
   */
  async listEnabledForMessage(message: QqbotNormalizedMessage) {
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
   * 保存数据。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async save(body: QqbotRuleBodyDto) {
    this.assertRuleValid(body.matchType, body.keyword);
    const saved = await this.ruleRepository.save(
      this.ruleRepository.create(this.normalizeBody(body)),
    );
    return saved.id;
  }

  /**
   * 更新数据。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async update(body: QqbotRuleUpdateDto) {
    if (body.matchType || body.keyword) {
      this.assertRuleValid(body.matchType || 'keyword', body.keyword || '');
    }
    const payload = this.normalizeBody(body);
    delete (payload as any).id;
    await this.ruleRepository.update({ id: body.id }, payload);
    return true;
  }

  /**
   * 删除数据。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
  async remove(id: string) {
    await this.ruleRepository.update({ id }, { isDeleted: true });
    return true;
  }

  /**
   * 执行 QQBot 核心流程。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   * @param enabled - enabled 输入；影响 toggle 的返回值。
   */
  async toggle(id: string, enabled: boolean) {
    await this.ruleRepository.update({ id }, { enabled });
    return true;
  }

  /**
   * 执行 QQBot 核心流程。
   * @param rule - rule 输入；使用 `id` 字段生成结果。
   */
  async markHit(rule: QqbotRule) {
    await this.ruleRepository.update(
      { id: rule.id },
      { lastHitAt: new Date() },
    );
  }

  /**
   * 判断 QQBot 核心条件。
   * @param rule - rule 输入；使用 `matchType`、`keyword` 字段计算判断结果。
   * @param message - message 输入；使用 `messageText` 字段计算判断结果。
   */
  isMatched(rule: QqbotRule, message: QqbotNormalizedMessage) {
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
   * 判断 QQBot 核心条件。
   * @param rule - rule 输入；使用 `cooldownMs`、`lastHitAt` 字段计算判断结果。
   */
  isInCooldown(rule: QqbotRule) {
    return isWithinCooldown({
      cooldownMs: rule.cooldownMs,
      lastHitAt: rule.lastHitAt,
      minCooldownMs: this.getMinCooldownMs(),
    });
  }

  /**
   * 执行 QQBot 核心流程。
   * @param matchType - matchType 输入；决定 QQBot条件分支。
   * @param keyword - keyword 输入；驱动 `RegExp()` 的 QQBot步骤。
   */
  private assertRuleValid(matchType: QqbotRuleMatchType, keyword: string) {
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
   * 转换 QQBot 核心输入。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  private normalizeBody(body: Partial<QqbotRuleBodyDto>) {
    return {
      cooldownMs: Math.max(
        Number(body.cooldownMs ?? this.getMinCooldownMs()),
        this.getMinCooldownMs(),
      ),
      enabled: body.enabled ?? true,
      keyword: body.keyword || '',
      matchType: (body.matchType || 'keyword') as QqbotRuleMatchType,
      name: body.name || body.keyword || '',
      priority: Number(body.priority || 0),
      remark: body.remark || '',
      replyContent: body.replyContent || '',
      targetType: (body.targetType || 'all') as QqbotRuleTargetType,
    } as Partial<QqbotRule>;
  }

  /**
   * 查询 QQBot 核心数据。
   */
  private getMinCooldownMs() {
    const value = Number(this.configService.get('QQBOT_RULE_MIN_COOLDOWN_MS'));
    return Number.isInteger(value) && value > 0 ? value : 30000;
  }
}
