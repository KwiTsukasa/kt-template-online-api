import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

const KEY_PREFIX_CONFIG = 'PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX';
const SAFE_KEY_PREFIX = /^[A-Za-z0-9:_-]+$/;
const TOKEN_ID_PATTERN = /^[a-f0-9]{32}$/;
const ROTATE_SESSION_SCRIPT = `
local familyState = redis.call("GET", KEYS[1])
if familyState ~= "active" then
  return 0
end

local claimed = redis.call("SET", KEYS[2], "used", "PX", ARGV[1], "NX")
if not claimed then
  return 0
end

redis.call("PEXPIRE", KEYS[1], ARGV[2])
return 1
`;
const REVOKE_SESSION_SCRIPT = `
local familyState = redis.call("GET", KEYS[1])
if not familyState then
  return 0
end

local currentTtl = redis.call("PTTL", KEYS[1])
local requestedTtl = tonumber(ARGV[1])
local retainedTtl = requestedTtl
if currentTtl > retainedTtl then
  retainedTtl = currentTtl
end

redis.call("SET", KEYS[1], "revoked", "PX", retainedTtl)
return 1
`;

export interface RotateRefreshTokenSessionInput {
  currentTokenTtlMs: number;
  nextTokenTtlMs: number;
  sessionId: string;
  tokenId: string;
}

@Injectable()
export class AdminRefreshTokenStateStore {
  private readonly keyPrefix: string;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.keyPrefix = `${configService.get(KEY_PREFIX_CONFIG) || ''}`.trim();
    if (!this.keyPrefix || !SAFE_KEY_PREFIX.test(this.keyPrefix)) {
      throw new Error(
        `${KEY_PREFIX_CONFIG} 只能包含字母、数字、冒号、横线或下划线`,
      );
    }
  }

  async createSession(sessionId: string, ttlMs: number): Promise<boolean> {
    this.assertTokenId(sessionId);
    this.assertTtl(ttlMs);
    const result = await this.redis.set(
      this.familyKey(sessionId),
      'active',
      'PX',
      ttlMs,
      'NX',
    );
    return result === 'OK';
  }

  async rotateSession(input: RotateRefreshTokenSessionInput): Promise<boolean> {
    this.assertTokenId(input.sessionId);
    this.assertTokenId(input.tokenId);
    this.assertTtl(input.currentTokenTtlMs);
    this.assertTtl(input.nextTokenTtlMs);
    const result = Number(
      await this.redis.eval(
        ROTATE_SESSION_SCRIPT,
        2,
        this.familyKey(input.sessionId),
        this.usedTokenKey(input.sessionId, input.tokenId),
        input.currentTokenTtlMs,
        input.nextTokenTtlMs,
      ),
    );
    if (![0, 1].includes(result)) {
      throw new Error('Refresh token 旋转结果无效');
    }
    return result === 1;
  }

  async revokeSession(sessionId: string, ttlMs: number): Promise<boolean> {
    this.assertTokenId(sessionId);
    this.assertTtl(ttlMs);
    const result = Number(
      await this.redis.eval(
        REVOKE_SESSION_SCRIPT,
        1,
        this.familyKey(sessionId),
        ttlMs,
      ),
    );
    if (![0, 1].includes(result)) {
      throw new Error('Refresh token 吊销结果无效');
    }
    return result === 1;
  }

  private assertTokenId(value: string) {
    if (!TOKEN_ID_PATTERN.test(value)) {
      throw new Error('Refresh token 标识无效');
    }
  }

  private assertTtl(value: number) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('Refresh token TTL 无效');
    }
  }

  private familyKey(sessionId: string) {
    return `${this.keyPrefix}:auth:refresh:family:${sessionId}`;
  }

  private usedTokenKey(sessionId: string, tokenId: string) {
    return `${this.keyPrefix}:auth:refresh:used:${sessionId}:${tokenId}`;
  }
}
