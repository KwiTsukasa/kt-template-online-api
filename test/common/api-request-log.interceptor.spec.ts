import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import * as request from 'supertest';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  ApiRequestLogInterceptor,
  LokiLogPublisherService,
  ToolsService,
} from '../../src/common';

@Controller('probe')
class ProbeController {
  /**
   * 执行 测试断言流程。
   */
  @Get()
  probe() {
    return { ok: true };
  }
}

/**
 * 创建 测试断言对象或配置。
 * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
 * @param response - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
 */
function createHttpContext(
  request: Record<string, any>,
  response: Record<string, any>,
) {
  return {
    /**
     * 读取 公共基础设施回调数据。
     */
    getType: () => 'http',
    /**
     * 执行 公共基础设施回调。
     */
    switchToHttp: () => ({
      /**
       * 读取 公共基础设施回调数据。
       */
      getRequest: () => request,
      /**
       * 读取 公共基础设施回调数据。
       */
      getResponse: () => response,
    }),
  } as any;
}

/**
 * 创建 测试断言对象或配置。
 * @param statusCode - statusCode 输入；构造 Jest mock 返回值。
 */
function createResponse(statusCode = 200) {
  return {
    getHeader: jest.fn(),
    setHeader: jest.fn(),
    statusCode,
  };
}

/**
 * 创建 测试断言对象或配置。
 */
function createLokiLogPublisherMock() {
  return {
    pushHttpRequestLog: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * 创建 测试断言对象或配置。
 */
function createSystemNoticePublisherMock() {
  return {
    publishSystemNotice: jest.fn().mockResolvedValue('notice-1'),
  };
}

describe('ApiRequestLogInterceptor', () => {
  it('writes structured HTTP request fields for successful controller calls', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
      setContext: jest.fn(),
      warn: jest.fn(),
    };
    const lokiLogPublisher = createLokiLogPublisherMock();
    const interceptor = new ApiRequestLogInterceptor(
      logger as any,
      lokiLogPublisher as any,
      new ToolsService(),
    );
    const request: Record<string, any> = {
      headers: {
        'x-request-id': 'req-1',
      },
      method: 'GET',
      originalUrl: '/status?source=test',
    };
    const response = createResponse(200);

    await lastValueFrom(
      interceptor.intercept(createHttpContext(request, response), {
        /**
         * 执行 公共基础设施回调。
         */
        handle: () => of({ ok: true }),
      }),
    );

    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'req-1');
    expect(request.id).toBe('req-1');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/status',
        requestId: 'req-1',
        statusCode: 200,
      }),
      'HTTP request completed',
    );
    expect(lokiLogPublisher.pushHttpRequestLog).toHaveBeenCalledWith(
      expect.objectContaining({
        context: ApiRequestLogInterceptor.name,
        level: 'info',
        message: 'HTTP request completed',
        payload: expect.objectContaining({
          method: 'GET',
          path: '/status',
          requestId: 'req-1',
          statusCode: 200,
        }),
      }),
    );
  });

  it('does not publish system log query requests back to Loki', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
      setContext: jest.fn(),
      warn: jest.fn(),
    };
    const lokiLogPublisher = createLokiLogPublisherMock();
    const interceptor = new ApiRequestLogInterceptor(
      logger as any,
      lokiLogPublisher as any,
      new ToolsService(),
    );
    const request: Record<string, any> = {
      headers: {
        'x-request-id': 'req-system-log',
      },
      method: 'GET',
      originalUrl: '/system/logs?pageNo=1',
    };
    const response = createResponse(200);

    await lastValueFrom(
      interceptor.intercept(createHttpContext(request, response), {
        /**
         * 执行 公共基础设施回调。
         */
        handle: () => of({ ok: true }),
      }),
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/system/logs',
        requestId: 'req-system-log',
        statusCode: 200,
      }),
      'HTTP request completed',
    );
    expect(lokiLogPublisher.pushHttpRequestLog).not.toHaveBeenCalled();
  });

  it('writes warning logs with HTTP status for controller errors', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
      setContext: jest.fn(),
      warn: jest.fn(),
    };
    const lokiLogPublisher = createLokiLogPublisherMock();
    const interceptor = new ApiRequestLogInterceptor(
      logger as any,
      lokiLogPublisher as any,
      new ToolsService(),
    );
    const request: Record<string, any> = {
      headers: {},
      method: 'POST',
      path: '/dict/save',
    };
    const response = createResponse(200);
    const error = new HttpException('not found', HttpStatus.NOT_FOUND);

    await expect(
      lastValueFrom(
        interceptor.intercept(createHttpContext(request, response), {
          /**
           * 执行 公共基础设施回调。
           */
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);

    expect(request.id).toEqual(expect.any(String));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/dict/save',
        requestId: request.id,
        statusCode: 404,
      }),
      'HTTP request completed',
    );
    expect(lokiLogPublisher.pushHttpRequestLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        payload: expect.objectContaining({
          method: 'POST',
          path: '/dict/save',
          requestId: request.id,
          statusCode: 404,
        }),
      }),
    );
  });

  it('publishes a super notice when a controller call fails with 5xx', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
      setContext: jest.fn(),
      warn: jest.fn(),
    };
    const lokiLogPublisher = createLokiLogPublisherMock();
    const systemNoticePublisher = createSystemNoticePublisherMock();
    const interceptor = new (ApiRequestLogInterceptor as any)(
      logger,
      lokiLogPublisher,
      new ToolsService(),
      systemNoticePublisher,
    );
    const request: Record<string, any> = {
      headers: {
        'x-request-id': 'req-error',
      },
      method: 'POST',
      originalUrl: '/system/user/save?trace=1',
    };
    const response = createResponse(200);
    const error = new Error('database unavailable');

    await expect(
      lastValueFrom(
        interceptor.intercept(createHttpContext(request, response), {
          /**
           * 执行 公共基础设施回调。
           */
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);

    expect(systemNoticePublisher.publishSystemNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'database unavailable',
        dedupeKey: 'api:error:POST:/system/user/save:500',
        eventType: 'api.error',
        metadata: expect.objectContaining({
          method: 'POST',
          path: '/system/user/save',
          requestId: 'req-error',
          statusCode: 500,
        }),
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'api',
        summary: '500 POST /system/user/save',
        title: '接口错误：POST /system/user/save',
      }),
    );
  });

  it('captures a real local HTTP request in a Nest application', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
      setContext: jest.fn(),
      warn: jest.fn(),
    };
    let app: INestApplication | undefined;

    try {
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
        providers: [
          ToolsService,
          {
            provide: PinoLogger,
            useValue: logger,
          },
          {
            provide: LokiLogPublisherService,
            useValue: createLokiLogPublisherMock(),
          },
          {
            provide: APP_INTERCEPTOR,
            useClass: ApiRequestLogInterceptor,
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer())
        .get('/probe?source=test')
        .set('x-request-id', 'req-real')
        .expect(200);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/probe',
          requestId: 'req-real',
          statusCode: 200,
        }),
        'HTTP request completed',
      );
    } finally {
      await app?.close();
    }
  });
});
