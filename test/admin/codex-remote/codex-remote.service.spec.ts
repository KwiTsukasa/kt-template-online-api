import { createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodexRemoteService } from '../../../src/modules/admin/codex-remote/application/codex-remote.service';

describe('CodexRemoteService', () => {
  const sharedSecret = Buffer.alloc(32, 9).toString('hex');
  const projectJson = JSON.stringify([
    { cwd: '/home/kt/workspace', id: 'kt', label: 'KT Workspace' },
  ]);

  it('returns only fully configured fixed WireGuard nodes', () => {
    const service = new CodexRemoteService(
      new ConfigService({
        CODEX_REMOTE_NAS_PROJECTS_JSON: projectJson,
        CODEX_REMOTE_NAS_WS_SHARED_SECRET: sharedSecret,
        CODEX_REMOTE_NAS_WS_URL: 'ws://10.66.66.2:48093',
        CODEX_REMOTE_PC_PROJECTS_JSON: projectJson,
        CODEX_REMOTE_PC_WS_SHARED_SECRET: sharedSecret,
        CODEX_REMOTE_PC_WS_URL: 'ws://10.66.66.4:48093',
      }),
    );

    expect(service.nodes()).toEqual([
      {
        id: 'nas',
        label: 'Tsukasa NAS',
        projects: [
          { cwd: '/home/kt/workspace', id: 'kt', label: 'KT Workspace' },
        ],
        wsUrl: 'ws://10.66.66.2:48093',
      },
      {
        id: 'pc',
        label: 'Windows PC',
        projects: [
          { cwd: '/home/kt/workspace', id: 'kt', label: 'KT Workspace' },
        ],
        wsUrl: 'ws://10.66.66.4:48093',
      },
    ]);
  });

  it('issues an App Server compatible short HS256 token bound to node and project', () => {
    const service = new CodexRemoteService(
      new ConfigService({
        CODEX_REMOTE_NAS_PROJECTS_JSON: projectJson,
        CODEX_REMOTE_NAS_WS_SHARED_SECRET: sharedSecret,
        CODEX_REMOTE_NAS_WS_URL: 'ws://10.66.66.2:48093',
      }),
    );
    const session = service.createSession('nas', 'kt', {
      id: '2041700000000000002',
      username: 'kwitsukasa',
    } as never);
    const [header, payload, signature] = session.token.split('.');
    if (!header || !payload || !signature) {
      throw new Error('session token segments are missing');
    }
    const expected = createHmac('sha256', sharedSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );

    expect(signature).toBe(expected);
    expect(claims).toEqual(
      expect.objectContaining({
        aud: 'kt-codex-remote-nas',
        iss: 'kt-admin-sso',
        nodeId: 'nas',
        projectId: 'kt',
        sub: '2041700000000000002',
        username: 'kwitsukasa',
      }),
    );
    expect(claims.exp - claims.iat).toBe(120);
    expect(session.wsUrl).toBe('ws://10.66.66.2:48093');
  });

  it('rejects a project that is not declared by the selected node', () => {
    const service = new CodexRemoteService(
      new ConfigService({
        CODEX_REMOTE_NAS_PROJECTS_JSON: projectJson,
        CODEX_REMOTE_NAS_WS_SHARED_SECRET: sharedSecret,
        CODEX_REMOTE_NAS_WS_URL: 'ws://10.66.66.2:48093',
      }),
    );

    expect(() =>
      service.createSession('nas', 'other', {
        id: '2041700000000000002',
        username: 'kwitsukasa',
      } as never),
    ).toThrow(BadRequestException);
  });
});
