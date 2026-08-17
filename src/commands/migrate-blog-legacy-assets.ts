import { accessSync, constants, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MinioModule } from 'nestjs-minio-client';
import { MinioClientService } from '../modules/asset/application/asset-minio.service';
import {
  BLOG_LEGACY_ASSET_DNS_RESOLVER,
  BLOG_LEGACY_ASSET_MANIFEST_STORE,
  BLOG_LEGACY_ASSET_RAW_HTTP_REQUEST,
  BlogLegacyAssetHttpFetcher,
  BlogLegacyAssetManifestFileStore,
  BlogLegacyAssetMigrationService,
  BlogLegacyAssetMigrationUsageError,
  defaultBlogLegacyAssetDnsResolver,
  defaultBlogLegacyAssetRawHttpRequest,
} from '../modules/blog/application/blog-legacy-asset-migration.service';
import type {
  BlogLegacyAssetMigrationManifest,
  BlogLegacyAssetMigrationOptions,
} from '../modules/blog/domain/blog-legacy-asset-migration.types';
import { BlogArticle } from '../modules/blog/infrastructure/persistence/blog-article.entity';
import { BlogThemeConfig } from '../modules/blog/infrastructure/persistence/blog-theme-config.entity';

type BlogLegacyAssetMigrationCommandDependencies = {
  actualDatabaseIdentity: string;
  inspectBackupPath(path: string): {
    isFile: boolean;
    readable: boolean;
    size: number;
  };
  service: Pick<BlogLegacyAssetMigrationService, 'run'>;
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        database: configService.get<string>('DB_DATABASE'),
        entities: [BlogArticle, BlogThemeConfig],
        host: configService.get<string>('DB_HOST'),
        password: configService.get<string>('DB_PASSWORD'),
        port: Number(configService.get<string>('DB_PORT') || 3306),
        synchronize: false,
        timezone: configService.get<string>('DB_TIMEZONE') || '+08:00',
        type: 'mysql' as const,
        username: configService.get<string>('DB_USERNAME'),
      }),
    }),
    TypeOrmModule.forFeature([BlogArticle, BlogThemeConfig]),
    MinioModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      isGlobal: true,
      useFactory: (configService: ConfigService) => ({
        accessKey: configService.get<string>('MINIO_ACCESS_KEY'),
        endPoint: configService.get<string>('MINIO_ENDPOINT'),
        port: Number(configService.get<string>('MINIO_PORT')),
        secretKey: configService.get<string>('MINIO_SECRET_KEY'),
        useSSL: resolveBlogLegacyAssetMinioUseSsl(
          configService.get<string>('MINIO_USE_SSL'),
        ),
      }),
    }),
  ],
  providers: [
    MinioClientService,
    BlogLegacyAssetHttpFetcher,
    BlogLegacyAssetManifestFileStore,
    BlogLegacyAssetMigrationService,
    {
      provide: BLOG_LEGACY_ASSET_DNS_RESOLVER,
      useValue: defaultBlogLegacyAssetDnsResolver,
    },
    {
      provide: BLOG_LEGACY_ASSET_RAW_HTTP_REQUEST,
      useValue: defaultBlogLegacyAssetRawHttpRequest,
    },
    {
      provide: BLOG_LEGACY_ASSET_MANIFEST_STORE,
      useExisting: BlogLegacyAssetManifestFileStore,
    },
  ],
})
class BlogLegacyAssetMigrationCommandModule {}

/**
 * 从`value`解析博客旧版资源MinIO使用SSL。
 * @param value - 参与博客旧版资源MinIO使用SSL比较、格式化或输出的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足博客旧版资源MinIO使用SSL约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function resolveBlogLegacyAssetMinioUseSsl(value?: string): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * 从`argv`解析博客旧版资源迁移选项；先通过 `assertPath` 校验输入边界。
 * @param argv - 用于博客旧版资源迁移选项的领域对象，包含 `length`、`index`、`index + 1` 字段。
 * @returns 包含 `backupPath`、`databaseIdentity`、`maintenanceConfirmed`、`manifestPath`、`mode` 字段的博客旧版资源迁移选项。
 * @throws 当 `!value || value.startsWith('--')` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `manifestPath` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `argument === '--rollback-manifest'` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `modes.length !== 1` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `!manifestPath` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
 */
export function parseBlogLegacyAssetMigrationOptions(
  argv: string[],
): BlogLegacyAssetMigrationOptions {
  const modes: BlogLegacyAssetMigrationOptions['mode'][] = [];
  let backupPath: string | undefined;
  let databaseIdentity: string | undefined;
  let maintenanceConfirmed = false;
  let manifestPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === '--dry-run' ||
      argument === '--execute' ||
      argument === '--resume' ||
      argument === '--verify'
    ) {
      modes.push(argument.slice(2) as BlogLegacyAssetMigrationOptions['mode']);
      continue;
    }
    if (argument === '--maintenance-confirmed') {
      maintenanceConfirmed = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new BlogLegacyAssetMigrationUsageError(`参数 ${argument} 缺少值`);
    }
    if (argument === '--backup-path') {
      backupPath = value;
    } else if (argument === '--database-identity') {
      databaseIdentity = value;
    } else if (argument === '--manifest-path') {
      if (manifestPath) {
        throw new BlogLegacyAssetMigrationUsageError(
          'manifest 路径只能指定一次',
        );
      }
      manifestPath = value;
    } else if (argument === '--rollback-manifest') {
      modes.push('rollback');
      if (manifestPath) {
        throw new BlogLegacyAssetMigrationUsageError(
          'rollback manifest 路径不能重复指定',
        );
      }
      manifestPath = value;
    } else {
      throw new BlogLegacyAssetMigrationUsageError(`未知参数 ${argument}`);
    }
    index += 1;
  }

  if (modes.length !== 1) {
    throw new BlogLegacyAssetMigrationUsageError('必须且只能指定一个迁移模式');
  }
  if (!manifestPath) {
    throw new BlogLegacyAssetMigrationUsageError(
      '必须由调用方指定 manifest 路径',
    );
  }
  new BlogLegacyAssetManifestFileStore().assertPath(manifestPath);

  return {
    backupPath,
    databaseIdentity,
    maintenanceConfirmed,
    manifestPath,
    mode: modes[0],
  };
}

/**
 * 根据`options`、`dependencies`处理博客旧版资源迁移命令。
 * @param options - 控制博客旧版资源迁移命令筛选、缓存或输出方式的可选项，包含 `mode`、`databaseIdentity`、`maintenanceConfirmed`、`backupPath` 字段。
 * @param dependencies - 用于博客旧版资源迁移命令的领域对象，包含 `actualDatabaseIdentity`、`inspectBackupPath`、`service` 字段。
 * @returns 博客旧版资源迁移命令。
 * @throws 当 `!options.databaseIdentity` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `options.databaseIdentity !== dependencies.actualDatabaseIdentity` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `!options.maintenanceConfirmed` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `!options.backupPath` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `resolve(options.backupPath) === resolve(options.manifestPath)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `!backup.isFile || !backup.readable || backup.size < 1` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
 */
export async function runBlogLegacyAssetMigrationCommand(
  options: BlogLegacyAssetMigrationOptions,
  dependencies: BlogLegacyAssetMigrationCommandDependencies,
): Promise<BlogLegacyAssetMigrationManifest> {
  if (['execute', 'resume', 'rollback'].includes(options.mode)) {
    if (!options.databaseIdentity) {
      throw new BlogLegacyAssetMigrationUsageError(
        `${options.mode} 模式必须提供明确数据库身份`,
      );
    }
    if (options.databaseIdentity !== dependencies.actualDatabaseIdentity) {
      throw new BlogLegacyAssetMigrationUsageError(
        '数据库身份与当前连接不一致',
      );
    }
    if (!options.maintenanceConfirmed) {
      throw new BlogLegacyAssetMigrationUsageError(
        `${options.mode} 模式必须确认维护窗口`,
      );
    }
    if (!options.backupPath) {
      throw new BlogLegacyAssetMigrationUsageError(
        `${options.mode} 模式必须提供现有备份路径`,
      );
    }
    if (resolve(options.backupPath) === resolve(options.manifestPath)) {
      throw new BlogLegacyAssetMigrationUsageError(
        '备份路径不能与 manifest 相同',
      );
    }
    const backup = dependencies.inspectBackupPath(options.backupPath);
    if (!backup.isFile || !backup.readable || backup.size < 1) {
      throw new BlogLegacyAssetMigrationUsageError(
        '备份路径必须是可读的非空普通文件',
      );
    }
  }
  return dependencies.service.run(options);
}

/**
 * 根据`env`构造博客旧版资源迁移数据库身份。
 * @param env - 用于博客旧版资源迁移数据库身份的领域对象，包含 `DB_HOST`、`DB_PORT`、`DB_DATABASE` 字段。
 * @returns 按参数编码并拼接完成的博客旧版资源迁移数据库身份。
 * @throws 当 `!host || !database` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
 */
export function buildBlogLegacyAssetMigrationDatabaseIdentity(
  env: NodeJS.ProcessEnv,
): string {
  const host = env.DB_HOST?.trim();
  const port = env.DB_PORT?.trim() || '3306';
  const database = env.DB_DATABASE?.trim();
  if (!host || !database) {
    throw new BlogLegacyAssetMigrationUsageError('数据库连接身份不完整');
  }
  return `${host}:${port}/${database}`;
}

/**
 * 创建无日志 Nest 上下文执行博客旧资源迁移，输出清单摘要，并在失败时设置非零退出码后关闭应用。
 */
async function main() {
  const options = parseBlogLegacyAssetMigrationOptions(process.argv.slice(2));
  const application = await NestFactory.createApplicationContext(
    BlogLegacyAssetMigrationCommandModule,
    {
      logger: false,
    },
  );
  try {
    const manifest = await runBlogLegacyAssetMigrationCommand(options, {
      actualDatabaseIdentity: buildBlogLegacyAssetMigrationDatabaseIdentity(
        process.env,
      ),
      inspectBackupPath: inspectBlogLegacyAssetBackupPath,
      service: application.get(BlogLegacyAssetMigrationService),
    });
    process.stdout.write(
      `${[
        `mode=${manifest.mode}`,
        `status=${manifest.status}`,
        `entries=${manifest.entries.length}`,
      ].join(' ')}\n`,
    );
    if (manifest.status === 'failed') process.exitCode = 1;
  } finally {
    await application.close();
  }
}

/**
 * 根据`path`拼接稳定的博客旧版资源备份路径，用于隔离对应资源或存储记录。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 包含 `isFile`、`readable`、`size` 字段的博客旧版资源备份路径。
 */
function inspectBlogLegacyAssetBackupPath(path: string) {
  try {
    accessSync(path, constants.R_OK);
    const stat = statSync(path);
    return {
      isFile: stat.isFile(),
      readable: true,
      size: stat.size,
    };
  } catch {
    return {
      isFile: false,
      readable: false,
      size: 0,
    };
  }
}

if (require.main === module) {
  void main().catch((error) => {
    if (error instanceof BlogLegacyAssetMigrationUsageError) {
      console.error(error.message);
    } else {
      console.error('Blog legacy asset migration failed');
    }
    process.exitCode = 1;
  });
}
