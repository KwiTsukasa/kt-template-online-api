import { ConfigService } from '@nestjs/config';
import { SystemLogService } from '../../../src/modules/admin/platform-config/system-log/system-log.service';
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
  it('uses Loki aggregate count as page total', async () => {
    const service = createService();
    const requestJson = jest
      .spyOn(service as any, 'requestJson')
      .mockImplementation(async (url: URL) => {
        if (url.pathname.endsWith('/query')) {
          expect(url.searchParams.get('query')).toContain(
            'sum(count_over_time(',
          );
          return {
            data: {
              result: [
                {
                  value: [1780576200, '12'],
                },
              ],
            },
            status: 'success',
          };
        }

        return {
          data: {
            result: [
              {
                stream: {
                  context: 'ApiRequestLogInterceptor',
                  hostname: 'api-pod',
                },
                values: [
                  [
                    '1780576200000000000',
                    JSON.stringify({
                      durationMs: 18,
                      level: 30,
                      method: 'GET',
                      msg: 'HTTP request completed',
                      path: '/system/logs',
                      requestId: 'req-1',
                      statusCode: 200,
                    }),
                  ],
                ],
              },
            ],
          },
          status: 'success',
        };
      });

    const result = await service.page({
      pageNo: 1,
      pageSize: 10,
      requestId: 'req-1',
    });

    expect(result.total).toBe(12);
    expect(result.items).toHaveLength(1);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it('uses Loki aggregate counts for summary cards', async () => {
    const service = createService();
    jest.spyOn(service as any, 'requestJson').mockResolvedValue({
      data: {
        result: [
          {
            metric: { level: 'info' },
            value: [1780576200, '8'],
          },
          {
            metric: { level: 'error' },
            value: [1780576200, '2'],
          },
        ],
      },
      status: 'success',
    });

    await expect(service.summary({ rangeMinutes: 10 })).resolves.toEqual([
      { count: 0, level: 'debug' },
      { count: 8, level: 'info' },
      { count: 0, level: 'warning' },
      { count: 2, level: 'error' },
      { count: 0, level: 'critical' },
    ]);
  });

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
