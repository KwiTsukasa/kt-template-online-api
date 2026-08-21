import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_CODEX_INTERNAL_HEADER } from '@/apps/media-codex-agent-gateway/domain/llm-codex-runtime.contract';

@Injectable()
export class MediaGovernanceAgentInternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /**
   * 通过使用定长安全比较校验媒体 Agent 内部回调密钥。
   * @param context - 用于通过使用定长安全比较校验媒体 Agent 内部回调密钥的领域对象，包含 `switchToHttp` 字段。
   * @returns 满足通过使用定长安全比较校验媒体 Agent 内部回调密钥约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   * @throws 当 `expectedValue.length < 32 || expectedValue.length > 512` 成立时拒绝当前输入并抛出 `ForbiddenException`；
   *   当 `actual.length !== expected.length || !timingSafeEqual(actual, expected)` 成立时拒绝当前输入并抛出 `ForbiddenException`。
   */
  canActivate(context: ExecutionContext) {
    const expectedValue = String(
      this.config.get<string>('LLM_CODEX_GATEWAY_INTERNAL_SECRET') ?? '',
    ).trim();
    if (expectedValue.length < 32 || expectedValue.length > 512) {
      throw new ForbiddenException('media-codex-agent-internal-auth-failed');
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers[LLM_CODEX_INTERNAL_HEADER];
    let headerValue = '';
    if (typeof header === 'string') headerValue = header;
    if (Array.isArray(header)) headerValue = header[0] ?? '';
    const actual = Buffer.from(headerValue);
    const expected = Buffer.from(expectedValue);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new ForbiddenException('media-codex-agent-internal-auth-failed');
    }
    return true;
  }
}
