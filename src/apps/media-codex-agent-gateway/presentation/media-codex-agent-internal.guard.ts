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

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const value = request.headers['x-kt-media-agent-secret'];
    const actual = Buffer.from(
      Array.isArray(value) ? (value[0] ?? '') : (value ?? ''),
    );
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
