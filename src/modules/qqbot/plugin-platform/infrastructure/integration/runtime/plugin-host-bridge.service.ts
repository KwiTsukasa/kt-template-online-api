import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotConfigService } from '@/modules/qqbot/core/application/config/qqbot-config.service';
import { QqbotSendService } from '@/modules/qqbot/core/application/send/qqbot-send.service';
import type { QqbotPluginPackageDescriptor } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types';
import {
  QqbotPluginHttpClientService,
  type QqbotPluginHttpClientRequest,
  type QqbotPluginResolveRedirectRequest,
} from '../sdk/plugin-http-client.service';
import type {
  QqbotPluginHostCallRequest,
  QqbotPluginHostCallResponse,
} from './plugin-host-bridge.types';

const HOST_FILE_PATH_ERROR =
  'Plugin host file path must stay inside the package root';
const MAX_HOST_SLEEP_MS = 60_000;

@Injectable()
export class QqbotPluginHostBridgeService {
  private readonly logger = new Logger(QqbotPluginHostBridgeService.name);

  constructor(
    private readonly configService: QqbotConfigService,
    private readonly dictService: DictService,
    private readonly httpClient: QqbotPluginHttpClientService,
    private readonly accountService: QqbotAccountService,
    private readonly sendService: QqbotSendService,
  ) {}

  /** 处理主机调用。 */
  async handleHostCall(
    descriptor: QqbotPluginPackageDescriptor,
    request: QqbotPluginHostCallRequest,
  ): Promise<QqbotPluginHostCallResponse> {
    try {
      const value = await this.dispatchHostCall(descriptor, request);
      return { ok: true, value };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : `${error}`,
        ok: false,
      };
    }
  }

  /** 分发主机调用。 */
  private async dispatchHostCall(
    descriptor: QqbotPluginPackageDescriptor,
    request: QqbotPluginHostCallRequest,
  ) {
    const args = request.args || {};

    switch (request.method) {
      case 'bindEventPlugin':
        return this.accountService.bindEventPlugin(
          getRequiredText(args, 'selfId'),
          request.pluginKey,
        );
      case 'getBoundEventPluginKeys':
        return this.accountService.getBoundEventPluginKeys(
          getRequiredText(args, 'selfId'),
        );
      case 'getConfig':
        return this.configService.getConfigValue(getRequiredText(args, 'key'));
      case 'getConfigMany':
        return this.getConfigMany(getTextArray(args, 'keys'));
      case 'getDictByKey':
        return this.dictService.getDictByKey(getDictCode(args));
      case 'getDictItemsByKey':
        return this.dictService.getDictItemsByKey(getDictCode(args));
      case 'readAssetFile':
        return this.readPackageFile(descriptor, getPathArgument(args));
      case 'readJsonFile':
        return this.readJsonFile(descriptor, getPathArgument(args));
      case 'relationTree':
        return this.dictService.relationTree(
          (args.input || args) as Record<string, unknown>,
        );
      case 'renameFile':
        return this.renamePackageFile(
          descriptor,
          getRequiredText(args, 'from'),
          getRequiredText(args, 'to'),
        );
      case 'requestBuffer':
        return this.httpClient.requestBuffer(getHttpRequestOptions(args));
      case 'requestJson':
        return this.httpClient.requestJson(getHttpRequestOptions(args));
      case 'resolveRedirect':
        return this.httpClient.resolveRedirect(getRedirectRequestOptions(args));
      case 'sendText':
        return this.sendService.sendText(
          args.input as Parameters<QqbotSendService['sendText']>[0],
        );
      case 'sleep':
        return this.sleep(getRequiredNumber(args, 'ms'));
      case 'unbindEventPlugin':
        return this.accountService.unbindEventPlugin(
          getRequiredText(args, 'selfId'),
          request.pluginKey,
        );
      case 'warn':
        this.logger.warn({
          message: getRequiredText(args, 'message'),
          pluginKey: request.pluginKey,
        });
        return undefined;
      case 'writeJsonFile':
        return this.writeJsonFile(descriptor, getPathArgument(args), args.data);
      default:
        throw new Error(`未知插件 Host 调用：${request.method}`);
    }
  }

  /** 读取配置多个。 */
  private async getConfigMany(keys: string[]) {
    const entries = await Promise.all(
      keys.map(async (key) => [
        key,
        await this.configService.getConfigValue(key),
      ]),
    );
    return Object.fromEntries(entries);
  }

  /** 读取包文件。 */
  private async readPackageFile(
    descriptor: QqbotPluginPackageDescriptor,
    filePath: string,
  ) {
    return readFile(resolvePackagePath(descriptor, filePath));
  }

  /** 读取JSON文件。 */
  private async readJsonFile(
    descriptor: QqbotPluginPackageDescriptor,
    filePath: string,
  ) {
    return JSON.parse(
      await readFile(resolvePackagePath(descriptor, filePath), 'utf8'),
    );
  }

  /** 写入JSON文件。 */
  private async writeJsonFile(
    descriptor: QqbotPluginPackageDescriptor,
    filePath: string,
    data: unknown,
  ) {
    const targetPath = resolvePackagePath(descriptor, filePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(data, null, 2)}\n`);
    return undefined;
  }

  /** 重命名包文件。 */
  private async renamePackageFile(
    descriptor: QqbotPluginPackageDescriptor,
    from: string,
    to: string,
  ) {
    const sourcePath = resolvePackagePath(descriptor, from);
    const targetPath = resolvePackagePath(descriptor, to);
    await mkdir(dirname(targetPath), { recursive: true });
    await rename(sourcePath, targetPath);
    return undefined;
  }

  /** 返回休眠。 */
  private sleep(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(
        'Plugin host sleep duration must be a non-negative finite number',
      );
    }

    return new Promise<void>((resolveSleep) => {
      const timer = setTimeout(resolveSleep, Math.min(ms, MAX_HOST_SLEEP_MS));
      timer.unref?.();
    });
  }
}

/** 解析包路径。 */
function resolvePackagePath(
  descriptor: QqbotPluginPackageDescriptor,
  filePath: string,
) {
  if (!filePath || isAbsolute(filePath)) throw new Error(HOST_FILE_PATH_ERROR);

  const packageRoot = resolve(descriptor.packageRoot);
  const targetPath = resolve(packageRoot, filePath);
  const relativePath = relative(packageRoot, targetPath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(HOST_FILE_PATH_ERROR);
  }
  return targetPath;
}

/** 读取必需的文本。 */
function getRequiredText(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Plugin host argument ${key} must be a non-empty string`);
  }
  return value.trim();
}

/** 读取路径参数。 */
function getPathArgument(args: Record<string, unknown>) {
  const value = args.path ?? args.filePath;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Plugin host file path must be a non-empty relative path');
  }
  return value.trim();
}

/** 读取字典代码。 */
function getDictCode(args: Record<string, unknown>) {
  const value = args.dictCode ?? args.key;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Plugin host dictCode must be a non-empty string');
  }
  return value.trim();
}

/** 读取文本数组。 */
function getTextArray(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error(`Plugin host argument ${key} must be a string array`);
  }
  return value as string[];
}

/** 读取必需的数字。 */
function getRequiredNumber(args: Record<string, unknown>, key: string) {
  const value = Number(args[key]);
  if (!Number.isFinite(value)) {
    throw new Error(`Plugin host argument ${key} must be a finite number`);
  }
  return value;
}

/** 读取HTTP请求选项。 */
function getHttpRequestOptions(
  args: Record<string, unknown>,
): QqbotPluginHttpClientRequest {
  const candidate = args.options || args;
  if (!isRecord(candidate)) {
    throw new Error('Plugin host HTTP options must be an object');
  }

  const request = { ...candidate } as QqbotPluginHttpClientRequest & {
    failureMessageTemplate?: string;
  };
  if (typeof request.failureMessageTemplate === 'string') {
    const template = request.failureMessageTemplate;
    request.failureMessage = (statusCode) =>
      template.replaceAll('{statusCode}', `${statusCode}`);
    delete request.failureMessageTemplate;
  }
  return request;
}

/** 读取重定向请求选项。 */
function getRedirectRequestOptions(
  args: Record<string, unknown>,
): QqbotPluginResolveRedirectRequest {
  const candidate = args.input ?? args.options ?? args;
  if (!isRecord(candidate)) {
    throw new Error('Plugin host redirect options must be an object');
  }
  return candidate as QqbotPluginResolveRedirectRequest;
}

/** 判断记录是否成立。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
