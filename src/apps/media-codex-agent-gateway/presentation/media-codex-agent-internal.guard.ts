import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MediaCodexAgentGatewayConfigService } from '../config/media-codex-agent-gateway-config.service';

@Injectable()
export class MediaCodexAgentInternalGuard implements CanActivate {
  constructor(private readonly config: MediaCodexAgentGatewayConfigService) {}

  /** 以常量时间比较校验内部密钥，并拒绝未授权的网关请求。 */
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const value = request.headers['x-kt-media-agent-secret'];
    let headerValue: string | undefined;
    if (Array.isArray(value)) {
      headerValue = value[0];
    } else {
      headerValue = value;
    }
    const actual = Buffer.from(headerValue ?? '');
    const expected = Buffer.from(this.config.internalSecret());
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new ForbiddenException('media-codex-agent-internal-auth-failed');
    }
    return true;
  }
}
