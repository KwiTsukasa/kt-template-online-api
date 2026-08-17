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

  /** 增加当前计数。 */
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

  /** 增加多个。 */
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

  /** 删除计数器。 */
  async deleteCounter(namespace: string, identity: string): Promise<number> {
    const deleted = Number(
      await this.redis.del(this.buildKey(namespace, identity)),
    );
    if (!Number.isInteger(deleted) || deleted < 0) {
      throw new Error('Redis 限流计数删除结果无效');
    }
    return deleted;
  }

  /** 获取租约。 */
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

  /** 续期租约。 */
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

  /** 释放租约。 */
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

  /** 构建键。 */
  buildKey(namespace: string, identity: string): string {
    if (!SAFE_KEY_SEGMENT.test(namespace) || !SAFE_KEY_SEGMENT.test(identity)) {
      throw new Error('Redis 限流 key 段无效');
    }
    return `${this.keyPrefix}:${namespace}:${identity}`;
  }
}
