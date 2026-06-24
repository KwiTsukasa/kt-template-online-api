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

  /**
   * Creates the standalone Gateway credential client.
   * @param config - Gateway config used for bounded upstream requests and time.
   */
  constructor(private readonly config: NapcatWebuiGatewayConfigService) {}

  /**
   * Returns a cached or freshly exchanged NapCat WebUI credential for one Gateway session.
   * @param session - Server-only Gateway session metadata containing token and upstream URL.
   * @returns NapCat WebUI Credential string for upstream Authorization.
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
   * Clears a cached credential when a Gateway session is revoked.
   * @param sessionId - Gateway session id whose cached credential should be removed.
   */
  clear(sessionId: string) {
    this.credentials.delete(sessionId);
  }

  /**
   * Exchanges the server-only WebUI token for a NapCat Credential.
   * @param session - Gateway session containing upstream base URL and WebUI token.
   * @returns Credential returned by NapCat WebUI.
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
   * Reads Credential from either the raw NapCat payload or its data wrapper.
   * @param body - Axios response body from `/api/auth/login`.
   * @returns Credential when present.
   */
  private extractCredential(body: NapcatCredentialResponse) {
    if ('data' in body) {
      return body.data?.Credential;
    }
    return (body as NapcatCredentialBody).Credential;
  }
}
