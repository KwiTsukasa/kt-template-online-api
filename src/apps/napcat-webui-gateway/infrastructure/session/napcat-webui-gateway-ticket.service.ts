import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import { NapcatWebuiGatewayConfigService } from '../../config/napcat-webui-gateway-config.service';

const TICKET_KEY_PREFIX = 'napcat:webui:ticket:';

@Injectable()
export class NapcatWebuiGatewayTicketService {
  /**
   * Creates the Redis-backed one-time bootstrap ticket service.
   * @param redis - ioredis client injected by @nestjs-modules/ioredis.
   * @param config - Gateway config used to bound ticket TTL.
   */
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

  /**
   * Issues a one-time bootstrap ticket for a Gateway session.
   * @param sessionId - Gateway session id the ticket can activate.
   * @returns URL-safe opaque bootstrap ticket.
   */
  async issue(sessionId: string) {
    const ticket = this.createTicket();
    await this.redis.set(
      this.ticketKey(ticket),
      sessionId,
      'PX',
      this.config.ticketTtlMs(),
    );
    return ticket;
  }

  /**
   * Redeems a ticket once with Redis GETDEL so deletion happens before returning.
   * @param ticket - Opaque ticket from the bootstrap iframe URL.
   * @returns Session id when the ticket existed, otherwise undefined.
   */
  async redeem(ticket: string) {
    const key = this.ticketKey(ticket);
    const sessionId = await this.redis.getdel(key);
    return sessionId || undefined;
  }

  /**
   * Generates a URL-safe random ticket value.
   * @returns Opaque bootstrap ticket.
   */
  private createTicket() {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Builds the Redis ticket key.
   * @param ticket - Opaque bootstrap ticket.
   * @returns Redis key for one-time ticket storage.
   */
  private ticketKey(ticket: string) {
    return `${TICKET_KEY_PREFIX}${ticket}`;
  }
}
