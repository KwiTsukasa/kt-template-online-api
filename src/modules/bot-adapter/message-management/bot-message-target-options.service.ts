import { Injectable } from '@nestjs/common';
import type {
  BotMessagePushTargetOption,
  BotMessagePushTargetOptionsResponse,
  BotMessagePushTargetType,
} from './bot-message-subscriber.types';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import { BotReverseWsService } from '@/modules/bot-adapter/core/infrastructure/integration/connection/bot-reverse-ws.service';

const TARGET_ID_PATTERN = /^[1-9]\d{4,19}$/;

@Injectable()
export class BotMessageTargetOptionsService {
  constructor(
    private readonly accountService: BotAccountService,
    private readonly reverseWsService: BotReverseWsService,
  ) {}

  /**
   * 按`selfId`读取目标选项；从 `accountService.findBySelfId` 读取目标选项。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 目标选项。
   */
  async listTargetOptions(
    selfId: string,
  ): Promise<BotMessagePushTargetOptionsResponse> {
    const account = await this.accountService.findBySelfId(selfId);
    if (!account || account.enabled === false || account.isDeleted === true) {
      return this.unavailable('account_unavailable');
    }
    const connectionMode = account.connectionMode || 'reverse-ws';
    if (connectionMode !== 'reverse-ws') {
      return {
        available: true,
        connectionMode,
        manualEntry: true,
        options: [],
        reasonCode: null,
      };
    }
    try {
      const [groups, friends] = await Promise.all([
        this.reverseWsService.sendAction(selfId, 'get_group_list', {}),
        this.reverseWsService.sendAction(selfId, 'get_friend_list', {}),
      ]);
      const options = [
        ...this.normalizeResponse(groups, 'group'),
        ...this.normalizeResponse(friends, 'private'),
      ];
      const unique = new Map<string, BotMessagePushTargetOption>();
      options.forEach((option) => {
        const key = `${option.targetType}:${option.targetId}`;
        unique.set(key, this.preferCandidate(unique.get(key), option));
      });
      return {
        available: true,
        connectionMode,
        manualEntry: false,
        options: [...unique.values()].sort((left, right) =>
          `${left.targetType}:${left.label}:${left.targetId}`.localeCompare(
            `${right.targetType}:${right.label}:${right.targetId}`,
          ),
        ),
        reasonCode: null,
      };
    } catch {
      return this.unavailable('onebot_unavailable', connectionMode);
    }
  }

  /**
   * 校验 OneBot 候选响应成功且数据为数组，再把每项投影为指定类型的消息目标。
   * @param response - OneBot 返回的状态、返回码和候选数据。
   * @param targetType - 应赋给每个候选项的群聊或私聊目标类型。
   * @returns 已逐项校验并规范化的消息目标列表。
   * @throws 状态不是成功、返回码非零或候选数据不是数组时抛出 `Error`。
   */
  private normalizeResponse(
    response: { data?: unknown; retcode?: number; status?: string },
    targetType: BotMessagePushTargetType,
  ): BotMessagePushTargetOption[] {
    if (
      response.status !== 'ok' ||
      (response.retcode !== undefined && response.retcode !== 0) ||
      !Array.isArray(response.data)
    ) {
      throw new Error('OneBot candidate response is unavailable');
    }
    return response.data.map((item) =>
      this.normalizeCandidate(item, targetType),
    );
  }

  /**
   * 从 OneBot 好友或群记录中读取对应标识和显示名称，形成统一的消息投递目标。
   * @param candidate - 待规范化的 OneBot 好友或群候选记录。
   * @param targetType - 决定读取群标识还是用户标识的目标类型。
   * @returns 包含规范目标标识、显示标签和目标类型的候选项。
   * @throws 候选值不是对象或提取出的目标标识格式非法时抛出 `Error`。
   */
  private normalizeCandidate(
    candidate: unknown,
    targetType: BotMessagePushTargetType,
  ): BotMessagePushTargetOption {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('OneBot candidate is malformed');
    }
    const record = candidate as Record<string, unknown>;
    const rawId = (() => {
      if (targetType === 'group') {
        return record.group_id;
      }
      return record.user_id;
    })();
    const targetId = String(rawId).trim();
    if (!TARGET_ID_PATTERN.test(targetId)) {
      throw new Error('OneBot candidate ID is invalid');
    }
    const name = (() => {
      if (targetType === 'group') {
        return this.knownName(record.group_name);
      }
      return this.knownName(record.remark) ?? this.knownName(record.nickname);
    })();
    return {
      label: (() => {
        if (name) {
          return `${name} (${targetId})`;
        }
        return targetId;
      })(),
      targetId,
      targetType,
    };
  }

  /**
   * 裁剪候选名称并保留已知的非空值。
   * @param value - 参与裁剪候选名称并保留已知的非空值比较、格式化或输出的候选值。
   * @returns 裁剪候选名称并保留已知的非空值；无法解析或未命中时为 `null`。
   */
  private knownName(value: unknown): null | string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return null;
  }

  /**
   * 把来源状态投影为优先选择候选项。
   * @param current - 用于把来源状态投影为优先选择候选项的领域对象，包含 `label`、`targetId` 字段。
   * @param candidate - 决定是否启用“candidate”分支的布尔选项。
   * @returns 把来源状态投影为优先选择候选项。
   */
  private preferCandidate(
    current: BotMessagePushTargetOption | undefined,
    candidate: BotMessagePushTargetOption,
  ): BotMessagePushTargetOption {
    if (!current) return candidate;
    const currentKnown = current.label !== current.targetId;
    const candidateKnown = candidate.label !== candidate.targetId;
    if (currentKnown !== candidateKnown) {
      if (candidateKnown) {
        return candidate;
      }
      return current;
    }
    if (candidate.label.localeCompare(current.label) < 0) {
      return candidate;
    }
    return current;
  }

  /**
   * 把账号或 OneBot 候选读取失败投影为不允许手工绕过的空目标响应。
   * @param reasonCode - 提供给 Admin 展示的稳定不可用原因码。
   * @param connectionMode - 已识别的账号接入方式；账号不存在时保持 null。
   * @returns 禁用目标编辑、候选为空且保留失败原因的响应。
   */
  private unavailable(
    reasonCode: string,
    connectionMode: BotMessagePushTargetOptionsResponse['connectionMode'] = null,
  ): BotMessagePushTargetOptionsResponse {
    return {
      available: false,
      connectionMode,
      manualEntry: false,
      options: [],
      reasonCode,
    };
  }
}
