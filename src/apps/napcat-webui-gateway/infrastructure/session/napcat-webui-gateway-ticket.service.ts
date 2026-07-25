import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import { NapcatWebuiGatewayConfigService } from '../../config/napcat-webui-gateway-config.service';

const TICKET_KEY_PREFIX = 'napcat:webui:ticket:';

@Injectable()
export class NapcatWebuiGatewayTicketService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

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

  async redeem(ticket: string) {
    const key = this.ticketKey(ticket);
    const sessionId = await this.redis.getdel(key);
    return sessionId || undefined;
  }

  private createTicket() {
    return randomBytes(32).toString('base64url');
  }

  private ticketKey(ticket: string) {
    return `${TICKET_KEY_PREFIX}${ticket}`;
  }
}
