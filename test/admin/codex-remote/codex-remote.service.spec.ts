import { createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodexRemoteService } from '../../../src/modules/admin/codex-remote/application/codex-remote.service';

describe('CodexRemoteService', () => {
  const sharedSecret = Buffer.alloc(32, 9).toString('hex');
  const projectJson = JSON.stringify([
    {
      cwd: 'D:\\MyFiles\\KT',
      id: 'kt',
      label: 'KT Workspace',
      readOnlyCwdAliases: [
        '/home/yemu2/KT',
        '\\\\wsl$\\Debian\\home\\yemu2\\KT',
      ],
    },
  ]);

  it('returns only fully configured fixed WireGuard nodes', () => {
    const service = new CodexRemoteService(
      new ConfigService({
        CODEX_REMOTE_PC_PROJECTS_JSON: projectJson,
        CODEX_REMOTE_PC_WS_SHARED_SECRET: sharedSecret,
        CODEX_REMOTE_PC_WS_URL: 'ws://10.66.66.4:48095',
      }),
    );

    expect(service.nodes()).toEqual([
      {
        id: 'pc',
        label: 'Windows PC',
        projects: [
          {
            cwd: 'D:\\MyFiles\\KT',
            id: 'kt',
            label: 'KT Workspace',
            readOnlyCwdAliases: [
              '/home/yemu2/KT',
              '\\\\wsl$\\Debian\\home\\yemu2\\KT',
            ],
          },
        ],
        wsUrl: 'ws://10.66.66.4:48095',
      },
    ]);
  });

  it('issues an App Server compatible short HS256 token bound to node and project', () => {
    const service = new CodexRemoteService(
      new ConfigService({
        CODEX_REMOTE_PC_PROJECTS_JSON: projectJson,
        CODEX_REMOTE_PC_WS_SHARED_SECRET: sharedSecret,
        CODEX_REMOTE_PC_WS_URL: 'ws://10.66.66.4:48095',
      }),
    );
    const session = service.createSession('pc', 'kt', {
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
        aud: 'kt-codex-remote-pc',
        iss: 'kt-admin-sso',
        nodeId: 'pc',
        projectCwd: 'D:\\MyFiles\\KT',
        projectId: 'kt',
        sub: '2041700000000000002',
        username: 'kwitsukasa',
      }),
    );
    expect(claims.exp - claims.iat).toBe(120);
    expect(session.wsUrl).toBe('ws://10.66.66.4:48095');
    expect(session.project.readOnlyCwdAliases).toEqual([
      '/home/yemu2/KT',
      '\\\\wsl$\\Debian\\home\\yemu2\\KT',
    ]);
  });

  it('rejects a project that is not declared by the selected node', () => {
    const service = new CodexRemoteService(
      new ConfigService({
        CODEX_REMOTE_PC_PROJECTS_JSON: projectJson,
        CODEX_REMOTE_PC_WS_SHARED_SECRET: sharedSecret,
        CODEX_REMOTE_PC_WS_URL: 'ws://10.66.66.4:48095',
      }),
    );

    expect(() =>
      service.createSession('pc', 'other', {
        id: '2041700000000000002',
        username: 'kwitsukasa',
      } as never),
    ).toThrow(BadRequestException);
  });

  it.each([
    '/home/yemu2/KT',
    '\\\\wsl$\\Debian\\home\\yemu2\\KT',
    'D:relative',
    'D:\\MyFiles\\KT\nother',
  ])('rejects non-canonical writer cwd %s', (cwd) => {
    const service = new CodexRemoteService(
      new ConfigService({
        CODEX_REMOTE_PC_PROJECTS_JSON: JSON.stringify([
          { cwd, id: 'kt', label: 'KT Workspace' },
        ]),
        CODEX_REMOTE_PC_WS_SHARED_SECRET: sharedSecret,
        CODEX_REMOTE_PC_WS_URL: 'ws://10.66.66.4:48095',
      }),
    );
    expect(service.nodes()).toEqual([]);
  });
});
