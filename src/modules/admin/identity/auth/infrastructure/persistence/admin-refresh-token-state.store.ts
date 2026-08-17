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

  /**
   * 根据`sessionId`、`ttlMs`构造认证刷新令牌会话；先通过 `assertTokenId` 校验输入边界。
   * @param sessionId - 用于精确定位会话的标识。
   * @param ttlMs - 用于认证刷新令牌会话超时、有效期或退避计算的毫秒数。
   * @returns 满足认证刷新令牌会话约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 轮换会话；通过 `assertTokenId` 生成稳定标识，通过 `assertTtl` 校验约束，通过 `redis.eval` 原子执行存储脚本。
   * @param input - 包含 `sessionId`、`tokenId`、`currentTokenTtlMs`、`nextTokenTtlMs` 字段的结构化领域输入。
   * @returns 返回 `result === 1` 的判定结果；条件成立为 `true`，否则为 `false`。
   * @throws 当 `![0, 1].includes(result)` 成立时抛出 `Error`，消息为“Refresh token 旋转结果无效”。
   */
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

  /**
   * 按`sessionId`、`ttlMs`移除认证刷新令牌会话；先通过 `assertTokenId` 校验输入边界。
   * @param sessionId - 用于精确定位会话的标识。
   * @param ttlMs - 用于认证刷新令牌会话超时、有效期或退避计算的毫秒数。
   * @returns 满足认证刷新令牌会话约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   * @throws 当 `![0, 1].includes(result)` 成立时拒绝当前输入并抛出 `Error`。
   */
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

  /**
   * 校验`value`是否满足令牌标识约束，并拒绝不合法输入。
   * @param value - 参与令牌标识比较、格式化或输出的候选值。
   * @throws 当 `!TOKEN_ID_PATTERN.test(value)` 成立时拒绝当前输入并抛出 `Error`。
   */
  private assertTokenId(value: string) {
    if (!TOKEN_ID_PATTERN.test(value)) {
      throw new Error('Refresh token 标识无效');
    }
  }

  /**
   * 校验`value`是否满足有效期约束，并拒绝不合法输入。
   * @param value - 参与有效期比较、格式化或输出的候选值。
   * @throws 当 `!Number.isInteger(value) || value < 1` 成立时拒绝当前输入并抛出 `Error`。
   */
  private assertTtl(value: number) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('Refresh token TTL 无效');
    }
  }

  /**
   * 以会话标识构造存放刷新令牌族状态的 Redis 键，并保持认证键空间隔离。
   * @param sessionId - 刷新令牌族所属的服务端会话标识。
   * @returns 指向该会话刷新令牌族状态的 Redis 键。
   */
  private familyKey(sessionId: string) {
    return `${this.keyPrefix}:auth:refresh:family:${sessionId}`;
  }

  /**
   * 组合会话与令牌标识，构造用于检测刷新令牌重放的 Redis 消费记录键。
   * @param sessionId - 已消费令牌所属的服务端会话标识。
   * @param tokenId - 需要记录为已消费的刷新令牌实例标识。
   * @returns 唯一指向该会话中该令牌消费记录的 Redis 键。
   */
  private usedTokenKey(sessionId: string, tokenId: string) {
    return `${this.keyPrefix}:auth:refresh:used:${sessionId}:${tokenId}`;
  }
}
