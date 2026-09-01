import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { LlmCodexGatewayConfigService } from '../config/llm-codex-gateway-config.service';
import { LLM_CODEX_INTERNAL_HEADER } from '../domain/llm-codex-runtime.contract';

@Injectable()
export class LlmCodexInternalGuard implements CanActivate {
  constructor(private readonly config: LlmCodexGatewayConfigService) {}

  /**
   * 以常量时间比较校验通用 Codex 对话专用密钥。
   * @param context - 当前私有网关 HTTP 执行上下文。
   * @returns 密钥精确匹配时返回 true。
   * @throws 密钥缺失、长度不同或内容不同时抛出 403。
   */
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const value = request.headers[LLM_CODEX_INTERNAL_HEADER];
    let headerValue: string | undefined;
    if (Array.isArray(value)) {
      headerValue = value[0];
    } else {
      headerValue = value;
    }
    const actual = Buffer.from(headerValue ?? '');
    const expected = Buffer.from(this.config.llmInternalSecret());
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new ForbiddenException('llm-codex-internal-auth-failed');
    }
    return true;
  }
}
