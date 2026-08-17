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

  /**
   * 以常量时间比较校验内部密钥，并拒绝未授权的网关请求。
   * @param context - 用于Activate的领域对象，包含 `switchToHttp` 字段。
   * @returns 满足Activate约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   * @throws 当 `actual.length !== expected.length || !timingSafeEqual(actual, expected)` 成立时拒绝当前输入并抛出 `ForbiddenException`。
   */
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
