import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { QqbotAccountService } from '../account/qqbot-account.service';
import { QqbotRule } from './qqbot-rule.entity';
import type {
  QqbotRuleBodyDto,
  QqbotRuleQueryDto,
  QqbotRuleUpdateDto,
} from './qqbot-rule.dto';
import type {
  QqbotNormalizedMessage,
  QqbotRuleMatchType,
  QqbotRuleTargetType,
} from '../qqbot.types';
import { getPageParams, normalizeBoolean } from '../qqbot.utils';

@Injectable()
export class QqbotRuleService {
  constructor(
    @InjectRepository(QqbotRule)
    private readonly ruleRepository: Repository<QqbotRule>,
    private readonly accountService: QqbotAccountService,
  ) {}

  async page(query: QqbotRuleQueryDto) {
    const { pageNo, pageSize, skip } = getPageParams(query);
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
        enabled: normalizeBoolean(query.enabled),
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

  async save(body: QqbotRuleBodyDto) {
    this.assertRuleValid(body.matchType, body.keyword);
    const saved = await this.ruleRepository.save(
      this.ruleRepository.create(this.normalizeBody(body)),
    );
    return saved.id;
  }

  async update(body: QqbotRuleUpdateDto) {
    if (body.matchType || body.keyword) {
      this.assertRuleValid(body.matchType || 'keyword', body.keyword || '');
    }
    const payload = this.normalizeBody(body);
    delete (payload as any).id;
    await this.ruleRepository.update({ id: body.id }, payload);
    return true;
  }

  async remove(id: string) {
    await this.ruleRepository.update({ id }, { isDeleted: true });
    return true;
  }

  async toggle(id: string, enabled: boolean) {
    await this.ruleRepository.update({ id }, { enabled });
    return true;
  }

  async markHit(rule: QqbotRule) {
    await this.ruleRepository.update(
      { id: rule.id },
      { lastHitAt: new Date() },
    );
  }

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

  isInCooldown(rule: QqbotRule) {
    if (!rule.lastHitAt || !rule.cooldownMs) return false;
    return Date.now() - new Date(rule.lastHitAt).getTime() < rule.cooldownMs;
  }

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

  private normalizeBody(body: Partial<QqbotRuleBodyDto>) {
    return {
      cooldownMs: Number(body.cooldownMs ?? 1500),
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
}
