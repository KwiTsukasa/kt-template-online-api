import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import { NapcatWebuiGatewayConfigService } from '../../config/napcat-webui-gateway-config.service';
import type {
  NapcatWebuiGatewaySession,
  NapcatWebuiGatewaySessionStore,
} from '../../domain/napcat-webui-gateway.types';

const SESSION_KEY_PREFIX = 'napcat:webui:session:';
const USER_ACCOUNT_KEY_PREFIX = 'napcat:webui:user-account:';
const TERMINAL_SESSION_STATUSES = ['expired', 'failed', 'revoked'];
const UPDATE_SESSION_SCRIPT = `
local currentJson = redis.call("GET", KEYS[1])
if not currentJson then
  return {0, "Gateway session is not active"}
end

local current = cjson.decode(currentJson)
local patch = cjson.decode(ARGV[2])
local terminal = { expired = true, failed = true, revoked = true }
local next = {}

for key, value in pairs(current) do
  next[key] = value
end
for key, value in pairs(patch) do
  next[key] = value
end

next["sessionId"] = ARGV[1]
next["adminUserId"] = current["adminUserId"]
next["accountId"] = current["accountId"]

if current["expiresAt"] and patch["expiresAt"] and tonumber(current["expiresAt"]) > tonumber(patch["expiresAt"]) then
  next["expiresAt"] = current["expiresAt"]
end
if current["lastSeenAt"] and patch["lastSeenAt"] and tonumber(current["lastSeenAt"]) > tonumber(patch["lastSeenAt"]) then
  next["lastSeenAt"] = current["lastSeenAt"]
end
if current["activeAt"] then
  next["activeAt"] = current["activeAt"]
end
if current["revokedAt"] then
  next["revokedAt"] = current["revokedAt"]
end

local indexKey = ARGV[3] .. current["adminUserId"] .. ":" .. current["accountId"]
local indexValue = redis.call("GET", indexKey)
local now = tonumber(ARGV[4])
local ttl = math.max(1, tonumber(next["expiresAt"]) - now)
local nextJson = cjson.encode(next)

if terminal[current["status"]] and not terminal[next["status"]] then
  return {0, "Gateway session is not active"}
end

if terminal[next["status"]] then
  redis.call("PSETEX", KEYS[1], ttl, nextJson)
  if indexValue == ARGV[1] then
    redis.call("DEL", indexKey)
  end
  return {1, nextJson}
end

if indexValue ~= ARGV[1] then
  return {0, "Gateway session is not active"}
end

redis.call("PSETEX", KEYS[1], ttl, nextJson)
redis.call("SET", indexKey, ARGV[1], "PX", ttl)
return {1, nextJson}
`;

@Injectable()
export class NapcatWebuiGatewayRedisStore
  implements NapcatWebuiGatewaySessionStore
{
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

  /**
   * 根据`session`构造NapCat WebUI Redis 会话记录。
   * @param session - 待读取、续期或持久化的NapCat WebUI Redis 会话记录会话。
   * @returns NapCat WebUI Redis 会话记录。
   */
  async create(session: NapcatWebuiGatewaySession) {
    await this.writeSession(session);
    await this.writeUserAccountIndex(session);
    return session;
  }

  /**
   * 按`sessionId`读取NapCat WebUI Redis 会话记录；当 `value` 成立时返回 `(JSON.parse(value) as NapcatWebuiGatewaySes…`。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns NapCat WebUI Redis 会话记录；没有可用结果或提前结束时为 `undefined`。
   */
  async find(sessionId: string) {
    const value = await this.redis.get(this.sessionKey(sessionId));
    if (value) {
      return (JSON.parse(value) as NapcatWebuiGatewaySession);
    }
    return undefined;
  }

  /**
   * 按`adminUserId`、`accountId`读取启用的（按用户与账号匹配）；从 `redis.get` 读取启用的（按用户与账号匹配）。
   * @param adminUserId - 用于精确定位admin用户的标识。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 启用的（按用户与账号匹配）；没有可用结果或提前结束时为 `undefined`。
   */
  async findActiveByUserAndAccount(adminUserId: string, accountId: string) {
    const sessionId = await this.redis.get(
      this.userAccountKey(adminUserId, accountId),
    );
    if (!sessionId) return undefined;

    const session = await this.find(sessionId);
    if (!session || this.isTerminal(session)) return undefined;

    return session;
  }

  /**
   * 根据`sessionId`、`patch`更新NapCat WebUI Redis 会话记录。
   * @param sessionId - 用于精确定位会话的标识。
   * @param patch - 决定NapCat WebUI Redis 会话记录内容、边界或目标的 `patch` 值。
   * @returns 返回 Redis 原子合并补丁后的完整会话快照。
   */
  async update(
    sessionId: string,
    patch: Partial<NapcatWebuiGatewaySession>,
  ) {
    return this.mergeSessionPatchAtomically(sessionId, patch);
  }

  /**
   * 根据`session`更新NapCat WebUI 网关会话。
   * @param session - 待读取、续期或持久化的NapCat WebUI 网关会话。
   */
  private async writeSession(session: NapcatWebuiGatewaySession) {
    await this.redis.psetex(
      this.sessionKey(session.sessionId),
      this.remainingTtlMs(session),
      JSON.stringify(session),
    );
  }

  /**
   * 根据`session`更新用户账号索引。
   * @param session - 待读取、续期或持久化的用户账号索引会话。
   */
  private async writeUserAccountIndex(session: NapcatWebuiGatewaySession) {
    await this.redis.set(
      this.userAccountKey(session.adminUserId, session.accountId),
      session.sessionId,
      'PX',
      this.remainingTtlMs(session),
    );
  }

  /**
   * 根据`sessionId`拼接稳定的Redis 会话键，用于隔离对应资源或存储记录。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 按参数编码并拼接完成的Redis 会话键。
   */
  private sessionKey(sessionId: string) {
    return `${SESSION_KEY_PREFIX}${sessionId}`;
  }

  /**
   * 根据`adminUserId`、`accountId`拼接稳定的Redis 用户账号键，用于隔离对应资源或存储记录。
   * @param adminUserId - 用于精确定位admin用户的标识。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 按参数编码并拼接完成的Redis 用户账号键。
   */
  private userAccountKey(adminUserId: string, accountId: string) {
    return `${USER_ACCOUNT_KEY_PREFIX}${adminUserId}:${accountId}`;
  }

  /**
   * 按边界约束计算剩余有效期毫秒。
   * @param session - 待读取、续期或持久化的按边界约束计算剩余有效期毫秒会话。
   * @returns 按边界约束计算剩余有效期毫秒。
   */
  private remainingTtlMs(session: NapcatWebuiGatewaySession) {
    return Math.max(1, session.expiresAt - this.config.now());
  }

  /**
   * 通过 Redis 脚本校验会话仍有效后原子合并补丁，并返回合并后的会话快照。
   * @param sessionId - 用于精确定位会话的标识。
   * @param patch - 决定会话PatchAtomically内容、边界或目标的 `patch` 值。
   * @returns 返回 Redis 原子合并后的完整会话快照。
   * @throws 当 `!Array.isArray(result) || Number(result[0]) !== 1` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async mergeSessionPatchAtomically(
    sessionId: string,
    patch: Partial<NapcatWebuiGatewaySession>,
  ) {
    const result = (await this.redis.eval(
      UPDATE_SESSION_SCRIPT,
      1,
      this.sessionKey(sessionId),
      sessionId,
      JSON.stringify(patch),
      USER_ACCOUNT_KEY_PREFIX,
      this.config.now(),
    )) as [number, string];
    if (!Array.isArray(result) || Number(result[0]) !== 1) {
      throw new Error(String(result?.[1] || 'Gateway session is not active'));
    }

    return JSON.parse(result[1]) as NapcatWebuiGatewaySession;
  }

  /**
   * 根据`session`与当前约束判定终端。
   * @param session - 待读取、续期或持久化的终端会话。
   * @returns 满足终端约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isTerminal(session: NapcatWebuiGatewaySession) {
    return TERMINAL_SESSION_STATUSES.includes(session.status);
  }
}
