import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { urlencoded, json } from 'express';
import { knife4jSetup } from '@kwitsukasa/knife4j-swagger-vue3';
import type { Service } from '@kwitsukasa/knife4j-swagger-vue3';
import type { SwaggerDocumentGroup, SwaggerPathMatcher } from './common';
import { applySwaggerResponseExamples } from './common';

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
    matcher: (path) => path === '/' || path.startsWith('/minio'),
    name: '基础能力',
    path: 'api/basic',
  },
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

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

function matchPathPrefixes(path: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

bootstrap();
