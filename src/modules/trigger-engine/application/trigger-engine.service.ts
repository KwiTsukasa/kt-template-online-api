import { BadRequestException, Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { DataSource } from 'typeorm';
import {
  DefinitionRepository,
  validateDefinitionInput,
} from '@/common/automation/definition.repository';
import {
  publishedReference,
  type PublishedReference,
} from '@/common/automation/definition.types';
import type {
  TriggerDefinition,
  TriggerEnginePort,
} from '../contract/trigger.types';
import {
  nextTriggerAt,
  normalizeTriggerDefinition,
} from '../domain/trigger.policy';
import {
  TriggerDraft,
  TriggerRevision,
} from '../infrastructure/persistence/trigger.entities';
import { TriggerEventRegistry } from './trigger-event.registry';
import type { DefinitionProvision } from '@/common/automation/definition-provision.port';

@Injectable()
export class TriggerEngineService implements TriggerEnginePort {
  readonly definitions: DefinitionRepository<TriggerDefinition>;

  constructor(
    database: DataSource,
    private readonly events: TriggerEventRegistry,
  ) {
    this.definitions = new DefinitionRepository(
      database,
      TriggerDraft,
      TriggerRevision,
      normalizeTriggerDefinition,
    );
  }

  /**
   * 由资源所属模块建立来源声明的首个发布版本，重启或重复同步不覆盖管理员编辑。
   * @param input - 集成声明的稳定来源键、默认配置和可选迁移身份。
   * @returns 已保留或新建的资源以及本次创建标志。
   */
  provision(input: DefinitionProvision<TriggerDefinition>) {
    return this.definitions.provision(input, async (definition) => {
      await this.checkForPublish(definition);
    });
  }

  /**
   * 发布前核对事件源的固定数据契约，防止将任意事件文本变成可执行订阅。
   * @param definition - 已规范化的触发器草稿。
   * @throws 事件源版本未加载或字段契约发生变化时拒绝发布和激活。
   */
  async checkForPublish(definition: TriggerDefinition): Promise<void> {
    const trigger = definition.trigger;
    if (trigger.type !== 'event') return;
    const source = this.events.resolve(trigger.eventKey, trigger.eventVersion);
    if (!source) throw new BadRequestException('事件源固定版本未加载');
    if (!isDeepStrictEqual(source.payloadSchema, trigger.payloadSchema))
      throw new BadRequestException('触发器字段与事件源契约不一致');
  }

  /**
   * 解析独立触发器的固定发布版本，不读取计划或任务数据。
   * @param reference - 触发器资源及版本。
   * @returns 固定的触发配置。
   */
  async resolve(reference: PublishedReference) {
    return this.definitions.published(
      validateDefinitionInput(() => publishedReference(reference)),
    );
  }

  /**
   * 按发布触发器和基准时间计算下一次发生时间，执行目标由消费方管理。
   * @param reference - 固定的触发器版本。
   * @param after - 本次计算的时间基准。
   * @returns 下一次发生时间；手动、事件或已过期单次触发返回空值。
   */
  async next(reference: PublishedReference, after: Date) {
    const definition = await this.resolve(reference);
    return nextTriggerAt(definition.trigger, after);
  }

  /**
   * 为触发器编辑页计算最多五次未来发生时间，不登记或派发任何任务。
   * @param input - 触发器草稿定义。
   * @param after - 预览计算使用的时间基准。
   * @returns 规范配置和可展示的未来时间。
   */
  preview(input: unknown, after = new Date()) {
    return validateDefinitionInput(() => {
      const definition = normalizeTriggerDefinition(input);
      const occurrences: string[] = [];
      let cursor = after;
      for (let index = 0; index < 5; index += 1) {
        const next = nextTriggerAt(definition.trigger, cursor);
        if (!next) break;
        occurrences.push(next.toISOString());
        cursor = next;
      }
      return { definition, occurrences };
    });
  }
}
