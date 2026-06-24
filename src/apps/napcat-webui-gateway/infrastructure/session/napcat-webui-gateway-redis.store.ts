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
local next = cjson.decode(ARGV[2])
local terminal = { expired = true, failed = true, revoked = true }
local indexValue = redis.call("GET", KEYS[2])

if terminal[current["status"]] and not terminal[next["status"]] then
  return {0, "Gateway session is not active"}
end

if terminal[next["status"]] then
  redis.call("PSETEX", KEYS[1], ARGV[3], ARGV[2])
  if indexValue == ARGV[1] then
    redis.call("DEL", KEYS[2])
  end
  return {1, ARGV[2]}
end

if indexValue and indexValue ~= ARGV[1] then
  return {0, "Gateway session is not active"}
end

redis.call("PSETEX", KEYS[1], ARGV[3], ARGV[2])
redis.call("SET", KEYS[2], ARGV[1], "PX", ARGV[4])
return {1, ARGV[2]}
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
    const current = await this.find(sessionId);
    if (!current) throw new Error('Gateway session is not active');

    const next = {
      ...current,
      ...patch,
      sessionId,
    };
    if (this.isTerminal(current) && !this.isTerminal(next)) {
      throw new Error('Gateway terminal session cannot become active');
    }

    await this.writeSessionAndIndexAtomically(next);

    return next;
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
   * Atomically writes session JSON and maintains the user/account index.
   * @param session - Already-merged Gateway session to commit.
   */
  private async writeSessionAndIndexAtomically(
    session: NapcatWebuiGatewaySession,
  ) {
    const sessionJson = JSON.stringify(session);
    const result = (await this.redis.eval(
      UPDATE_SESSION_SCRIPT,
      2,
      this.sessionKey(session.sessionId),
      this.userAccountKey(session.adminUserId, session.accountId),
      session.sessionId,
      sessionJson,
      this.remainingTtlMs(session),
      this.remainingTtlMs(session),
    )) as [number, string];
    if (!Array.isArray(result) || Number(result[0]) !== 1) {
      throw new Error(String(result?.[1] || 'Gateway session is not active'));
    }
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
