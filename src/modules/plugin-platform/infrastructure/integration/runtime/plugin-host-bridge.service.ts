import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Repository } from 'typeorm';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import type { PluginPermission } from '@/modules/plugin-platform/domain/manifest';
import type { PluginPackageDescriptor } from '@/modules/plugin-platform/infrastructure/integration/package/plugin-package.types';
import {
  PluginHttpClientService,
  type PluginHttpClientRequest,
  type PluginResolveRedirectRequest,
} from '../sdk/plugin-http-client.service';
import type {
  PluginHostCallRequest,
  PluginHostCallResponse,
} from './plugin-host-bridge.types';

const HOST_FILE_PATH_ERROR =
  'Plugin host file path must stay inside the package root';
const MAX_HOST_SLEEP_MS = 60_000;
const MAX_NATMAP_ENDPOINTS = 16;
const MAX_NATMAP_SELECTOR_LENGTH = 80;
const SENSITIVE_NATMAP_SELECTOR_PATTERN =
  /(?:\b(?:\d{1,3}\.){3}\d{1,3}\b|:\d{2,5}\b|:\/\/|[\\/@]|\blocalhost\b|\.(?:internal|lan|local)\b)/iu;

@Injectable()
export class PluginHostBridgeService {
  private readonly logger = new Logger(PluginHostBridgeService.name);

  constructor(
    private readonly dictService: DictService,
    private readonly httpClient: PluginHttpClientService,
    @Optional()
    @InjectRepository(NetworkPortForward)
    private readonly networkPortForwardRepository?: Repository<NetworkPortForward>,
  ) {}

  /**
   * 根据`descriptor`、`request`处理主机调用。
   * @param descriptor - 决定主机调用内容、边界或目标的 `descriptor` 值。
   * @param request - 用于主机调用的当前 HTTP 请求。
   * @returns 包含 `message`、`ok` 字段的主机调用。
   */
  async handleHostCall(
    descriptor: PluginPackageDescriptor,
    request: PluginHostCallRequest,
  ): Promise<PluginHostCallResponse> {
    try {
      const value = await this.dispatchHostCall(descriptor, request);
      return { ok: true, value };
    } catch (error) {
      return {
        message: (() => {
          if (error instanceof Error) {
            return error.message;
          }
          return `${error}`;
        })(),
        ok: false,
      };
    }
  }

  /**
   * 按插件声明的受控主机能力分发配置、HTTP、文件和日志调用，不承担账号绑定或消息发送。
   * @param descriptor - 决定分发主机调用内容、边界或目标的 `descriptor` 值。
   * @param request - 用于分发主机调用的当前 HTTP 请求，包含 `args`、`method`、`pluginKey` 字段。
   * @returns 分发主机调用；没有可用结果或提前结束时为 `undefined`。
   * @throws 请求的方法不在允许的插件宿主能力集合中时抛出 `Error`。
   */
  private async dispatchHostCall(
    descriptor: PluginPackageDescriptor,
    request: PluginHostCallRequest,
  ) {
    const args = request.args || {};

    switch (request.method) {
      case 'getDictByKey':
        return this.dictService.getDictByKey(getDictCode(args));
      case 'getDictItemsByKey':
        return this.dictService.getDictItemsByKey(getDictCode(args));
      case 'resolveNatmapEndpoint':
        this.assertManifestPermission(descriptor, 'network.endpoint.read');
        return this.resolveNatmapEndpoint(args.selector);
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
      case 'sleep':
        return this.sleep(getRequiredNumber(args, 'ms'));
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
   * 只读取已启用的 TCP NATMap 通道并在 Host 内完成精确名称匹配，数据库名称永不跨越 worker 边界。
   * @param rawSelector - 用户已知的可选通道名称；为空时只接受唯一通道。
   * @returns 空、未找到、不唯一或单个脱敏端点的固定解析结果。
   * @throws 状态仓未接线、查询失败或候选数量超过消息查询边界时抛出安全错误。
   */
  private async resolveNatmapEndpoint(rawSelector: unknown) {
    if (!this.networkPortForwardRepository) {
      throw new Error('NATMap 只读状态源未接线');
    }
    const selector = this.normalizeNatmapSelector(rawSelector);
    let mappings: NetworkPortForward[];
    try {
      mappings = await this.networkPortForwardRepository.find({
        order: { name: 'ASC', id: 'ASC' },
        select: [
          'currentObservedAt',
          'currentPublicIpv4',
          'currentPublicPort',
          'currentValidUntil',
          'id',
          'lastObservedAt',
          'name',
          'natmapStatus',
          'syncStatus',
        ],
        take: MAX_NATMAP_ENDPOINTS + 1,
        where: {
          desiredPresence: 'present',
          isDeleted: false,
          natmapDesiredEnabled: true,
          protocol: 'tcp',
        },
      });
    } catch {
      throw new Error('NATMap 只读状态查询失败');
    }
    if (mappings.length > MAX_NATMAP_ENDPOINTS) {
      throw new Error('NATMap 通道数量超过只读查询上限');
    }
    if (mappings.length === 0) return { kind: 'empty' };
    if (!selector) {
      if (mappings.length !== 1) {
        return { channelCount: mappings.length, kind: 'ambiguous' };
      }
      return {
        endpoint: this.projectNatmapEndpoint(mappings[0], '默认通道'),
        kind: 'found',
      };
    }
    const matches = mappings.filter(
      (mapping) =>
        `${mapping.name || ''}`
          .replaceAll(/\s+/gu, ' ')
          .trim()
          .toLowerCase() === selector.toLowerCase(),
    );
    if (matches.length === 0) {
      return { channelCount: mappings.length, kind: 'not-found' };
    }
    if (matches.length !== 1) {
      return { channelCount: mappings.length, kind: 'ambiguous' };
    }
    return {
      endpoint: this.projectNatmapEndpoint(matches[0], selector),
      kind: 'found',
    };
  }

  /**
   * 把一条网络映射收敛为当前、过期或不可用状态；只有同步、活动且租约有效时才保留动态端口。
   * @param mapping - 已通过 TCP NATMap 期望态与 Host 内名称匹配的权威网络映射。
   * @param label - “默认通道”或用户原本已知且通过安全校验的选择器。
   * @returns 不含任何 IP、内部端口、数据库 ID 与错误文本的端点投影。
   */
  private projectNatmapEndpoint(mapping: NetworkPortForward, label: string) {
    const validUntilMs = new Date(mapping.currentValidUntil || '').getTime();
    const leaseValid =
      mapping.syncStatus === 'synced' &&
      mapping.natmapStatus === 'active' &&
      typeof mapping.currentPublicIpv4 === 'string' &&
      mapping.currentPublicIpv4.length > 0 &&
      Number.isInteger(mapping.currentPublicPort) &&
      Number(mapping.currentPublicPort) >= 1 &&
      Number(mapping.currentPublicPort) <= 65_535 &&
      Boolean(mapping.currentObservedAt) &&
      Number.isFinite(validUntilMs) &&
      validUntilMs > Date.now();
    let status: 'current' | 'stale' | 'unavailable' = 'unavailable';
    let publicPort: null | number = null;
    let observedAt: null | string = null;
    let validUntil: null | string = null;
    if (leaseValid) {
      status = 'current';
      publicPort = Number(mapping.currentPublicPort);
      observedAt = this.formatNatmapTimestamp(mapping.currentObservedAt);
      validUntil = this.formatNatmapTimestamp(mapping.currentValidUntil);
    } else if (mapping.currentObservedAt || mapping.lastObservedAt) {
      status = 'stale';
      observedAt = this.formatNatmapTimestamp(
        mapping.currentObservedAt || mapping.lastObservedAt,
      );
    }
    return {
      label,
      observedAt,
      publicPort,
      status,
      validUntil,
    };
  }

  /**
   * 折叠用户选择器并拒绝地址、端口、路径和内部域名形态，防止其被回显为拓扑信息。
   * @param value - worker 传入的可选通道名称。
   * @returns 空字符串或最长八十字符的安全单行选择器。
   * @throws 选择器类型、长度或敏感形态不符合边界时抛出安全错误。
   */
  private normalizeNatmapSelector(value: unknown) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') {
      throw new Error('NATMap 通道选择器无效');
    }
    const normalized = value.replaceAll(/\s+/gu, ' ').trim();
    if (
      !normalized ||
      normalized.length > MAX_NATMAP_SELECTOR_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(normalized) ||
      SENSITIVE_NATMAP_SELECTOR_PATTERN.test(normalized)
    ) {
      throw new Error('NATMap 通道选择器无效');
    }
    return normalized;
  }

  /**
   * 把数据库时间转换为稳定 UTC 文本，非法或缺失时间一律丢弃。
   * @param value - 可能来自当前或历史端点的时间值。
   * @returns ISO 8601 UTC 文本；无法解析时返回 `null`。
   */
  private formatNatmapTimestamp(value: unknown) {
    if (!value) return null;
    const date = new Date(value as string | number | Date);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  }

  /**
   * 要求插件清单显式声明宿主能力，避免其他 worker 通过动态 Host 方法越权读取网络状态。
   * @param descriptor - 当前运行插件的已校验包描述。
   * @param permission - 本次 Host 方法要求的精确权限。
   * @throws 清单未声明权限时拒绝调用。
   */
  private assertManifestPermission(
    descriptor: PluginPackageDescriptor,
    permission: PluginPermission,
  ) {
    if (!descriptor.manifest.permissions.includes(permission)) {
      throw new Error(`插件缺少宿主权限：${permission}`);
    }
  }

  /**
   * 按`descriptor`、`filePath`读取包文件；从 `readFile` 读取包文件。
   * @param descriptor - 决定包文件内容、边界或目标的 `descriptor` 值。
   * @param filePath - 必须保持在受控根目录内的文件路径。
   * @returns 包文件。
   */
  private async readPackageFile(
    descriptor: PluginPackageDescriptor,
    filePath: string,
  ) {
    return readFile(resolvePackagePath(descriptor, filePath));
  }

  /**
   * 按`descriptor`、`filePath`读取JSON文件；从 `readFile` 读取JSON文件。
   * @param descriptor - 决定JSON文件内容、边界或目标的 `descriptor` 值。
   * @param filePath - 必须保持在受控根目录内的文件路径。
   * @returns JSON文件。
   */
  private async readJsonFile(
    descriptor: PluginPackageDescriptor,
    filePath: string,
  ) {
    return JSON.parse(
      await readFile(resolvePackagePath(descriptor, filePath), 'utf8'),
    );
  }

  /**
   * 根据`descriptor`、`filePath`、`data`更新JSON文件；把变更持久化到当前存储（`writeFile`）。
   * @param descriptor - 决定JSON文件内容、边界或目标的 `descriptor` 值。
   * @param filePath - 必须保持在受控根目录内的文件路径。
   * @param data - 决定JSON文件内容、边界或目标的 `data` 值。
   * @returns 固定为 `undefined`，表示当前入口没有可提供的JSON文件。
   */
  private async writeJsonFile(
    descriptor: PluginPackageDescriptor,
    filePath: string,
    data: unknown,
  ) {
    const targetPath = resolvePackagePath(descriptor, filePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(data, null, 2)}\n`);
    return undefined;
  }

  /**
   * 根据`descriptor`、`from`、`to`处理重命名包文件。
   * @param descriptor - 决定重命名包文件内容、边界或目标的 `descriptor` 值。
   * @param from - 决定重命名包文件内容、边界或目标的 `from` 值。
   * @param to - 决定重命名包文件内容、边界或目标的 `to` 值。
   * @returns 固定为 `undefined`，表示当前入口没有可提供的重命名包文件。
   */
  private async renamePackageFile(
    descriptor: PluginPackageDescriptor,
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
   * 校验等待时长为非负有限数后创建定时 Promise，并把实际等待钳制在宿主允许上限内。
   * @param ms - 决定sleep内容、边界或目标的 `ms` 值。
   * @returns 返回在钳制后的等待时长结束时兑现的 Promise。
   * @throws 等待时长不是非负有限数时抛出 `Error`。
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
 * 将相对文件路径解析到插件包根目录内，并拒绝绝对路径、根目录本身与越界路径。
 * @param descriptor - 用于包路径的领域对象，包含 `packageRoot` 字段。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @returns 包路径。
 * @throws 当 `!filePath || isAbsolute(filePath)` 成立时拒绝当前输入并抛出 `Error`；当 `!relativePath || relativePath === '..' || relativePath.startsWith(`..${…` 成立时拒绝当前输入并抛出 `Error`。
 */
function resolvePackagePath(
  descriptor: PluginPackageDescriptor,
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
 * 按`args`、`key`读取必需的文本。
 * @param args - 用于必需的文本的领域对象，包含 `key` 字段。
 * @param key - 用于读取或更新必需的文本的稳定键。
 * @returns 必需的文本。
 * @throws 当 `typeof value !== 'string' || !value.trim()` 成立时拒绝当前输入并抛出 `Error`。
 */
function getRequiredText(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Plugin host argument ${key} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * 从主机调用参数的两个兼容字段中读取非空文件路径，并去除两端空白。
 * @param args - 可能通过 `path` 或旧版 `filePath` 字段携带路径的主机参数。
 * @returns 规范化后的非空插件文件路径参数。
 * @throws 两个兼容字段均未提供非空字符串时抛出 `Error`。
 */
function getPathArgument(args: Record<string, unknown>) {
  const value = args.path ?? args.filePath;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Plugin host file path must be a non-empty relative path');
  }
  return value.trim();
}

/**
 * 从主机调用参数的字典字段或兼容键字段中读取非空字典编码。
 * @param args - 可能通过 `dictCode` 或兼容 `key` 字段携带字典编码的主机参数。
 * @returns 去除两端空白后的非空字典编码。
 * @throws 两个兼容字段均未提供非空字符串时抛出 `Error`。
 */
function getDictCode(args: Record<string, unknown>) {
  const value = args.dictCode ?? args.key;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Plugin host dictCode must be a non-empty string');
  }
  return value.trim();
}

/**
 * 按`args`、`key`读取必需的数字。
 * @param args - 用于必需的数字的领域对象，包含 `key` 字段。
 * @param key - 用于读取或更新必需的数字的稳定键。
 * @returns 必需的数字。
 * @throws 当 `!Number.isFinite(value)` 成立时拒绝当前输入并抛出 `Error`。
 */
function getRequiredNumber(args: Record<string, unknown>, key: string) {
  const value = Number(args[key]);
  if (!Number.isFinite(value)) {
    throw new Error(`Plugin host argument ${key} must be a finite number`);
  }
  return value;
}

/**
 * 读取插件 HTTP 请求选项，并把静态失败消息模板转换为按状态码生成消息的回调。
 * @param args - 直接表示请求选项或通过 `options` 字段包装选项的主机参数。
 * @returns 移除消息模板字段并补充失败消息回调后的 HTTP 请求选项。
 * @throws 候选请求选项不是普通记录对象时抛出 `Error`。
 */
function getHttpRequestOptions(
  args: Record<string, unknown>,
): PluginHttpClientRequest {
  const candidate = args.options || args;
  if (!isRecord(candidate)) {
    throw new Error('Plugin host HTTP options must be an object');
  }

  const request = { ...candidate } as PluginHttpClientRequest & {
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
 * 按新旧包装字段优先级读取插件重定向解析选项，并保留直接传参兼容性。
 * @param args - 可通过 `input`、`options` 或顶层字段携带重定向选项的主机参数。
 * @returns 首个可用包装层中的重定向解析选项记录。
 * @throws 解析出的候选值不是普通记录对象时抛出 `Error`。
 */
function getRedirectRequestOptions(
  args: Record<string, unknown>,
): PluginResolveRedirectRequest {
  const candidate = args.input ?? args.options ?? args;
  if (!isRecord(candidate)) {
    throw new Error('Plugin host redirect options must be an object');
  }
  return candidate as PluginResolveRedirectRequest;
}

/**
 * 根据`value`与当前约束判定记录。
 * @param value - 待判定是否满足记录约束的候选值。
 * @returns 满足记录约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
