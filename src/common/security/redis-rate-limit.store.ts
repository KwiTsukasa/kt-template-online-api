import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

const RATE_LIMIT_SCRIPT = `
local result = {}

for index, key in ipairs(KEYS) do
  local requestedTtl = tonumber(ARGV[index])
  local count = redis.call("INCR", key)
  if count == 1 then
    redis.call("PEXPIRE", key, requestedTtl)
  end

  local ttl = redis.call("PTTL", key)
  if ttl < 0 then
    redis.call("PEXPIRE", key, requestedTtl)
    ttl = requestedTtl
  end

  table.insert(result, count)
  table.insert(result, ttl)
end

return result
`;
const ACQUIRE_LEASE_SCRIPT = `
local redisTime = redis.call("TIME")
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local leaseToken = ARGV[1]
local requestedLimit = tonumber(ARGV[2])
local requestedTtl = tonumber(ARGV[3])
local expiresAt = now + requestedTtl

redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
redis.call("ZADD", KEYS[1], expiresAt, leaseToken)
local count = redis.call("ZCARD", KEYS[1])
redis.call("PEXPIRE", KEYS[1], requestedTtl)

if count > requestedLimit then
  redis.call("ZREM", KEYS[1], leaseToken)
  return {0, count - 1, requestedTtl}
end

return {1, count, requestedTtl}
`;
const RENEW_LEASE_SCRIPT = `
local leaseToken = ARGV[1]
local requestedTtl = tonumber(ARGV[2])
local redisTime = redis.call("TIME")
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local expiresAt = now + requestedTtl

redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
if not redis.call("ZSCORE", KEYS[1], leaseToken) then
  return 0
end

redis.call("ZADD", KEYS[1], expiresAt, leaseToken)
redis.call("PEXPIRE", KEYS[1], requestedTtl)
return 1
`;
const RELEASE_LEASE_SCRIPT = `
return redis.call("ZREM", KEYS[1], ARGV[1])
`;
const KEY_PREFIX_CONFIG = 'PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX';
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9:_-]+$/;

export interface RedisRateLimitCounter {
  count: number;
  ttlMs: number;
}

export interface RedisRateLimitBucket {
  identity: string;
  namespace: string;
  ttlMs: number;
}

export interface RedisRateLimitLease {
  acquired: boolean;
  count: number;
  ttlMs: number;
}

@Injectable()
export class RedisRateLimitStore {
  private readonly keyPrefix: string;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.keyPrefix =
      `${this.configService.get(KEY_PREFIX_CONFIG) || ''}`.trim();
    if (!this.keyPrefix || !SAFE_KEY_SEGMENT.test(this.keyPrefix)) {
      throw new Error(
        `${KEY_PREFIX_CONFIG} 只能包含字母、数字、冒号、横线或下划线`,
      );
    }
  }

  /**
   * 根据`namespace`、`identity`、`ttlMs`处理增加当前计数。
   * @param namespace - 隔离增加当前计数缓存或持久化键的命名空间。
   * @param identity - 区分增加当前计数所属账号、设备或运行实例的稳定身份。
   * @param ttlMs - 用于增加当前计数超时、有效期或退避计算的毫秒数。
   * @returns 增加当前计数。
   */
  async increment(
    namespace: string,
    identity: string,
    ttlMs: number,
  ): Promise<RedisRateLimitCounter> {
    const [counter] = await this.incrementMany([
      {
        identity,
        namespace,
        ttlMs,
      },
    ]);
    return counter;
  }

  /**
   * 根据`buckets`处理增加多个。
   * @param buckets - 用于增加多个的领域对象，包含 `length` 字段。
   * @returns 按输入顺序得到的增加多个列表；没有匹配项时为空数组。
   * @throws 当 `!Array.isArray(result) || result.length !== buckets.length * 2` 成立时拒绝当前输入并抛出 `Error`。
   */
  async incrementMany(
    buckets: RedisRateLimitBucket[],
  ): Promise<RedisRateLimitCounter[]> {
    if (!buckets.length) return [];
    buckets.forEach((bucket) => {
      if (!Number.isInteger(bucket.ttlMs) || bucket.ttlMs < 1) {
        throw new Error('Redis 限流 TTL 无效');
      }
    });

    const result = (await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      buckets.length,
      ...buckets.map((bucket) =>
        this.buildKey(bucket.namespace, bucket.identity),
      ),
      ...buckets.map((bucket) => bucket.ttlMs),
    )) as Array<number | string>;
    if (!Array.isArray(result) || result.length !== buckets.length * 2) {
      throw new Error('Redis 限流计数结果无效');
    }

    return buckets.map((_bucket, index) => {
      const count = Number(result[index * 2]);
      const remainingTtlMs = Number(result[index * 2 + 1]);
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        !Number.isFinite(remainingTtlMs)
      ) {
        throw new Error('Redis 限流计数结果无效');
      }
      return {
        count,
        ttlMs: Math.max(1, Math.trunc(remainingTtlMs)),
      };
    });
  }

  /**
   * 按`namespace`、`identity`移除计数器并返回实际删除数量。
   * @param namespace - 隔离计数器缓存或持久化键的命名空间。
   * @param identity - 区分计数器所属账号、设备或运行实例的稳定身份。
   * @returns 实际删除的计数器数量；目标不存在时为 `0`。
   * @throws 当 `!Number.isInteger(deleted) || deleted < 0` 成立时拒绝当前输入并抛出 `Error`。
   */
  async deleteCounter(namespace: string, identity: string): Promise<number> {
    const deleted = Number(
      await this.redis.del(this.buildKey(namespace, identity)),
    );
    if (!Number.isInteger(deleted) || deleted < 0) {
      throw new Error('Redis 限流计数删除结果无效');
    }
    return deleted;
  }

  /**
   * 根据命名空间、身份、租约令牌、并发上限与 TTL 在 Redis 中原子领取限流租约，并返回占用状态与剩余有效期。
   * @param namespace - 隔离租约缓存或持久化键的命名空间。
   * @param identity - 区分租约所属账号、设备或运行实例的稳定身份。
   * @param leaseToken - 证明当前调用持有并释放同一限流租约的随机令牌。
   * @param limit - 允许返回或处理的租约最大数量。
   * @param ttlMs - 用于租约超时、有效期或退避计算的毫秒数。
   * @returns 包含 `acquired`、`count`、`ttlMs` 字段的租约。
   * @throws 当 `!Number.isInteger(limit) || limit < 1` 成立时拒绝当前输入并抛出 `Error`；当 `!Number.isInteger(ttlMs) || ttlMs < 1` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!SAFE_KEY_SEGMENT.test(leaseToken)` 成立时拒绝当前输入并抛出 `Error`；当 `!Array.isArray(result) || result.length !== 3` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `![0, 1].includes(acquired) || !Number.isInteger(count) || count < 0 ||…` 成立时拒绝当前输入并抛出 `Error`。
   */
  async acquireLease(
    namespace: string,
    identity: string,
    leaseToken: string,
    limit: number,
    ttlMs: number,
  ): Promise<RedisRateLimitLease> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Redis 并发租约上限无效');
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new Error('Redis 并发租约 TTL 无效');
    }
    if (!SAFE_KEY_SEGMENT.test(leaseToken)) {
      throw new Error('Redis 并发租约 token 无效');
    }
    const result = (await this.redis.eval(
      ACQUIRE_LEASE_SCRIPT,
      1,
      this.buildKey(namespace, identity),
      leaseToken,
      limit,
      ttlMs,
    )) as Array<number | string>;
    if (!Array.isArray(result) || result.length !== 3) {
      throw new Error('Redis 并发租约结果无效');
    }

    const acquired = Number(result[0]);
    const count = Number(result[1]);
    const remainingTtlMs = Number(result[2]);
    if (
      ![0, 1].includes(acquired) ||
      !Number.isInteger(count) ||
      count < 0 ||
      !Number.isFinite(remainingTtlMs)
    ) {
      throw new Error('Redis 并发租约结果无效');
    }
    return {
      acquired: acquired === 1,
      count,
      ttlMs: Math.max(1, Math.trunc(remainingTtlMs)),
    };
  }

  /**
   * 根据`namespace`、`identity`、`leaseToken`处理续期租约。
   * @param namespace - 隔离续期租约缓存或持久化键的命名空间。
   * @param identity - 区分续期租约所属账号、设备或运行实例的稳定身份。
   * @param leaseToken - 证明当前调用持有并释放同一限流租约的随机令牌。
   * @param ttlMs - 用于续期租约超时、有效期或退避计算的毫秒数。
   * @returns 满足续期租约约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   * @throws 当 `!SAFE_KEY_SEGMENT.test(leaseToken)` 成立时拒绝当前输入并抛出 `Error`；当 `!Number.isInteger(ttlMs) || ttlMs < 1` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `![0, 1].includes(renewed)` 成立时拒绝当前输入并抛出 `Error`。
   */
  async renewLease(
    namespace: string,
    identity: string,
    leaseToken: string,
    ttlMs: number,
  ): Promise<boolean> {
    if (!SAFE_KEY_SEGMENT.test(leaseToken)) {
      throw new Error('Redis 并发租约 token 无效');
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new Error('Redis 并发租约 TTL 无效');
    }
    const renewed = Number(
      await this.redis.eval(
        RENEW_LEASE_SCRIPT,
        1,
        this.buildKey(namespace, identity),
        leaseToken,
        ttlMs,
      ),
    );
    if (![0, 1].includes(renewed)) {
      throw new Error('Redis 并发租约续期结果无效');
    }
    return renewed === 1;
  }

  /**
   * 根据命名空间、身份与租约令牌在 Redis 中原子释放当前调用拥有的限流租约；租约不存在或所有者不匹配时不删除记录。
   * @param namespace - 隔离租约缓存或持久化键的命名空间。
   * @param identity - 区分租约所属账号、设备或运行实例的稳定身份。
   * @param leaseToken - 证明当前调用持有并释放同一限流租约的随机令牌。
   * @returns 满足租约约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   * @throws 当 `![0, 1].includes(count)` 成立时拒绝当前输入并抛出 `Error`。
   */
  async releaseLease(
    namespace: string,
    identity: string,
    leaseToken: string,
  ): Promise<boolean> {
    const count = Number(
      await this.redis.eval(
        RELEASE_LEASE_SCRIPT,
        1,
        this.buildKey(namespace, identity),
        leaseToken,
      ),
    );
    if (![0, 1].includes(count)) {
      throw new Error('Redis 并发租约释放结果无效');
    }
    return count === 1;
  }

  /**
   * 校验限流键的两个动态段，并与固定前缀拼成不会引入 Redis 分隔歧义的键。
   * @param namespace - 隔离不同限流用途的安全命名空间段。
   * @param identity - 标识当前限流主体的安全身份段。
   * @returns 依次包含固定前缀、命名空间和主体身份的 Redis 键。
   * @throws 当 `!SAFE_KEY_SEGMENT.test(namespace) || !SAFE_KEY_SEGMENT.test(identity)` 成立时抛出 `Error`，消息为“Redis 限流 key 段无效”。
   */
  buildKey(namespace: string, identity: string): string {
    if (!SAFE_KEY_SEGMENT.test(namespace) || !SAFE_KEY_SEGMENT.test(identity)) {
      throw new Error('Redis 限流 key 段无效');
    }
    return `${this.keyPrefix}:${namespace}:${identity}`;
  }
}
