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

export function resolveBlogLegacyAssetMinioUseSsl(value?: string): boolean {
  return value?.trim().toLowerCase() === 'true';
}

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
