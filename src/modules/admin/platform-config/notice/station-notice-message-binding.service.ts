import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import { throwVbenError } from '@/common';
import { MessageBindingProtocolService } from '@/modules/message-management/application/message-binding-protocol.service';
import { StationNoticeMessageBinding } from './station-notice-message-binding.entity';
import type {
  StationNoticeMessageBindingInput,
  StationNoticeMessageBindingView,
} from './station-notice-message-subscriber.types';

const STATION_NOTICE_SUBSCRIBER_KEY = 'station-notice';

@Injectable()
export class StationNoticeMessageBindingService {
  constructor(
    @InjectRepository(StationNoticeMessageBinding)
    private readonly bindingRepository: Repository<StationNoticeMessageBinding>,
    private readonly bindingProtocol: MessageBindingProtocolService,
  ) {}

  /**
   * 读取全部未删除站内信订阅者绑定，并附带当前订阅、模板与消息源可用性。
   * @returns 按创建时间和标识稳定排序的站内信订阅者绑定视图。
   */
  async list(): Promise<StationNoticeMessageBindingView[]> {
    const bindings = await this.bindingRepository.find({
      order: { createTime: 'ASC', id: 'ASC' },
      where: { isDeleted: false },
    });
    return Promise.all(bindings.map((binding) => this.toView(binding)));
  }

  /**
   * 校验订阅归属及其多模板完整性后创建唯一的站内信订阅者绑定。
   * @param input - 站内信标题、接收角色、通用订阅标识和启用状态。
   * @returns 新建绑定及其当前可用性视图。
   * @throws 订阅不属于站内信、订阅或模板不可用、同订阅重复配置，或持久化失败时抛出对应异常。
   */
  async create(
    input: StationNoticeMessageBindingInput,
  ): Promise<StationNoticeMessageBindingView> {
    const normalized = this.normalizeInput(input);
    let saved: StationNoticeMessageBinding;
    try {
      saved = await this.bindingRepository.manager.transaction(
        async (manager) => {
          await this.bindingProtocol.requireAvailable(
            manager,
            normalized.subscriptionId,
            STATION_NOTICE_SUBSCRIBER_KEY,
            normalized.enabled,
          );
          await this.assertNoDuplicate(
            manager,
            normalized.subscriptionId,
            null,
          );
          const repository = manager.getRepository(StationNoticeMessageBinding);
          return repository.save(
            repository.create({
              ...normalized,
              activeKey: this.activeKey(normalized.subscriptionId),
              isDeleted: false,
            }),
          );
        },
      );
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwDuplicate();
      throw error;
    }
    return this.toView(saved);
  }

  /**
   * 在悲观锁事务中替换站内信订阅者绑定，同时保持每个订阅最多一个有效绑定。
   * @param id - 待更新的站内信订阅者绑定标识。
   * @param input - 新的标题、接收角色、通用订阅标识和启用状态。
   * @returns 更新后的绑定及其当前可用性视图。
   * @throws 绑定不存在、订阅协议不可用、同订阅重复配置，或持久化失败时抛出对应异常。
   */
  async update(
    id: string,
    input: StationNoticeMessageBindingInput,
  ): Promise<StationNoticeMessageBindingView> {
    const normalized = this.normalizeInput(input);
    let saved: StationNoticeMessageBinding;
    try {
      saved = await this.bindingRepository.manager.transaction(
        async (manager) => {
          const repository = manager.getRepository(StationNoticeMessageBinding);
          const current = await this.findForWrite(repository, id);
          await this.bindingProtocol.requireAvailable(
            manager,
            normalized.subscriptionId,
            STATION_NOTICE_SUBSCRIBER_KEY,
            normalized.enabled,
          );
          await this.assertNoDuplicate(
            manager,
            normalized.subscriptionId,
            current.id,
          );
          return repository.save(
            repository.merge(current, {
              ...normalized,
              activeKey: this.activeKey(normalized.subscriptionId),
            }),
          );
        },
      );
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwDuplicate();
      throw error;
    }
    return this.toView(saved);
  }

  /**
   * 启用前重新校验通用订阅与模板，停用时只阻止后续落信而保留历史站内信。
   * @param id - 待切换状态的站内信订阅者绑定标识。
   * @param enabled - 是否允许该绑定继续接收消息事件。
   * @returns 状态切换后的绑定视图。
   */
  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<StationNoticeMessageBindingView> {
    const saved = await this.bindingRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(StationNoticeMessageBinding);
        const current = await this.findForWrite(repository, id);
        if (enabled) {
          await this.bindingProtocol.requireAvailable(
            manager,
            current.subscriptionId,
            STATION_NOTICE_SUBSCRIBER_KEY,
            true,
          );
        }
        current.enabled = enabled;
        return repository.save(current);
      },
    );
    return this.toView(saved);
  }

  /**
   * 软删除站内信订阅者绑定并释放订阅自然键，不改写已经生成的站内信。
   * @param id - 待删除的站内信订阅者绑定标识。
   * @returns 固定为 null，表示删除入口不返回领域记录。
   */
  async remove(id: string): Promise<null> {
    await this.bindingRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(StationNoticeMessageBinding);
      const current = await this.findForWrite(repository, id);
      current.activeKey = null;
      current.enabled = false;
      current.isDeleted = true;
      await repository.save(current);
    });
    return null;
  }

  /**
   * 把外部输入裁剪为站内信订阅者允许持久化的稳定字段。
   * @param input - 可能包含首尾空白的站内信订阅者绑定输入。
   * @returns 已规范化且可参与事务校验的绑定输入。
   */
  private normalizeInput(
    input: StationNoticeMessageBindingInput,
  ): StationNoticeMessageBindingInput {
    const title = input.title.trim();
    const notifyRoleCode = input.notifyRoleCode.trim();
    if (!title) {
      throwVbenError('站内信标题不能为空', HttpStatus.BAD_REQUEST);
    }
    if (!notifyRoleCode) {
      throwVbenError('站内信接收角色不能为空', HttpStatus.BAD_REQUEST);
    }
    return {
      enabled: input.enabled,
      notifyRoleCode,
      subscriptionId: String(input.subscriptionId),
      title,
    };
  }

  /**
   * 拒绝同一通用订阅被多个有效站内信绑定重复接入。
   * @param manager - 与绑定写入共享事务的实体管理器。
   * @param subscriptionId - 参与唯一性检查的通用订阅标识。
   * @param excludedId - 更新时排除的当前绑定标识；创建时为 null。
   */
  private async assertNoDuplicate(
    manager: EntityManager,
    subscriptionId: string,
    excludedId: null | string,
  ): Promise<void> {
    const existing = await manager
      .getRepository(StationNoticeMessageBinding)
      .findOne({
        where: {
          activeKey: this.activeKey(subscriptionId),
          isDeleted: false,
        },
      });
    if (!existing) return;
    if (excludedId && existing.id === excludedId) return;
    this.throwDuplicate();
  }

  /**
   * 在写事务中读取仍有效的绑定并锁定，避免并发更新覆盖软删除。
   * @param repository - 当前事务中的站内信绑定仓储。
   * @param id - 待锁定的绑定标识。
   * @returns 已锁定且未删除的站内信订阅者绑定。
   */
  private async findForWrite(
    repository: Repository<StationNoticeMessageBinding>,
    id: string,
  ): Promise<StationNoticeMessageBinding> {
    const current = await repository.findOne({
      lock: { mode: 'pessimistic_write' },
      where: { id, isDeleted: false },
    });
    if (!current) {
      throwVbenError('站内信订阅者绑定不存在', HttpStatus.NOT_FOUND);
    }
    return current;
  }

  /**
   * 组合站内信订阅者与订阅标识，生成软删除前保持唯一的自然键。
   * @param subscriptionId - 被站内信订阅者接入的通用订阅标识。
   * @returns 站内信订阅者绑定的稳定自然键。
   */
  private activeKey(subscriptionId: string): string {
    return `station-notice:${subscriptionId}`;
  }

  /**
   * 将持久化绑定与当前订阅、模板状态投影为管理端可读视图。
   * @param binding - 待投影的站内信订阅者绑定。
   * @returns 包含引用名称、消息源名称和失效原因的绑定视图。
   */
  private async toView(
    binding: StationNoticeMessageBinding,
  ): Promise<StationNoticeMessageBindingView> {
    const state = await this.bindingProtocol.inspect(
      this.bindingRepository.manager,
      binding.subscriptionId,
      STATION_NOTICE_SUBSCRIBER_KEY,
    );

    return {
      available: state.available,
      createTime: String(binding.createTime),
      enabled: binding.enabled,
      id: String(binding.id),
      invalidReasonCode: state.invalidReasonCode,
      notifyRoleCode: binding.notifyRoleCode,
      sourceKey: state.sourceKey,
      sourceName: state.sourceName,
      subscriptionId: String(binding.subscriptionId),
      subscriptionName: state.subscriptionName,
      templates: state.templates.map((template) => ({ ...template })),
      title: binding.title,
      updateTime: String(binding.updateTime),
    };
  }

  /**
   * 把自然键冲突转换成管理端可识别的重复绑定响应。
   * @returns 该方法不会正常返回，而是抛出 HTTP 409 业务错误。
   */
  private throwDuplicate(): never {
    return throwVbenError('该消息订阅已配置站内信订阅者', HttpStatus.CONFLICT);
  }

  /**
   * 仅识别 MySQL 唯一键冲突，其他持久化异常继续交给上层处理。
   * @param error - 保存绑定时捕获的未知异常。
   * @returns 异常属于 MySQL 唯一键冲突时返回 true。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
