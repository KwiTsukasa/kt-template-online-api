import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'path';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwVbenError } from '@/common';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '@/modules/qqbot/plugin-platform/domain/manifest';

type PluginPackageBody = {
  packageHash?: string;
  packagePath?: string;
};

type PackedPluginFile = {
  path: string;
  sha256: string;
};

type PackedPluginPackage = {
  contentHash?: unknown;
  files?: unknown;
  manifest?: unknown;
};

export type QqbotValidatedPluginPackage = {
  manifest: QqbotPluginManifest;
  packageHash: string;
  packagePath: string;
  packageSizeBytes: number;
};

const PACKAGE_EXTENSION = '.qqbot-plugin.json';
const DEFAULT_MAX_PACKAGE_BYTES = 20 * 1024 * 1024;

const sha256 = (content: Buffer | string) =>
  createHash('sha256').update(content).digest('hex');

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const isInsideDirectory = (parent: string, child: string) => {
  const relativePath = relative(parent, child);
  return (
    relativePath === '' ||
    (!!relativePath &&
      !relativePath.startsWith('..') &&
      !isAbsolute(relativePath))
  );
};

@Injectable()
export class QqbotPluginPackageReaderService {
  constructor(
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  readPackage(body: PluginPackageBody): QqbotValidatedPluginPackage {
    const packagePath = this.resolvePackagePath(body.packagePath);
    const packageSizeBytes = statSync(packagePath).size;
    const maxPackageBytes = this.getMaxPackageBytes();

    if (packageSizeBytes > maxPackageBytes) {
      throwVbenError('QQBot 插件包超过大小限制');
    }

    let packedPlugin: PackedPluginPackage;
    try {
      packedPlugin = JSON.parse(readFileSync(packagePath, 'utf8'));
    } catch (error) {
      throwVbenError('QQBot 插件包不是合法 JSON', undefined, error);
    }

    const files = this.normalizePackageFiles(packedPlugin.files);
    const contentHash = this.normalizeContentHash(packedPlugin.contentHash);
    const expectedHash = sha256(
      stableStringify({
        files,
        manifest: packedPlugin.manifest,
      }),
    );

    if (contentHash !== expectedHash) {
      throwVbenError('QQBot 插件包 hash 校验失败');
    }
    if (body.packageHash && body.packageHash !== expectedHash) {
      throwVbenError('QQBot 插件包 hash 与请求不一致');
    }

    return {
      manifest: parseQqbotPluginManifest(packedPlugin.manifest, {
        pluginRoot: dirname(packagePath),
      }),
      packageHash: expectedHash,
      packagePath,
      packageSizeBytes,
    };
  }

  private resolvePackagePath(packagePath?: string) {
    if (!packagePath) throwVbenError('请选择插件包路径');

    const resolvedPath = resolve(packagePath);
    const controlledRoots = this.getControlledRoots();
    const allowed = controlledRoots.some((root) =>
      isInsideDirectory(root, resolvedPath),
    );
    if (!allowed) {
      throwVbenError('插件包路径不在受控目录内');
    }
    if (!existsSync(resolvedPath)) {
      throwVbenError('插件包文件不存在');
    }
    if (!resolvedPath.endsWith(PACKAGE_EXTENSION)) {
      throwVbenError('插件包文件扩展名不合法');
    }
    if (!statSync(resolvedPath).isFile()) {
      throwVbenError('插件包路径不是文件');
    }
    if (extname(resolvedPath) !== '.json') {
      throwVbenError('插件包文件扩展名不合法');
    }

    return resolvedPath;
  }

  private getControlledRoots() {
    const configuredRoots = [
      this.configService?.get<string>('QQBOT_PLUGIN_PACKAGE_ROOT'),
      this.configService?.get<string>('QQBOT_PLUGIN_PACKAGE_ROOTS'),
    ]
      .filter((value): value is string => !!value)
      .flatMap((value) => value.split(/[;,]/))
      .map((value) => value.trim())
      .filter(Boolean);

    const defaultRoots = [
      resolve(process.cwd(), '.kt-workspace', 'qqbot-plugin-packages'),
      resolve(process.cwd(), 'src', 'modules', 'qqbot', 'plugins'),
    ];

    return [...configuredRoots, ...defaultRoots].map((root) => resolve(root));
  }

  private getMaxPackageBytes() {
    const configured = Number(
      this.configService?.get<string>('QQBOT_PLUGIN_PACKAGE_MAX_BYTES'),
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_MAX_PACKAGE_BYTES;
  }

  private normalizePackageFiles(files: unknown): PackedPluginFile[] {
    if (!Array.isArray(files)) {
      throwVbenError('QQBot 插件包文件清单不合法');
    }
    return (files as unknown[]).map((file) => {
      const record = file as Partial<PackedPluginFile>;
      if (typeof record.path !== 'string' || typeof record.sha256 !== 'string') {
        throwVbenError('QQBot 插件包文件清单不合法');
      }
      return {
        path: record.path,
        sha256: record.sha256,
      };
    });
  }

  private normalizeContentHash(contentHash: unknown) {
    if (typeof contentHash !== 'string' || !contentHash) {
      throwVbenError('QQBot 插件包缺少 contentHash');
    }
    return contentHash;
  }
}
