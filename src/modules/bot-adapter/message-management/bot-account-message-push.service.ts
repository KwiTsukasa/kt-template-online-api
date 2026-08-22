import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { throwVbenError } from '@/common';
import { In, Repository, type EntityManager } from 'typeorm';
import {
  type BotMessagePublishBindingInput,
  type BotMessagePublishBindingView,
  type BotMessagePublishTargetInput,
  type BotMessagePublishTargetView,
  type BotMessagePushTargetType,
} from './bot-message-subscriber.types';
import { SystemMessageContractError } from '@/modules/message-management/contract/message-management.types';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import { BotMessagePublishBinding } from './bot-message-publish-binding.entity';
import { BotMessagePublishTarget } from './bot-message-publish-target.entity';
import { BotMessageDelivery } from './bot-message-delivery.entity';
import { MessageBindingProtocolService } from '@/modules/message-management/application/message-binding-protocol.service';
import type { BotConnectionMode } from '@/modules/bot-adapter/core/contract/bot.types';

const NAPCAT_TARGET_ID_PATTERN = /^[1-9]\d{4,19}$/;
const OFFICIAL_TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BOT_SUBSCRIBER_KEY = 'bot';

type NormalizedTarget = {
  targetId: string;
  targetName: null | string;
  targetType: BotMessagePushTargetType;
};

@Injectable()
export class BotAccountMessagePushService {
  constructor(
    @InjectRepository(BotMessagePublishBinding)
    private readonly bindingRepository: Repository<BotMessagePublishBinding>,
    @InjectRepository(BotMessagePublishTarget)
    private readonly targetRepository: Repository<BotMessagePublishTarget>,
    private readonly accountService: BotAccountService,
    private readonly bindingProtocol: MessageBindingProtocolService,
  ) {}

  /**
   * 按`selfId`读取绑定；先通过 `requireAccount` 校验输入边界。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 返回账号当前消息推送绑定视图列表或对应成功响应。
   */
  async listBindings(selfId: string): Promise<BotMessagePublishBindingView[]> {
    const account = await this.requireAccount(selfId);
    const bindings = await this.bindingRepository.find({
      order: { createTime: 'ASC', id: 'ASC' },
      where: { accountId: String(account.id), isDeleted: false },
    });
    return Promise.all(bindings.map((binding) => this.toView(binding)));
  }

  /**
   * 根据`selfId`、`input`构造绑定；先通过 `requireAccount` 校验输入边界。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param input - 仅包含通用订阅、启用状态和 Bot 私有目标的绑定输入。
   * @returns 返回新建的消息推送绑定视图或对应成功响应。
   * @throws 当 `bindingRepository.manager.transaction` 或 `toView` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  async createBinding(
    selfId: string,
    input: BotMessagePublishBindingInput,
  ): Promise<BotMessagePublishBindingView> {
    const account = await this.requireAccount(selfId);
    const normalizedTargets = this.normalizeTargets(
      input.targets,
      account.connectionMode,
    );
    try {
      const binding = await this.bindingRepository.manager.transaction(
        async (manager) => {
          const bindings = manager.getRepository(BotMessagePublishBinding);
          const activeKey = this.bindingActiveKey(
            account.id,
            input.subscriptionId,
          );
          const active = await bindings.findOne({
            where: { activeKey, isDeleted: false },
          });
          if (active) this.throwNaturalKeyConflict();
          const historicalCandidate = await bindings.findOne({
            order: { updateTime: 'DESC', id: 'DESC' },
            where: {
              accountId: String(account.id),
              isDeleted: true,
              subscriptionId: input.subscriptionId,
            },
          });
          await this.bindingProtocol.requireAvailable(
            manager,
            input.subscriptionId,
            BOT_SUBSCRIBER_KEY,
            input.enabled,
          );
          let binding: BotMessagePublishBinding;
          if (historicalCandidate) {
            const historical = await bindings.findOne({
              lock: { mode: 'pessimistic_write' },
              where: {
                accountId: String(account.id),
                id: historicalCandidate.id,
                isDeleted: true,
                selfId: String(account.selfId),
                subscriptionId: String(input.subscriptionId),
              },
            });
            if (historical) {
              Object.assign(
                historical,
                this.toBindingFields(account, input, activeKey),
                {
                  isDeleted: false,
                },
              );
              binding = await bindings.save(historical);
            } else {
              binding = await bindings.save(
                bindings.create({
                  ...this.toBindingFields(account, input, activeKey),
                  isDeleted: false,
                }),
              );
            }
          } else {
            binding = await bindings.save(
              bindings.create({
                ...this.toBindingFields(account, input, activeKey),
                isDeleted: false,
              }),
            );
          }
          await this.synchronizeTargets(manager, binding, normalizedTargets);
          return binding;
        },
      );
      return this.toView(binding);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwNaturalKeyConflict();
      throw error;
    }
  }

  /**
   * 根据`selfId`、`id`、`input`更新绑定；先通过 `requireAccount` 校验输入边界。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param id - 决定绑定内容、边界或目标的 `id` 值。
   * @param input - 用于完整替换通用订阅、启用状态和 Bot 私有目标的绑定输入。
   * @returns 返回更新后的消息推送绑定视图或对应成功响应。
   * @throws 当 `bindingRepository.manager.transaction` 或 `toView` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  async updateBinding(
    selfId: string,
    id: string,
    input: BotMessagePublishBindingInput,
  ): Promise<BotMessagePublishBindingView> {
    const account = await this.requireAccount(selfId);
    const normalizedTargets = this.normalizeTargets(
      input.targets,
      account.connectionMode,
    );
    try {
      const binding = await this.bindingRepository.manager.transaction(
        async (manager) => {
          const bindings = manager.getRepository(BotMessagePublishBinding);
          const snapshot = await bindings.findOne({
            where: { accountId: String(account.id), id, isDeleted: false },
          });
          if (!snapshot) this.throwBindingUnavailable();
          await this.bindingProtocol.requireAvailable(
            manager,
            input.subscriptionId,
            BOT_SUBSCRIBER_KEY,
            input.enabled,
          );
          const current = await this.findBindingForWrite(
            bindings,
            account.id,
            id,
          );
          this.assertStableBindingSnapshot(current, snapshot!);
          const activeKey = this.bindingActiveKey(
            account.id,
            input.subscriptionId,
          );
          const conflict = await bindings.findOne({
            where: { activeKey, isDeleted: false },
          });
          if (conflict && String(conflict.id) !== String(current.id)) {
            this.throwNaturalKeyConflict();
          }
          Object.assign(
            current,
            this.toBindingFields(account, input, activeKey),
          );
          const saved = await bindings.save(current);
          await this.synchronizeTargets(manager, saved, normalizedTargets);
          if (
            !saved.enabled ||
            snapshot!.subscriptionId !== saved.subscriptionId
          ) {
            await this.cancelUnfinishedDeliveries(manager, {
              bindingId: saved.id,
            });
          }
          return saved;
        },
      );
      return this.toView(binding);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwNaturalKeyConflict();
      throw error;
    }
  }

  /**
   * 根据`selfId`、`id`、`enabled`更新绑定启用；先通过 `requireAccount` 校验输入边界。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param id - 决定绑定启用内容、边界或目标的 `id` 值。
   * @param enabled - 决定绑定启用内容、边界或目标的 `enabled` 值。
   * @returns 绑定启用。
   */
  async setBindingEnabled(
    selfId: string,
    id: string,
    enabled: boolean,
  ): Promise<BotMessagePublishBindingView> {
    const account = await this.requireAccount(selfId);
    const binding = await this.bindingRepository.manager.transaction(
      async (manager) => {
        const bindings = manager.getRepository(BotMessagePublishBinding);
        const snapshot = await bindings.findOne({
          where: { accountId: String(account.id), id, isDeleted: false },
        });
        if (!snapshot) this.throwBindingUnavailable();
        await this.bindingProtocol.requireAvailable(
          manager,
          snapshot!.subscriptionId,
          BOT_SUBSCRIBER_KEY,
          enabled,
        );
        const current = await this.findBindingForWrite(
          bindings,
          account.id,
          id,
        );
        this.assertStableBindingSnapshot(current, snapshot!);
        current.enabled = enabled;
        const saved = await bindings.save(current);
        if (!saved.enabled) {
          await this.cancelUnfinishedDeliveries(manager, {
            bindingId: saved.id,
          });
        }
        return saved;
      },
    );
    return this.toView(binding);
  }

  /**
   * 按`selfId`、`id`移除绑定；先通过 `requireAccount` 校验输入边界。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param id - 决定绑定内容、边界或目标的 `id` 值。
   * @returns 返回删除绑定后的成功响应。
   */
  async removeBinding(selfId: string, id: string): Promise<boolean> {
    const account = await this.requireAccount(selfId);
    await this.bindingRepository.manager.transaction(async (manager) => {
      const bindings = manager.getRepository(BotMessagePublishBinding);
      const targets = manager.getRepository(BotMessagePublishTarget);
      const binding = await this.findBindingForWrite(bindings, account.id, id);
      const activeTargets = await targets.find({
        lock: { mode: 'pessimistic_write' },
        where: { bindingId: String(binding.id), isDeleted: false },
      });
      activeTargets.forEach((target) => {
        target.activeKey = null;
        target.enabled = false;
        target.isDeleted = true;
      });
      if (activeTargets.length > 0) await targets.save(activeTargets);
      binding.activeKey = null;
      binding.enabled = false;
      binding.isDeleted = true;
      await bindings.save(binding);
      await this.cancelUnfinishedDeliveries(manager, { bindingId: binding.id });
    });
    return true;
  }

  /**
   * 按账号 transport 规范目标：NapCat 只接受数字 QQ/群号，官方模式接受 OpenID。
   * @param inputs - 决定目标内容、边界或目标的 `inputs` 值。
   * @param connectionMode - 当前账号接入方式，决定目标 ID 合同。
   * @returns 按输入顺序得到的目标列表；没有匹配项时为空数组。
   */
  private normalizeTargets(
    inputs: BotMessagePublishTargetInput[],
    connectionMode: BotConnectionMode = 'reverse-ws',
  ): NormalizedTarget[] {
    const targets = new Map<string, NormalizedTarget>();
    inputs.forEach((input) => {
      const targetId = String(input.targetId ?? '').trim();
      const targetIdPattern = (() => {
        if (connectionMode === 'reverse-ws') {
          return NAPCAT_TARGET_ID_PATTERN;
        }
        return OFFICIAL_TARGET_ID_PATTERN;
      })();
      if (!targetIdPattern.test(targetId)) {
        throw new SystemMessageContractError('invalid_target_id');
      }
      if (input.targetType !== 'group' && input.targetType !== 'private') {
        throw new SystemMessageContractError('invalid_target_type');
      }
      const target: NormalizedTarget = {
        targetId,
        targetName: input.targetName?.trim() || null,
        targetType: input.targetType,
      };
      targets.set(`${target.targetType}:${target.targetId}`, target);
    });
    return [...targets.values()].sort((left, right) =>
      this.targetActiveKey('0', left).localeCompare(
        this.targetActiveKey('0', right),
      ),
    );
  }

  /**
   * 按期望集合增删并同步目标。
   * @param manager - 保证按期望集合增删并同步目标读写处于同一事务中的实体管理器。
   * @param binding - 用于按期望集合增删并同步目标的领域对象，包含 `id` 字段。
   * @param selected - 决定按期望集合增删并同步目标内容、边界或目标的 `selected` 值。
   */
  private async synchronizeTargets(
    manager: EntityManager,
    binding: BotMessagePublishBinding,
    selected: NormalizedTarget[],
  ): Promise<void> {
    const targets = manager.getRepository(BotMessagePublishTarget);
    const existing = await targets.find({
      lock: { mode: 'pessimistic_write' },
      order: { createTime: 'ASC', id: 'ASC' },
      where: { bindingId: String(binding.id) },
    });
    const selectedByKey = new Map(
      selected.map((target) => [
        this.targetActiveKey(binding.id, target),
        target,
      ]),
    );
    const historicalByKey = new Map(
      existing
        .filter((target) => target.isDeleted)
        .map((target) => [this.targetActiveKey(binding.id, target), target]),
    );
    const activeByKey = new Map(
      existing
        .filter((target) => !target.isDeleted)
        .map((target) => [this.targetActiveKey(binding.id, target), target]),
    );
    const saves: BotMessagePublishTarget[] = [];
    selectedByKey.forEach((target, activeKey) => {
      const current =
        activeByKey.get(activeKey) ?? historicalByKey.get(activeKey);
      if (current) {
        Object.assign(current, {
          activeKey,
          enabled: true,
          isDeleted: false,
          targetName: target.targetName,
        });
        saves.push(current);
      } else {
        saves.push(
          targets.create({
            activeKey,
            bindingId: String(binding.id),
            enabled: true,
            isDeleted: false,
            targetId: target.targetId,
            targetName: target.targetName,
            targetType: target.targetType,
          }),
        );
      }
    });
    activeByKey.forEach((target, activeKey) => {
      if (selectedByKey.has(activeKey)) return;
      Object.assign(target, {
        activeKey: null,
        enabled: false,
        isDeleted: true,
      });
      saves.push(target);
    });
    if (saves.length > 0) await targets.save(saves);
    const removedIds = saves
      .filter((target) => target.isDeleted)
      .map((target) => target.id);
    if (removedIds.length > 0) {
      await manager.getRepository(BotMessageDelivery).update(
        {
          publishTargetId: In(removedIds),
          status: In(['pending', 'retry']),
        },
        {
          nextAttemptAt: null,
          processingLeaseUntil: null,
          status: 'cancelled',
        },
      );
    }
  }

  /**
   * 将输入收敛并投影为视图。
   * @param binding - 仅保存通用订阅和 Bot 账号身份的私有绑定。
   * @returns 包含 `available`、`createTime`、`enabled`、`id`、`invalidReasonCode` 字段的视图。
   */
  private async toView(
    binding: BotMessagePublishBinding,
  ): Promise<BotMessagePublishBindingView> {
    const [state, targets] = await Promise.all([
      this.bindingProtocol.inspect(
        this.bindingRepository.manager,
        binding.subscriptionId,
        BOT_SUBSCRIBER_KEY,
      ),
      this.targetRepository.find({
        order: { createTime: 'ASC', id: 'ASC' },
        where: { bindingId: String(binding.id), isDeleted: false },
      }),
    ]);
    return {
      available: state.available,
      createTime: String(binding.createTime),
      enabled: binding.enabled,
      id: String(binding.id),
      invalidReasonCode: state.invalidReasonCode,
      sourceKey: state.sourceKey,
      sourceName: state.sourceName,
      subscriptionId: String(binding.subscriptionId),
      subscriptionName: state.subscriptionName,
      targets: targets.map((target) => this.toTargetView(target)),
      templates: state.templates.map((template) => ({ ...template })),
      updateTime: String(binding.updateTime),
    };
  }

  /**
   * 将输入收敛并投影为目标视图。
   * @param target - 用于目标视图的领域对象，包含 `enabled`、`id`、`targetId`、`targetName` 字段。
   * @returns 包含 `enabled`、`id`、`targetId`、`targetName`、`targetType` 字段的目标视图。
   */
  private toTargetView(
    target: BotMessagePublishTarget,
  ): BotMessagePublishTargetView {
    return {
      enabled: target.enabled,
      id: String(target.id),
      targetId: String(target.targetId),
      targetName: target.targetName?.trim() || null,
      targetType: target.targetType,
    };
  }

  /**
   * 校验`selfId`是否满足前置条件并返回必需账号约束，并拒绝不合法输入；从 `accountService.findBySelfId` 读取前置条件并返回必需账号。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 前置条件并返回必需账号。
   * @throws 当 `!account` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  private async requireAccount(selfId: string) {
    const account = await this.accountService.findBySelfId(selfId);
    if (!account) throw new SystemMessageContractError('account_unavailable');
    return account;
  }

  /**
   * 按`repository`、`accountId`、`id`读取绑定用于写入；从 `repository.findOne` 读取绑定用于写入。
   * @param repository - 负责查询或持久化绑定用于写入的仓库实例。
   * @param accountId - 用于精确定位账号的标识。
   * @param id - 决定绑定用于写入内容、边界或目标的 `id` 值。
   * @returns 绑定用于写入。
   */
  private async findBindingForWrite(
    repository: Repository<BotMessagePublishBinding>,
    accountId: string,
    id: string,
  ): Promise<BotMessagePublishBinding> {
    const binding = await repository.findOne({
      lock: { mode: 'pessimistic_write' },
      where: { accountId: String(accountId), id, isDeleted: false },
    });
    if (!binding) this.throwBindingUnavailable();
    return binding!;
  }

  /**
   * 校验`binding`、`snapshot`是否满足稳定的账号快照约束，并拒绝不合法输入。
   * @param binding - 用于稳定的账号快照的领域对象，包含 `accountId`、`selfId` 字段。
   * @param snapshot - 用于稳定的账号快照的领域对象，包含 `accountId`、`selfId` 字段。
   */
  private assertStableAccountSnapshot(
    binding: BotMessagePublishBinding,
    snapshot: BotMessagePublishBinding,
  ): void {
    if (
      binding.accountId !== snapshot.accountId ||
      binding.selfId !== snapshot.selfId
    ) {
      this.throwBindingUnavailable();
    }
  }

  /**
   * 校验`binding`、`snapshot`是否满足稳定的绑定快照约束，并拒绝不合法输入；先通过 `assertStableAccountSnapshot` 校验输入边界。
   * @param binding - 事务锁定后读取的 Bot 私有绑定。
   * @param snapshot - 事务开始前读取的账号与通用订阅身份快照。
   */
  private assertStableBindingSnapshot(
    binding: BotMessagePublishBinding,
    snapshot: BotMessagePublishBinding,
  ): void {
    this.assertStableAccountSnapshot(binding, snapshot);
    if (binding.subscriptionId !== snapshot.subscriptionId) {
      this.throwBindingUnavailable();
    }
  }

  /**
   * 根据`accountId`、`subscriptionId`拼接稳定的绑定启用的键，用于隔离对应资源或存储记录。
   * @param accountId - 用于精确定位账号的标识。
   * @param subscriptionId - 用于精确定位订阅的标识。
   * @returns 按参数编码并拼接完成的绑定启用的键。
   */
  private bindingActiveKey(accountId: string, subscriptionId: string): string {
    return `${String(accountId)}:${String(subscriptionId)}`;
  }

  /**
   * 根据`bindingId`、`target`拼接稳定的目标启用的键，用于隔离对应资源或存储记录。
   * @param bindingId - 用于精确定位绑定的标识。
   * @param target - 用于目标启用的键的领域对象，包含 `targetType`、`targetId` 字段。
   * @returns 按参数编码并拼接完成的目标启用的键。
   */
  private targetActiveKey(
    bindingId: string,
    target: Pick<NormalizedTarget, 'targetId' | 'targetType'>,
  ): string {
    return `${String(bindingId)}:${target.targetType}:${target.targetId}`;
  }

  /**
   * 将输入收敛并投影为绑定字段。
   * @param account - 用于字段的领域对象，包含 `id`、`selfId` 字段。
   * @param input - 只含启用状态、通用订阅和 Bot 私有目标的输入。
   * @param activeKey - 用于读取或更新字段的稳定键。
   * @returns 包含 `accountId`、`activeKey`、`enabled`、`selfId`、`subscriptionId` 字段的字段。
   */
  private toBindingFields(
    account: { id: string; selfId: string },
    input: BotMessagePublishBindingInput,
    activeKey: string,
  ): Pick<
    BotMessagePublishBinding,
    'accountId' | 'activeKey' | 'enabled' | 'selfId' | 'subscriptionId'
  > {
    return {
      accountId: String(account.id),
      activeKey,
      enabled: input.enabled,
      selfId: String(account.selfId),
      subscriptionId: String(input.subscriptionId),
    };
  }

  /**
   * 把启用记录的自然键冲突统一映射为 HTTP 409 业务错误。
   * @returns 该函数不正常返回；调用会抛出 HTTP 409 自然键冲突错误。
   */
  private throwNaturalKeyConflict(): never {
    return throwVbenError(
      '同一账号订阅的消息发布配置已存在',
      HttpStatus.CONFLICT,
    );
  }

  /**
   * 以 `binding_disabled` 契约错误统一拒绝不存在、禁用或并发变化的消息发布绑定。
   * @throws 调用该拒绝辅助函数时固定抛出代码为 `binding_disabled` 的 `SystemMessageContractError`。
   */
  private throwBindingUnavailable(): never {
    throw new SystemMessageContractError('binding_disabled');
  }

  /**
   * 仅把 MySQL `ER_DUP_ENTRY` 或错误号 1062 识别为唯一键冲突，其他错误一律返回 `false`。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足Duplicate键错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; errno?: unknown };
    return value.code === 'ER_DUP_ENTRY' || value.errno === 1062;
  }

  /**
   * 根据`manager`、`where`与当前约束判定未完成的投递记录；从 `manager.getRepository` 读取未完成的投递记录。
   * @param manager - 保证未完成的投递记录读写处于同一事务中的实体管理器。
   * @param where - 决定未完成的投递记录内容、边界或目标的 `where` 值。
   */
  private async cancelUnfinishedDeliveries(
    manager: EntityManager,
    where: Pick<BotMessageDelivery, 'bindingId'>,
  ): Promise<void> {
    await manager.getRepository(BotMessageDelivery).update(
      { ...where, status: In(['pending', 'retry']) },
      {
        nextAttemptAt: null,
        processingLeaseUntil: null,
        status: 'cancelled',
      },
    );
  }
}
