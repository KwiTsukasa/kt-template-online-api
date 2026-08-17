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

  /**
   * 生成随机的一次性网关票据，并按配置有效期把票据到会话的映射写入 Redis。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 返回可在有效期内兑换一次的随机网关票据。
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
   * 原子消费一次性票据并返回兑换。
   * @param ticket - 决定原子消费一次性票据并返回兑换内容、边界或目标的 `ticket` 值。
   * @returns 返回票据绑定的会话标识；票据不存在或已消费时为 `undefined`。
   */
  async redeem(ticket: string) {
    const key = this.ticketKey(ticket);
    const sessionId = await this.redis.getdel(key);
    return sessionId || undefined;
  }

  /**
   * 根据当前运行态构造票据。
   * @returns 票据。
   */
  private createTicket() {
    return randomBytes(32).toString('base64url');
  }

  /**
   * 根据`ticket`拼接稳定的票据键，用于隔离对应资源或存储记录。
   * @param ticket - 决定票据键内容、边界或目标的 `ticket` 值。
   * @returns 按参数编码并拼接完成的票据键。
   */
  private ticketKey(ticket: string) {
    return `${TICKET_KEY_PREFIX}${ticket}`;
  }
}
