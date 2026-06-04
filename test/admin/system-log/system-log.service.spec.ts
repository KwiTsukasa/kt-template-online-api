import { ConfigService } from '@nestjs/config';
import { SystemLogService } from '../../../src/admin/system-log/system-log.service';
import { ToolsService } from '../../../src/common';

function createService() {
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        LOKI_QUERY_HOST: 'http://kt-loki:3100',
        NODE_ENV: 'production',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  return new SystemLogService(configService, new ToolsService());
}

describe('SystemLogService', () => {
  it('parses structured HTTP request fields from top-level Loki log lines', () => {
    const service = createService();
    const result = (service as any).serializeLog({
      line: JSON.stringify({
        durationMs: 18,
        level: 30,
        method: 'get',
        msg: 'HTTP request completed',
        path: '/system/logs?pageNo=1',
        requestId: 'req-1',
        statusCode: 200,
      }),
      rowIndex: 0,
      stream: {
        hostname: 'api-pod',
      },
      streamIndex: 0,
      timestampNs: '1760000000000000000',
    });

    expect(result).toEqual(
      expect.objectContaining({
        durationMs: 18,
        method: 'GET',
        path: '/system/logs',
        requestId: 'req-1',
        statusCode: 200,
      }),
    );
  });

  it('keeps compatibility with pino-http nested request logs', () => {
    const service = createService();
    const result = (service as any).serializeLog({
      line: JSON.stringify({
        durationMs: 6,
        level: 30,
        msg: 'request completed',
        req: {
          id: 'req-2',
          method: 'POST',
          url: '/dict/save?debug=true',
        },
        res: {
          statusCode: 201,
        },
      }),
      rowIndex: 0,
      stream: {},
      streamIndex: 0,
      timestampNs: '1760000000000000000',
    });

    expect(result).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/dict/save',
        requestId: 'req-2',
        statusCode: 201,
      }),
    );
  });
});
