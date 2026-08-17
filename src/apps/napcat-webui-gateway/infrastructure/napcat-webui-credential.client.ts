import { createHash } from 'node:crypto';
import axios from 'axios';
import { BadGatewayException, Injectable } from '@nestjs/common';
import { NapcatWebuiGatewayConfigService } from '../config/napcat-webui-gateway-config.service';
import type { NapcatWebuiGatewaySession } from '../domain/napcat-webui-gateway.types';

type NapcatCredentialBody = {
  Credential?: string;
};

type NapcatCredentialResponse =
  | NapcatCredentialBody
  | {
      data?: NapcatCredentialBody;
    };

@Injectable()
export class NapcatWebuiCredentialClient {
  private readonly credentials = new Map<
    string,
    { credential: string; expiresAt: number }
  >();

  constructor(private readonly config: NapcatWebuiGatewayConfigService) {}

  /**
   * 按`session`读取凭据；当 `cached && now < cached.expiresAt && cached.expiresAt <= sessi…` 成立时返回 `cached.credential`。
   * @param session - 待读取、续期或持久化的凭据会话。
   * @returns 凭据。
   */
  async getCredential(session: NapcatWebuiGatewaySession) {
    const cached = this.credentials.get(session.sessionId);
    const now = this.config.now();
    if (
      cached &&
      now < cached.expiresAt &&
      cached.expiresAt <= session.expiresAt
    ) {
      return cached.credential;
    }

    const credential = await this.exchangeCredential(session);
    this.credentials.set(session.sessionId, {
      credential,
      expiresAt: session.expiresAt,
    });
    return credential;
  }

  /**
   * 按`sessionId`移除清空NapCatWebUI凭据记录。
   * @param sessionId - 用于精确定位会话的标识。
   */
  clear(sessionId: string) {
    this.credentials.delete(sessionId);
  }

  /**
   * 以统一异常拒绝交换凭据。
   * @param session - 待读取、续期或持久化的以统一异常拒绝交换凭据会话。
   * @returns 以统一异常拒绝交换凭据。
   * @throws 当 `!credential` 成立时拒绝当前输入并抛出 `Error`；当 `axios.post` 或 `toString` 调用失败时拒绝当前输入并抛出 `BadGatewayException`。
   */
  private async exchangeCredential(session: NapcatWebuiGatewaySession) {
    const hash = createHash('sha256')
      .update(`${session.webuiToken}.napcat`)
      .digest('hex');

    try {
      const response = await axios.post<NapcatCredentialResponse>(
        new URL('/api/auth/login', session.upstreamBaseUrl).toString(),
        { hash },
        {
          timeout: this.config.upstreamTimeoutMs(),
        },
      );
      const credential = this.extractCredential(response.data);
      if (!credential) {
        throw new Error('Missing Credential');
      }
      return credential;
    } catch {
      throw new BadGatewayException('NapCat WebUI credential exchange failed');
    }
  }

  /**
   * 从输入中提取凭据。
   * @param body - 用于从输入中提取凭据的结构化输入，包含 `data` 字段。
   * @returns 从输入中提取凭据。
   */
  private extractCredential(body: NapcatCredentialResponse) {
    if ('data' in body) {
      return body.data?.Credential;
    }
    return (body as NapcatCredentialBody).Credential;
  }
}
