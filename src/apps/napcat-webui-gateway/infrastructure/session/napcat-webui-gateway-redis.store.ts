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
  /**
   * Creates the Redis-backed Gateway session store.
   * @param redis - ioredis client injected by @nestjs-modules/ioredis.
   * @param config - Gateway config used for TTL calculations.
   */
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

  /**
   * Stores a newly created Gateway session and its user/account lookup index.
   * @param session - Session metadata to persist.
   * @returns Persisted session.
   */
  async create(session: NapcatWebuiGatewaySession) {
    await this.writeSession(session);
    await this.writeUserAccountIndex(session);
    return session;
  }

  /**
   * Finds a Gateway session by id.
   * @param sessionId - Gateway session id.
   * @returns Parsed session or undefined.
   */
  async find(sessionId: string) {
    const value = await this.redis.get(this.sessionKey(sessionId));
    return value
      ? (JSON.parse(value) as NapcatWebuiGatewaySession)
      : undefined;
  }

  /**
   * Finds a non-terminal session through the user/account index.
   * @param adminUserId - Admin actor id.
   * @param accountId - QQBot account id.
   * @returns Active or created session, ignoring terminal states.
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
   * Merges a partial session patch and refreshes session/index TTLs.
   * @param sessionId - Gateway session id.
   * @param patch - Fields to merge into the stored session.
   * @returns Updated session.
   */
  async update(
    sessionId: string,
    patch: Partial<NapcatWebuiGatewaySession>,
  ) {
    return this.mergeSessionPatchAtomically(sessionId, patch);
  }

  /**
   * Writes the session JSON with a PX TTL based on its remaining lifetime.
   * @param session - Gateway session to serialize.
   */
  private async writeSession(session: NapcatWebuiGatewaySession) {
    await this.redis.psetex(
      this.sessionKey(session.sessionId),
      this.remainingTtlMs(session),
      JSON.stringify(session),
    );
  }

  /**
   * Writes the user/account lookup index with the same session lifetime.
   * @param session - Gateway session used to derive the index key.
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
   * Builds the Redis session key.
   * @param sessionId - Gateway session id.
   * @returns Redis key for session JSON.
   */
  private sessionKey(sessionId: string) {
    return `${SESSION_KEY_PREFIX}${sessionId}`;
  }

  /**
   * Builds the Redis user/account index key.
   * @param adminUserId - Admin actor id.
   * @param accountId - QQBot account id.
   * @returns Redis key pointing to the active session id.
   */
  private userAccountKey(adminUserId: string, accountId: string) {
    return `${USER_ACCOUNT_KEY_PREFIX}${adminUserId}:${accountId}`;
  }

  /**
   * Calculates a positive Redis TTL from the session expiry timestamp.
   * @param session - Gateway session with expiresAt.
   * @returns Positive TTL in milliseconds.
   */
  private remainingTtlMs(session: NapcatWebuiGatewaySession) {
    return Math.max(1, session.expiresAt - this.config.now());
  }

  /**
   * Atomically merges a patch into current Redis JSON and maintains the index.
   * @param sessionId - Gateway session id to update.
   * @param patch - Partial session fields to merge inside Redis.
   * @returns Final merged session returned by the Lua script.
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
   * Checks whether the session has reached a terminal lifecycle status.
   * @param session - Gateway session to inspect.
   * @returns Whether the session must be ignored by active lookups.
   */
  private isTerminal(session: NapcatWebuiGatewaySession) {
    return TERMINAL_SESSION_STATUSES.includes(session.status);
  }
}
