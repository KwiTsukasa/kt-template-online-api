import { knife4jSetup } from '@kwitsukasa/knife4j-swagger-vue3';
import type { Service } from '@kwitsukasa/knife4j-swagger-vue3';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
  '/llm',
  '/menu',
  '/media-governance',
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
    matcher: (path) =>
      path.startsWith('/bot/') || path.startsWith('/bot-adapter/'),
    name: 'Bot 管理',
    path: 'api/bot',
  },
  {
    matcher: (path) => path.startsWith('/plugin-platform/'),
    name: '插件平台',
    path: 'api/plugin-platform',
  },
  {
    matcher: (path) =>
      path === '/' || path.startsWith('/minio') || path.startsWith('/health'),
    name: '基础能力',
    path: 'api/basic',
  },
];

/**
 * 根据当前运行态处理bootstrap；从 `app.get` 读取bootstrap。
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  const clientIpService = app.get(ClientIpService);
  const rateLimitService = app.get(PublicRateLimitService);
  app.set('trust proxy', (address: string) =>
    clientIpService.isTrustedProxy(address),
  );
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '50mb' });
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
 * 根据限流结果设置 `Retry-After` 与 HTTP 状态，并发送不泄露内部细节的固定拒绝文案。
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
  const message = (() => {
    if (status === 403) {
      return '当前来源无权访问接口文档';
    }
    if (status === 503) {
      return '登录限流服务暂不可用';
    }
    return '请求过于频繁，请稍后重试';
  })();
  response.status(status).json({
    code: status,
    err: message,
    msg: message,
  });
}

/**
 * 从`document`、`matcher`筛选SwaggerDocument，并保持保留项的原有顺序与键名。
 * @param document - 用于SwaggerDocument的领域对象，包含 `paths`、`tags` 字段。
 * @param matcher - 决定SwaggerDocument内容、边界或目标的 `matcher` 值。
 * @returns 包含 `paths`、`tags` 字段的SwaggerDocument。
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
 * 仅当路径等于某个前缀，或以该前缀加层级分隔符开头时返回 `true`。
 * @param path - 必须保持在受控根目录内的路径。
 * @param prefixes - 决定仅当路径等于某个前缀，或以该前缀加层级分隔符开头时返回 `true`内容、边界或目标的 `prefixes` 值。
 * @returns 满足仅当路径等于某个前缀，或以该前缀加层级分隔符开头时返回 `true`约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function matchPathPrefixes(path: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

bootstrap();
