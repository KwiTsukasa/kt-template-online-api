import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MediaGovernanceAgentInternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /** 使用定长安全比较校验媒体 Agent 内部回调密钥。 */
  canActivate(context: ExecutionContext) {
    const expectedValue = String(
      this.config.get<string>('MEDIA_CODEX_AGENT_INTERNAL_SECRET') ?? '',
    ).trim();
    if (expectedValue.length < 32 || expectedValue.length > 512) {
      throw new ForbiddenException('media-codex-agent-internal-auth-failed');
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers['x-kt-media-agent-secret'];
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
