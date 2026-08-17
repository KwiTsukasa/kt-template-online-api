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

  /** 读取凭据。 */
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

  /** 清空NapCatWebUI凭据记录。 */
  clear(sessionId: string) {
    this.credentials.delete(sessionId);
  }

  /** 返回交换凭据。 */
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

  /** 返回提取凭据。 */
  private extractCredential(body: NapcatCredentialResponse) {
    if ('data' in body) {
      return body.data?.Credential;
    }
    return (body as NapcatCredentialBody).Credential;
  }
}
