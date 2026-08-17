import { Injectable } from '@nestjs/common';
import type {
  QqbotMessagePushTargetOption,
  QqbotMessagePushTargetOptionsResponse,
  QqbotMessagePushTargetType,
} from '../../contract/message-push/qqbot-message-push.types';
import { QqbotAccountService } from '../account/qqbot-account.service';
import { QqbotReverseWsService } from '../../infrastructure/integration/connection/qqbot-reverse-ws.service';

const TARGET_ID_PATTERN = /^[1-9]\d{4,19}$/;

@Injectable()
export class QqbotMessageTargetOptionsService {
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly reverseWsService: QqbotReverseWsService,
  ) {}

  /** 列出目标选项。 */
  async listTargetOptions(
    selfId: string,
  ): Promise<QqbotMessagePushTargetOptionsResponse> {
    const account = await this.accountService.findBySelfId(selfId);
    if (!account) return this.unavailable('account_unavailable');
    try {
      const [groups, friends] = await Promise.all([
        this.reverseWsService.sendAction(selfId, 'get_group_list', {}),
        this.reverseWsService.sendAction(selfId, 'get_friend_list', {}),
      ]);
      const options = [
        ...this.normalizeResponse(groups, 'group'),
        ...this.normalizeResponse(friends, 'private'),
      ];
      const unique = new Map<string, QqbotMessagePushTargetOption>();
      options.forEach((option) => {
        const key = `${option.targetType}:${option.targetId}`;
        unique.set(key, this.preferCandidate(unique.get(key), option));
      });
      return {
        available: true,
        options: [...unique.values()].sort((left, right) =>
          `${left.targetType}:${left.label}:${left.targetId}`.localeCompare(
            `${right.targetType}:${right.label}:${right.targetId}`,
          ),
        ),
        reasonCode: null,
      };
    } catch {
      return this.unavailable('onebot_unavailable');
    }
  }

  /** 规范化响应。 */
  private normalizeResponse(
    response: { data?: unknown; retcode?: number; status?: string },
    targetType: QqbotMessagePushTargetType,
  ): QqbotMessagePushTargetOption[] {
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

  /** 规范化候选项。 */
  private normalizeCandidate(
    candidate: unknown,
    targetType: QqbotMessagePushTargetType,
  ): QqbotMessagePushTargetOption {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('OneBot candidate is malformed');
    }
    const record = candidate as Record<string, unknown>;
    const rawId = targetType === 'group' ? record.group_id : record.user_id;
    const targetId = String(rawId).trim();
    if (!TARGET_ID_PATTERN.test(targetId)) {
      throw new Error('OneBot candidate ID is invalid');
    }
    const name =
      targetType === 'group'
        ? this.knownName(record.group_name)
        : (this.knownName(record.remark) ?? this.knownName(record.nickname));
    return {
      label: name ? `${name} (${targetId})` : targetId,
      targetId,
      targetType,
    };
  }

  /** 返回已知的名称。 */
  private knownName(value: unknown): null | string {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  /** 返回优先选择候选项。 */
  private preferCandidate(
    current: QqbotMessagePushTargetOption | undefined,
    candidate: QqbotMessagePushTargetOption,
  ): QqbotMessagePushTargetOption {
    if (!current) return candidate;
    const currentKnown = current.label !== current.targetId;
    const candidateKnown = candidate.label !== candidate.targetId;
    if (currentKnown !== candidateKnown) {
      return candidateKnown ? candidate : current;
    }
    return candidate.label.localeCompare(current.label) < 0
      ? candidate
      : current;
  }

  /** 返回不可用。 */
  private unavailable(
    reasonCode: string,
  ): QqbotMessagePushTargetOptionsResponse {
    return { available: false, options: [], reasonCode };
  }
}
