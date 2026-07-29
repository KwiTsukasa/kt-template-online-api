import { knife4jSetup } from '@kwitsukasa/knife4j-swagger-vue3';
import type { Service } from '@kwitsukasa/knife4j-swagger-vue3';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import {
  applySwaggerResponseExamples,
  ClientIpService,
  PublicRateLimitService,
} from './common';
import type {
  PublicRateLimitOutcome,
  SwaggerDocumentGroup,
  SwaggerPathMatcher,
} from './common';

const adminSwaggerPathPrefixes = [
  '/auth',
  '/component',
  '/dict',
  '/menu',
  '/system',
  '/timezone',
  '/user',
  '/demo',
  '/status',
  '/table',
  '/test',
  '/upload',
];

const swaggerGroups: SwaggerDocumentGroup[] = [
  {
    matcher: (path) => matchPathPrefixes(path, adminSwaggerPathPrefixes),
    name: 'Admin 后台管理',
    path: 'api/admin',
  },
  {
    matcher: (path) => path.startsWith('/qqbot'),
    name: 'QQBot 机器人',
    path: 'api/qqbot',
  },
  {
    matcher: (path) => path.startsWith('/wordpress'),
    name: 'WordPress 博客',
    path: 'api/wordpress',
  },
  {
    matcher: (path) =>
      path === '/' || path.startsWith('/minio') || path.startsWith('/health'),
    name: '基础能力',
    path: 'api/basic',
  },
];

/**
 * 执行 当前模块流程。
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const clientIpService = app.get(ClientIpService);
  const rateLimitService = app.get(PublicRateLimitService);
  app.set('trust proxy', (address: string) =>
    clientIpService.isTrustedProxy(address),
  );
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  app.use((request, response, next) => {
    if (!rateLimitService.isManagementSurface(request)) {
      next();
      return;
    }

    void rateLimitService
      .consume(request)
      .then((outcome) => {
        if (outcome.allowed) {
          next();
          return;
        }
        sendRateLimitRejection(response, outcome);
      })
      .catch(next);
  });

  const options = new DocumentBuilder()
    .setTitle('KT-Template API')
    .setVersion('1.0')
    .build();
  const document = applySwaggerResponseExamples(
    SwaggerModule.createDocument(app, options),
  );
  SwaggerModule.setup('api', app, document);
  const services: Service[] = [
    {
      name: '全量接口',
      url: '/api-json',
    },
  ];

  swaggerGroups.forEach((group) => {
    const groupDocument = filterSwaggerDocument(document, group.matcher);
    SwaggerModule.setup(group.path, app, groupDocument);
    services.push({
      name: group.name,
      url: `/${group.path}-json`,
    });
  });

  // 启用knife4j增强（关键代码）
  knife4jSetup(app, services);

  await app.listen(48085);
}

/**
 * 返回适配器层管理页面的安全边界拒绝响应。
 * @param response - 当前 HTTP 响应；设置限流状态与重试提示。
 * @param outcome - 限流判定结果；决定拒绝状态和固定文案。
 */
function sendRateLimitRejection(
  response: Response,
  outcome: PublicRateLimitOutcome,
) {
  if (outcome.retryAfterSeconds) {
    response.setHeader('Retry-After', String(outcome.retryAfterSeconds));
  }
  const status = outcome.statusCode || 429;
  const message =
    status === 403
      ? '当前来源无权访问接口文档'
      : status === 503
        ? '登录限流服务暂不可用'
        : '请求过于频繁，请稍后重试';
  response.status(status).json({
    code: status,
    err: message,
    msg: message,
  });
}

/**
 * 执行 当前模块流程。
 * @param document - document 输入；使用 `paths`、`tags` 字段生成结果。
 * @param matcher - matcher 输入；驱动 `Object.fromEntries()` 的 模块步骤。
 * @returns 当前模块产出的 OpenAPIObject。
 */
function filterSwaggerDocument(
  document: OpenAPIObject,
  matcher: SwaggerPathMatcher,
): OpenAPIObject {
  const paths = Object.fromEntries(
    Object.entries(document.paths).filter(([path]) => matcher(path)),
  ) as OpenAPIObject['paths'];
  const usedTags = new Set<string>();

  Object.values(paths).forEach((pathItem) => {
    Object.values(pathItem || {}).forEach((operation) => {
      const tags = (operation as any)?.tags;
      if (Array.isArray(tags)) {
        tags.forEach((tag) => usedTags.add(tag));
      }
    });
  });

  return {
    ...document,
    paths,
    tags: document.tags?.filter((tag) => usedTags.has(tag.name)),
  };
}

/**
 * 执行 当前模块流程。
 * @param path - 路由或文件路径；计算 模块布尔判断。
 * @param prefixes - 模块列表；计算 模块布尔判断。
 */
function matchPathPrefixes(path: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

bootstrap();
