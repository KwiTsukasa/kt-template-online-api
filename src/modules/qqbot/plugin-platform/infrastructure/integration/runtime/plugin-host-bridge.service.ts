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

  /**
   * Initializes the generic plugin host bridge with platform services that are safe to expose through worker host calls.
   * @param configService - QQBot runtime config reader used by manifest-owned config keys.
   * @param dictService - Admin dictionary service used by plugin dictionary lookups.
   * @param httpClient - Plugin HTTP client used for host-mediated network calls.
   * @param accountService - QQBot account service used for event plugin binding calls.
   * @param sendService - QQBot send service used for host-mediated outgoing text messages.
   */
  constructor(
    private readonly configService: QqbotConfigService,
    private readonly dictService: DictService,
    private readonly httpClient: QqbotPluginHttpClientService,
    private readonly accountService: QqbotAccountService,
    private readonly sendService: QqbotSendService,
  ) {}

  /**
   * Handles one plugin worker host call and serializes thrown errors into worker-safe responses.
   * @param descriptor - Package descriptor that constrains file-system calls to the plugin package root.
   * @param request - Host method name, plugin key, and argument payload sent by the plugin worker.
   * @returns Host call success response, or a failure response with a sanitized message.
   */
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

  /**
   * Dispatches a plugin host method to a generic platform capability without importing concrete plugin packages.
   * @param descriptor - Package descriptor used to enforce package-local file operations.
   * @param request - Host call request containing method name and untrusted worker arguments.
   * @returns Raw platform service result for the requested host method.
   */
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

  /**
   * Reads several package-owned QQBot config keys into a key/value snapshot for a worker host call.
   * @param keys - Manifest-owned config keys requested by a plugin package.
   * @returns Record preserving every requested key with stored value or `undefined`.
   */
  private async getConfigMany(keys: string[]) {
    const entries = await Promise.all(
      keys.map(async (key) => [
        key,
        await this.configService.getConfigValue(key),
      ]),
    );
    return Object.fromEntries(entries);
  }

  /**
   * Reads a package-local file as a buffer for plugin asset access.
   * @param descriptor - Package descriptor whose packageRoot bounds the read.
   * @param filePath - Relative package path requested by the plugin worker.
   * @returns File contents read from inside the descriptor package root.
   */
  private async readPackageFile(
    descriptor: QqbotPluginPackageDescriptor,
    filePath: string,
  ) {
    return readFile(resolvePackagePath(descriptor, filePath));
  }

  /**
   * Reads and parses a package-local JSON file for plugin runtime storage or assets.
   * @param descriptor - Package descriptor whose packageRoot bounds the read.
   * @param filePath - Relative package path requested by the plugin worker.
   * @returns Parsed JSON payload from the package-local file.
   */
  private async readJsonFile(
    descriptor: QqbotPluginPackageDescriptor,
    filePath: string,
  ) {
    return JSON.parse(
      await readFile(resolvePackagePath(descriptor, filePath), 'utf8'),
    );
  }

  /**
   * Writes pretty JSON to a package-local file and creates parent directories when needed.
   * @param descriptor - Package descriptor whose packageRoot bounds the write.
   * @param filePath - Relative package path requested by the plugin worker.
   * @param data - JSON-serializable payload supplied by the plugin worker.
   */
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

  /**
   * Renames one package-local file to another package-local path, creating the destination parent directory first.
   * @param descriptor - Package descriptor whose packageRoot bounds both source and destination.
   * @param from - Relative source path inside the plugin package root.
   * @param to - Relative destination path inside the plugin package root.
   */
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

  /**
   * Waits for a bounded duration requested by plugin runtime IO.
   * @param ms - Requested sleep duration in milliseconds; negative and non-finite values are rejected.
   */
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

/**
 * Resolves a worker-supplied package-relative path and rejects absolute paths or traversal outside packageRoot.
 * @param descriptor - Package descriptor that owns the host-call file boundary.
 * @param filePath - Worker-supplied relative file path inside the package.
 * @returns Absolute path guaranteed to stay inside descriptor.packageRoot.
 */
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

/**
 * Reads a required string argument from worker host-call args.
 * @param args - Worker-supplied host-call arguments.
 * @param key - Argument name whose value must be a non-empty string.
 * @returns Trimmed string argument value.
 */
function getRequiredText(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Plugin host argument ${key} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Reads the host-call path argument while accepting both `path` and legacy `filePath` spellings.
 * @param args - Worker-supplied host-call arguments.
 * @returns Relative package path requested by the plugin worker.
 */
function getPathArgument(args: Record<string, unknown>) {
  const value = args.path ?? args.filePath;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Plugin host file path must be a non-empty relative path');
  }
  return value.trim();
}

/**
 * Reads a dictionary code from worker args using the generic `dictCode` or `key` aliases.
 * @param args - Worker-supplied host-call arguments.
 * @returns Dictionary code to pass to DictService.
 */
function getDictCode(args: Record<string, unknown>) {
  const value = args.dictCode ?? args.key;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Plugin host dictCode must be a non-empty string');
  }
  return value.trim();
}

/**
 * Reads a string array argument from worker host-call args.
 * @param args - Worker-supplied host-call arguments.
 * @param key - Argument name whose value must be an array of strings.
 * @returns String values in the same order requested by the plugin worker.
 */
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

/**
 * Reads a required numeric argument from worker host-call args.
 * @param args - Worker-supplied host-call arguments.
 * @param key - Argument name whose value must be numeric.
 * @returns Numeric value converted from the worker argument.
 */
function getRequiredNumber(args: Record<string, unknown>, key: string) {
  const value = Number(args[key]);
  if (!Number.isFinite(value)) {
    throw new Error(`Plugin host argument ${key} must be a finite number`);
  }
  return value;
}

/**
 * Normalizes host-call HTTP options from either `{ options }` or raw option arguments.
 * @param args - Worker-supplied host-call arguments.
 * @returns HTTP client request options safe to pass to QqbotPluginHttpClientService.
 */
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

/**
 * Normalizes host-call redirect options from `{ input }`, `{ options }`, or raw option arguments.
 * @param args - Worker-supplied host-call arguments.
 * @returns Redirect resolver options safe to pass to QqbotPluginHttpClientService.
 */
function getRedirectRequestOptions(
  args: Record<string, unknown>,
): QqbotPluginResolveRedirectRequest {
  const candidate = args.input || args.options || args;
  if (!isRecord(candidate)) {
    throw new Error('Plugin host redirect options must be an object');
  }
  return candidate as QqbotPluginResolveRedirectRequest;
}

/**
 * Checks whether an unknown value can be treated as a record of host-call options.
 * @param value - Worker-supplied value that may contain named host-call arguments.
 * @returns `true` when the value is a non-null object and not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
