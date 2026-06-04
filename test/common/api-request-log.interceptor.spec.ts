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
import { ApiRequestLogInterceptor, ToolsService } from '../../src/common';

@Controller('probe')
class ProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

function createHttpContext(request: Record<string, any>, response: Record<string, any>) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as any;
}

function createResponse(statusCode = 200) {
  return {
    getHeader: jest.fn(),
    setHeader: jest.fn(),
    statusCode,
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
    const interceptor = new ApiRequestLogInterceptor(
      logger as any,
      new ToolsService(),
    );
    const request: Record<string, any> = {
      headers: {
        'x-request-id': 'req-1',
      },
      method: 'GET',
      originalUrl: '/system/logs?pageNo=1',
    };
    const response = createResponse(200);

    await lastValueFrom(
      interceptor.intercept(createHttpContext(request, response), {
        handle: () => of({ ok: true }),
      }),
    );

    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'req-1');
    expect(request.id).toBe('req-1');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/system/logs',
        requestId: 'req-1',
        statusCode: 200,
      }),
      'HTTP request completed',
    );
  });

  it('writes warning logs with HTTP status for controller errors', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
      setContext: jest.fn(),
      warn: jest.fn(),
    };
    const interceptor = new ApiRequestLogInterceptor(
      logger as any,
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
