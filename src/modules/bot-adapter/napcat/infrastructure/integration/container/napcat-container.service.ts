import * as http from 'http';
import * as https from 'https';
import { spawn } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ensureSnowflakeId, throwVbenError, ToolsService } from '@/common';
import { NapcatConfigWriterService } from '../../../application/runtime/napcat-config-writer.service';
import { NapcatRuntimeProfileService } from '../../../application/runtime/napcat-runtime-profile.service';
import type { NapcatConfigFile } from '../../../domain/runtime/napcat-profile.types';
import {
  toNapcatDockerDeviceOptions,
  type NapcatDockerDeviceOptions,
} from './napcat-docker-device-options';
import { NapcatDeviceIdentityService } from '../device/napcat-device-identity.service';
import { BotAccount } from '@/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity';
import { NapcatAccountBinding } from '../../persistence/napcat-account-binding.entity';
import { NapcatContainer } from '../../persistence/napcat-container.entity';
import type {
  NapcatApiResponse,
  NapcatCredential,
  NapcatLoginStatus,
  NapcatRuntime,
  NapcatRuntimeLoginStatus,
  NapcatRuntimeStatusSnapshot,
} from '@/modules/bot-adapter/core/contract/bot.types';

type NapcatLoginLogState = 'offline' | 'online' | 'unknown';

type NapcatLoginLogResult = {
  offlineReason: string | null;
  state: NapcatLoginLogState;
};

type NapcatLoginEnvOptions = {
  clearLoginPassword?: boolean;
  loginPassword?: string;
  selfId?: string;
};

type NapcatLoginEnvUpdateResult = {
  changed: boolean;
  ok: boolean;
};

type CreateManagedContainerOptions = {
  startRemote?: boolean;
};

type NapcatWebuiCredentialCacheEntry = {
  credential: string;
  expiresAt: number;
};

const NAPCAT_WEBUI_CREDENTIAL_TTL_MS = 50 * 60 * 1000;
const NAPCAT_RUNTIME_MUTATION_LOCK_PATH =
  '/run/lock/kt-napcat-runtime-migration.lock';
const NAPCAT_RUNTIME_MIGRATION_STATE_PATH =
  '/var/lib/kt-napcat-runtime-migration';

@Injectable()
export class NapcatContainerService {
  private readonly configWriterService: NapcatConfigWriterService;

  private readonly runtimeProfileService: NapcatRuntimeProfileService;

  private readonly webuiCredentials: Record<
    string,
    NapcatWebuiCredentialCacheEntry | undefined
  > = {};

  private readonly webuiCredentialRequests: Record<
    string,
    Promise<string> | undefined
  > = {};

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(NapcatContainer)
    private readonly containerRepository: Repository<NapcatContainer>,
    @InjectRepository(NapcatAccountBinding)
    private readonly bindingRepository: Repository<NapcatAccountBinding>,
    private readonly toolsService: ToolsService,
    private readonly deviceIdentityService?: NapcatDeviceIdentityService,
    runtimeProfileService?: NapcatRuntimeProfileService,
    configWriterService?: NapcatConfigWriterService,
  ) {
    this.runtimeProfileService =
      runtimeProfileService || new NapcatRuntimeProfileService(configService);
    this.configWriterService =
      configWriterService || new NapcatConfigWriterService(toolsService);
  }

  /**
   * 通过 `isManagedMode` 判断输入是否满足函数约束。
   * @returns 容器。
   */
  async prepareCreateContainer() {
    if (!this.isManagedMode()) {
      return this.getLegacyRuntime();
    }

    const runtime = await this.reserveCreateContainer();
    await this.startCreateContainer(runtime);
    return runtime;
  }

  /**
   * 根据当前运行态处理预留创建容器；当 `!this.isManagedMode()` 成立时返回 `this.getLegacyRuntime()`。
   * @returns 预留创建容器；没有可用结果或提前结束时为 `undefined`。
   */
  async reserveCreateContainer() {
    if (!this.isManagedMode()) {
      return this.getLegacyRuntime();
    }

    return this.createManagedContainer(undefined, undefined, undefined, {
      startRemote: false,
    });
  }

  /**
   * 按`runtime`启动创建容器；把变更持久化到当前存储（`containerRepository.update`）。
   * @param runtime - 用于创建容器的领域对象，包含 `id` 字段。
   * @returns 满足创建容器约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   * @throws 当 `resolveCreateContainerDeviceIdentity` 或 `createRemoteDockerContainer` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  async startCreateContainer(runtime: NapcatRuntime) {
    if (this.getManagedMode() !== 'ssh' || !runtime.id) return true;

    const container = await this.findContainerWithToken(runtime.id);
    if (
      !container ||
      !container.name ||
      !container.webuiPort ||
      !container.webuiToken
    ) {
      throwVbenError('NapCat 创建容器不存在或缺少 WebUI 配置');
    }
    if (container.status === 'running') return true;

    try {
      const deviceIdentity =
        await this.resolveCreateContainerDeviceIdentity(container);
      await this.createRemoteDockerContainer({
        account: undefined,
        accountId:
          deviceIdentity?.accountId || container.accountId || container.id,
        containerId: container.id,
        dataDir:
          deviceIdentity?.dataDir ||
          container.dataDir ||
          `${this.getRootDir()}/${container.name}`,
        deviceIdentity,
        image: container.image,
        name: container.name,
        port: container.webuiPort,
        reverseWsUrl: container.reverseWsUrl || this.buildReverseWsUrl(),
        token: container.webuiToken,
      });
      await this.containerRepository.update(
        { id: container.id },
        {
          dataDir:
            deviceIdentity?.dataDir ||
            container.dataDir ||
            `${this.getRootDir()}/${container.name}`,
          lastError: null,
          lastStartedAt: new Date(),
          status: 'running',
        },
      );
      return true;
    } catch (err) {
      const message = this.toolsService.getErrorMessage(err);
      await this.containerRepository.update(
        { id: container.id },
        {
          lastError: this.toolsService.toColumnText(message, 500),
          status: 'error',
        },
      );
      throw err;
    }
  }

  /**
   * 根据账号更新登录上下文准备 NapCat 容器，并返回可用于后续登录的运行态。
   * @param account - Bot 账号；提供主绑定容器查询条件和创建期 ACCOUNT env。
   * @param loginPassword - 已保存的 QQ 登录密码明文；仅在新建或 Docker 离线重建容器时注入创建期 env。
   * @returns 可用于登录流程的 NapCat 运行态，携带源 Docker 容器是否在线的门禁证据。
   */
  async prepareAccountContainer(account: BotAccount, loginPassword?: string) {
    if (!this.isManagedMode()) {
      return this.getLegacyRuntime();
    }

    const existing = await this.getPrimaryRuntime(account.id);
    if (existing) {
      const sourceContainerOnline = existing.sourceContainerOnline !== false;
      const quickLoginEnv = await (async () => {
        if (sourceContainerOnline) {
          return { changed: false, ok: true };
        }
        return await this.ensureRuntimeLoginEnv(existing, {
          loginPassword,
          selfId: account.selfId,
        });
      })();
      if (
        !sourceContainerOnline &&
        quickLoginEnv.ok &&
        !quickLoginEnv.changed &&
        !(await this.startRuntimeContainer(existing))
      ) {
        throwVbenError('NapCat Docker 容器未运行，启动失败');
      }
      return {
        ...existing,
        hasExistingPrimaryBinding: true,
        sourceContainerOnline,
        runtimeRebuildCount: (() => {
          if (quickLoginEnv.changed) {
            return 1;
          }
          return 0;
        })(),
      };
    }

    const created = await this.createManagedContainer(
      account.selfId,
      loginPassword,
      account.id,
    );
    return {
      ...created,
      hasExistingPrimaryBinding: false,
      sourceContainerOnline: false,
    };
  }

  /**
   * 让已绑定账号的容器带上 ACCOUNT 环境变量（NapCat 的 -q 快速登录）。 仅在 ssh 托管模式下原地重建容器：保留 QQ 数据卷，因此随后的容器重启 能从持久化会话免扫码自动重登。硬踢（登录已失效）时会话作废，仍需扫码。
   * @param runtime - 决定运行态快速登录Login内容、边界或目标的 `runtime` 值。
   * @param selfId - 用于精确定位QQ 账号的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 运行态快速登录Login。
   */
  async ensureRuntimeQuickLogin(runtime: NapcatRuntime, selfId?: string) {
    return this.ensureRuntimeLoginEnv(runtime, { selfId });
  }

  /**
   * 确保运行态Login环境变量存在且保持一致；缺失时根据`runtime`、`options`补齐对应状态；当 `this.getManagedMode() !== 'ssh' || !runtime.id` 成立时返回 `{ changed: false, ok: true }`。
   * @param runtime - 用于运行态Login环境变量的领域对象，包含 `id` 字段。
   * @param options - 控制运行态Login环境变量筛选、缓存或输出方式的可选项，包含 `selfId`、`clearLoginPassword`、`loginPassword` 字段。
   * @returns 包含 `changed`、`ok` 字段的运行态Login环境变量。
   */
  async ensureRuntimeLoginEnv(
    runtime: NapcatRuntime,
    options: NapcatLoginEnvOptions,
  ): Promise<NapcatLoginEnvUpdateResult> {
    if (this.getManagedMode() !== 'ssh' || !runtime.id) {
      return { changed: false, ok: true };
    }

    const account = this.toolsService.toTrimmedString(options.selfId);
    if (!account) {
      return { changed: false, ok: false };
    }

    const container = await this.findContainerWithToken(runtime.id);
    if (
      !container ||
      !container.name ||
      !container.webuiPort ||
      !container.webuiToken
    ) {
      return { changed: false, ok: false };
    }

    if (
      await this.runtimeMatchesLoginEnv(container.name, {
        ...options,
        selfId: account,
      })
    ) {
      return { changed: false, ok: true };
    }

    try {
      const deviceIdentity = await this.resolveRuntimeDeviceIdentity(
        container,
        account,
      );
      await this.createRemoteDockerContainer({
        account,
        accountId: deviceIdentity?.accountId,
        containerId: container.id,
        dataDir:
          deviceIdentity?.dataDir ||
          container.dataDir ||
          `${this.getRootDir()}/${container.name}`,
        deviceIdentity,
        image: container.image,
        loginPassword: (() => {
          if (options.clearLoginPassword) {
            return undefined;
          }
          return this.toolsService.toSecretText(options.loginPassword);
        })(),
        name: container.name,
        port: container.webuiPort,
        reverseWsUrl: container.reverseWsUrl || this.buildReverseWsUrl(),
        skipPull: true,
        token: container.webuiToken,
      });
      const verified = await this.runtimeMatchesLoginEnv(container.name, {
        ...options,
        selfId: account,
      });
      await this.containerRepository.update(
        { id: container.id },
        {
          lastError: (() => {
            if (verified) {
              return null;
            }
            return 'NapCat 运行态登录环境校验失败';
          })(),
          lastStartedAt: new Date(),
          status: 'running',
        },
      );
      return { changed: true, ok: verified };
    } catch {
      return { changed: false, ok: false };
    }
  }

  /**
   * 只读检查托管容器当前登录环境是否已经符合目标状态。
   * @param runtime - NapCat 运行态；用 id 找到容器名和当前 Docker env。
   * @param options - 目标 ACCOUNT / 运行态密码状态；决定是否要求清除或保留密码 env。
   * @returns 当前 Docker env 已匹配时返回 true；不可检查或不匹配时返回 false。
   */
  async runtimeLoginEnvMatches(
    runtime: NapcatRuntime,
    options: NapcatLoginEnvOptions,
  ) {
    if (this.getManagedMode() !== 'ssh' || !runtime.id) return true;

    const account = this.toolsService.toTrimmedString(options.selfId);
    if (!account) return false;

    const container = await this.findContainerWithToken(runtime.id);
    if (!container?.name) return false;

    return this.runtimeMatchesLoginEnv(container.name, {
      ...options,
      selfId: account,
    });
  }

  /**
   * 从`container`、`selfId`解析运行态设备身份；当 `!this.deviceIdentityService || !container.id || typeof this.b…` 成立时返回 `undefined`。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 运行态设备身份；没有可用结果或提前结束时为 `undefined`。
   */
  private async resolveRuntimeDeviceIdentity(
    container: NapcatContainer,
    selfId: string,
  ): Promise<NapcatDockerDeviceOptions | undefined> {
    if (
      !this.deviceIdentityService ||
      !container.id ||
      typeof this.bindingRepository.findOne !== 'function'
    ) {
      return undefined;
    }

    const binding = await this.bindingRepository.findOne({
      where: {
        bindStatus: 'bound',
        containerId: container.id,
        isDeleted: false,
        isPrimary: true,
      },
    });
    if (!binding?.accountId) return undefined;

    const identity = await this.deviceIdentityService.resolveForAccount({
      accountId: binding.accountId,
      containerId: container.id,
      selfId,
    });
    return toNapcatDockerDeviceOptions(identity);
  }

  /**
   * 从`container`解析创建容器设备身份。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 创建容器设备身份；没有可用结果或提前结束时为 `undefined`。
   */
  private async resolveCreateContainerDeviceIdentity(
    container: NapcatContainer,
  ): Promise<NapcatDockerDeviceOptions | undefined> {
    if (!this.deviceIdentityService || !container.id) return undefined;
    const accountId =
      this.toolsService.toTrimmedString(container.accountId) || container.id;
    const identity = await this.deviceIdentityService.resolveForAccount({
      accountId,
      containerId: container.id,
    });
    return toNapcatDockerDeviceOptions(identity);
  }

  /**
   * 从`accountId`、`containerId`、`selfId`解析绑定设备身份标识。
   * @param accountId - 用于精确定位账号的标识。
   * @param containerId - 用于精确定位容器的标识。
   * @param selfId - 用于精确定位QQ 账号的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 绑定设备身份标识；没有可用结果或提前结束时为 `undefined`。
   */
  private async resolveBindingDeviceIdentityId(
    accountId: string,
    containerId: string,
    selfId?: string,
  ) {
    if (!this.deviceIdentityService) return undefined;
    const identity = await (async () => {
      if (
        typeof this.deviceIdentityService.adoptContainerIdentity === 'function'
      ) {
        return await this.deviceIdentityService.adoptContainerIdentity({
          accountId,
          containerId,
          selfId,
        });
      }
      return await this.deviceIdentityService.resolveForAccount({
        accountId,
        containerId,
        selfId,
      });
    })();
    return identity.id;
  }

  /**
   * 根据`name`、`options`处理运行态MatchesLogin环境变量；当 `env.get('ACCOUNT') !== this.toolsService.toTrimmedString(opti…` 成立时返回 `false`。
   * @param name - 决定运行态MatchesLogin环境变量内容、边界或目标的 `name` 值。
   * @param options - 控制运行态MatchesLogin环境变量筛选、缓存或输出方式的可选项，包含 `selfId`、`clearLoginPassword`、`loginPassword` 字段。
   * @returns 满足运行态MatchesLogin环境变量约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async runtimeMatchesLoginEnv(
    name: string,
    options: NapcatLoginEnvOptions,
  ) {
    try {
      const result = await this.runProcess(
        'ssh',
        [...this.getSshArgs(), 'sh -s'],
        this.buildRemoteInspectEnvScript(name),
        undefined,
        this.getRuntimeCheckTimeoutMs(),
      );
      const env = this.parseDockerEnv(result.stdout);
      if (
        env.get('ACCOUNT') !== this.toolsService.toTrimmedString(options.selfId)
      ) {
        return false;
      }
      const hasPassword =
        env.has('NAPCAT_QUICK_PASSWORD') ||
        env.has('NAPCAT_QUICK_PASSWORD_MD5');
      if (options.clearLoginPassword) return !hasPassword;

      const loginPassword = this.toolsService.toSecretText(
        options.loginPassword,
      );
      if (loginPassword) {
        return env.get('NAPCAT_QUICK_PASSWORD') === loginPassword;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 生成按容器名读取 Docker 配置环境变量的远端 Shell 脚本。
   * @param name - 要读取 `.Config.Env` 的 Docker 容器名。
   * @returns 已安全转义容器名、可交给远端 `sh` 执行的环境变量检查脚本。
   */
  private buildRemoteInspectEnvScript(name: string) {
    return `
set -eu
NAME=${this.sh(name)}
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$NAME"
`;
  }

  /**
   * 逐行解析 Docker 环境变量输出，并将首个等号后的完整内容保留为变量值。
   * @param stdout - 决定Docker环境变量内容、边界或目标的 `stdout` 值。
   * @returns Docker环境变量。
   */
  private parseDockerEnv(stdout: string) {
    const env = new Map<string, string>();
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const index = line.indexOf('=');
        if (index <= 0) return;
        env.set(line.slice(0, index), line.slice(index + 1));
      });
    return env;
  }

  /**
   * 按`containerId`读取运行态标识；把变更持久化到当前存储（`containerRepository.createQueryBuilder`）。
   * @param containerId - 用于精确定位容器的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 运行态标识。
   */
  async findRuntimeById(containerId?: string) {
    if (!containerId) return this.getLegacyRuntime();

    const container = await this.containerRepository
      .createQueryBuilder('container')
      .addSelect('container.webuiToken')
      .where('container.id = :containerId', { containerId })
      .andWhere('container.isDeleted = :isDeleted', { isDeleted: false })
      .getOne();
    if (!container) {
      throwVbenError('NapCat 容器不存在或已删除');
    }
    return this.toRuntime(container);
  }

  /**
   * 根据`accountId`、`containerId`、`selfId`处理账号；当 `existing` 成立时直接结束且不产生返回值。
   * @param accountId - 用于精确定位账号的标识。
   * @param containerId - 用于精确定位容器的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param selfId - 用于精确定位QQ 账号的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  async bindAccount(accountId: string, containerId?: string, selfId?: string) {
    if (!containerId) return;

    await this.bindingRepository.update(
      { accountId, isDeleted: false },
      { isPrimary: false },
    );
    const deviceIdentityId = await this.resolveBindingDeviceIdentityId(
      accountId,
      containerId,
      selfId,
    );
    await this.runtimeProfileService.adoptPlannedProfiles({
      containerId,
      deviceIdentityId,
      fromAccountId: containerId,
      toAccountId: accountId,
    });
    await this.containerRepository.update(
      { id: containerId, isDeleted: false },
      { accountId },
    );

    const existing = await this.bindingRepository.findOne({
      where: {
        accountId,
      },
    });
    if (existing) {
      await this.bindingRepository.update(
        { id: existing.id },
        {
          bindStatus: 'bound',
          containerId,
          isPrimary: true,
          isDeleted: false,
          lastLoginAt: new Date(),
          remark: '',
          ...(() => {
            if (deviceIdentityId) {
              return { deviceIdentityId };
            }
            return {};
          })(),
        },
      );
      await this.removeOtherAccountContainers(accountId, containerId);
      return;
    }

    await this.bindingRepository.save(
      this.bindingRepository.create({
        accountId,
        bindStatus: 'bound',
        containerId,
        ...(() => {
          if (deviceIdentityId) {
            return { deviceIdentityId };
          }
          return {};
        })(),
        isPrimary: true,
        lastLoginAt: new Date(),
        remark: '',
      }),
    );
    await this.removeOtherAccountContainers(accountId, containerId);
  }

  /**
   * 按`accountId`移除账号Containers；把变更持久化到当前存储（`bindingRepository.createQueryBuilder`）。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 包含 `deletedContainers` 字段的账号Containers。
   */
  async removeAccountContainers(accountId: string) {
    const bindings = await this.bindingRepository.find({
      where: {
        accountId,
        isDeleted: false,
      },
    });
    if (bindings.length <= 0) return { deletedContainers: 0 };

    let deletedContainers = 0;
    for (const binding of bindings) {
      const sharedCount = await this.bindingRepository
        .createQueryBuilder('binding')
        .where('binding.containerId = :containerId', {
          containerId: binding.containerId,
        })
        .andWhere('binding.accountId != :accountId', { accountId })
        .andWhere('binding.isDeleted = :isDeleted', { isDeleted: false })
        .getCount();
      if (sharedCount > 0) continue;

      const deleted = await this.removeContainer(binding.containerId);
      if (deleted) deletedContainers += 1;
    }

    await this.bindingRepository.update(
      { accountId, isDeleted: false },
      {
        bindStatus: 'disabled',
        isDeleted: true,
        isPrimary: false,
      },
    );

    return { deletedContainers };
  }

  /**
   * 通过 `bindingRepository.count` 统计匹配记录。
   * @param containerId - 用于精确定位容器的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足Unbound容器约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async removeUnboundContainer(containerId?: string) {
    if (!containerId) return false;

    const bindingCount = await this.bindingRepository.count({
      where: {
        containerId,
        isDeleted: false,
      },
    });
    if (bindingCount > 0) return false;

    const container = await this.containerRepository.findOne({
      where: {
        id: containerId,
        isDeleted: false,
      },
    });
    if (container?.accountId) return false;

    return this.removeContainer(containerId);
  }

  /**
   * 按`containerId`移除未绑定的创建容器；把变更持久化到当前存储（`containerRepository.update`）。
   * @param containerId - 用于精确定位容器的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足未绑定的创建容器约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async removeUnboundCreateContainer(containerId?: string) {
    if (!containerId) return false;

    const bindingCount = await this.bindingRepository.count({
      where: {
        containerId,
        isDeleted: false,
      },
    });
    if (bindingCount > 0) return false;

    const container = await this.containerRepository.findOne({
      where: {
        id: containerId,
      },
    });
    if (!container || container.accountId) return false;

    if (this.getManagedMode() === 'ssh') {
      await this.removeRemoteDockerContainer(container);
    }

    await this.containerRepository.update(
      { id: container.id },
      {
        isDeleted: true,
        lastError: null,
        status: 'stopped',
      },
    );
    return true;
  }

  /**
   * 按`runtime`重启运行态容器；可选择仅重启工作进程，并按配置等待服务恢复就绪；当 `this.getManagedMode() !== 'ssh' || !runtime.id || !runtime.na…` 成立时返回 `false`。
   * @param runtime - 用于运行态容器的领域对象，包含 `id`、`name` 字段。
   * @returns 满足运行态容器约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async restartRuntimeContainer(runtime: NapcatRuntime) {
    if (this.getManagedMode() !== 'ssh' || !runtime.id || !runtime.name) {
      return false;
    }

    await this.runProcess(
      'ssh',
      [...this.getSshArgs(), 'sh -s'],
      this.buildRemoteDockerLifecycleScript('restart', runtime.name),
    );
    await this.containerRepository.update(
      { id: runtime.id },
      {
        lastError: null,
        lastStartedAt: new Date(),
        status: 'running',
      },
    );
    return true;
  }

  /**
   * 按`runtime`启动运行态容器；当 `this.getManagedMode() !== 'ssh' || !runtime.id || !runtime.na…` 成立时返回 `false`。
   * @param runtime - 用于运行态容器的领域对象，包含 `id`、`name` 字段。
   * @returns 满足运行态容器约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async startRuntimeContainer(runtime: NapcatRuntime) {
    if (this.getManagedMode() !== 'ssh' || !runtime.id || !runtime.name) {
      return false;
    }

    await this.runProcess(
      'ssh',
      [...this.getSshArgs(), 'sh -s'],
      this.buildRemoteDockerLifecycleScript('start', runtime.name),
    );
    await this.containerRepository.update(
      { id: runtime.id },
      {
        lastError: null,
        lastStartedAt: new Date(),
        status: 'running',
      },
    );
    return true;
  }

  /**
   * 根据`runtime`、`onProgress`处理reset运行态Login状态；当 `this.getManagedMode() !== 'ssh' || !runtime.id || !runtime.na…` 成立时返回 `false`。
   * @param runtime - 用于reset运行态Login状态的领域对象，包含 `id`、`name` 字段。
   * @param onProgress - 决定reset运行态Login状态内容、边界或目标的 `onProgress` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足reset运行态Login状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async resetRuntimeLoginState(
    runtime: NapcatRuntime,
    onProgress?: (step: string, message: string) => void,
  ) {
    if (this.getManagedMode() !== 'ssh' || !runtime.id || !runtime.name) {
      return false;
    }

    const container = await this.containerRepository.findOne({
      where: {
        id: runtime.id,
        isDeleted: false,
      },
    });
    if (!container) {
      throwVbenError('NapCat 容器不存在或已删除');
    }

    const script = this.buildRemoteResetLoginStateScript(container);
    await this.runProcess(
      'ssh',
      [...this.getSshArgs(), 'sh -s'],
      script,
      (line) => {
        const matched = line.match(/^__KT_PROGRESS__:([^:]+):(.+)$/);
        if (matched) onProgress?.(matched[1], matched[2]);
      },
    );
    await this.containerRepository.update(
      { id: runtime.id },
      {
        lastError: null,
        lastStartedAt: new Date(),
        status: 'running',
      },
    );
    return true;
  }

  /**
   * 根据`container`处理detect运行态Offline；把变更持久化到当前存储（`containerRepository.update`）。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns detect运行态Offline；无法解析或未命中时为 `null`。
   */
  async detectRuntimeOffline(container: NapcatContainer) {
    if (this.getManagedMode() !== 'ssh' || !container.name) return null;

    try {
      const result = await this.runProcess(
        'ssh',
        [...this.getSshArgs(), 'sh -s'],
        this.buildRemoteRecentLogsScript(container),
        undefined,
        this.getRuntimeCheckTimeoutMs(),
      );
      const loginState = this.extractLoginState(result.stdout);
      await this.containerRepository.update(
        { id: container.id },
        {
          lastCheckedAt: new Date(),
          ...(() => {
            if (loginState.state === 'offline') {
              return {
                lastError: (() => {
                  if (loginState.offlineReason) {
                    return this.toolsService.toColumnText(
                      loginState.offlineReason,
                      500,
                    );
                  }
                  return null;
                })(),
              };
            }
            return {};
          })(),
          ...(() => {
            if (loginState.state === 'online') {
              return { lastError: null };
            }
            return {};
          })(),
        },
      );
      return loginState.offlineReason;
    } catch (err) {
      await this.containerRepository.update(
        { id: container.id },
        {
          lastCheckedAt: new Date(),
          lastError: this.toolsService.toColumnText(
            this.toolsService.getErrorMessage(err),
            500,
          ),
        },
      );
      return null;
    }
  }

  /**
   * 根据`runtime`、`sinceMs`拼接稳定的detect运行态验证码URL 地址，用于隔离对应资源或存储记录；从 `getManagedMode` 读取detect运行态验证码URL 地址。
   * @param runtime - 用于detect运行态验证码URL 地址的领域对象，包含 `name` 字段。
   * @param sinceMs - 用于detect运行态验证码URL 地址超时、有效期或退避计算的毫秒数；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 规范化后的detect运行态验证码URL 地址；主值为空时采用 `null` 兜底；无法解析或未命中时为 `null`。
   */
  async detectRuntimeCaptchaUrl(
    runtime: Pick<NapcatRuntime, 'name'>,
    sinceMs?: number,
  ) {
    if (this.getManagedMode() !== 'ssh' || !runtime.name) return null;

    const since = (() => {
      if (typeof sinceMs === 'number' && Number.isFinite(sinceMs)) {
        return new Date(Math.max(0, sinceMs - 1000)).toISOString();
      }
      return '';
    })();
    const script = (() => {
      if (since) {
        return this.buildRemoteRecentLogsSinceScript(runtime.name, since);
      }
      return this.buildRemoteRecentLogsByNameScript(runtime.name);
    })();

    try {
      const result = await this.runProcess(
        'ssh',
        [...this.getSshArgs(), 'sh -s'],
        script,
        undefined,
        this.getCaptchaLogReadTimeoutMs(),
      );
      return this.toolsService.extractNapcatCaptchaUrl(result.stdout) || null;
    } catch {
      return null;
    }
  }

  /**
   * 根据`container`处理运行态状态；当 `!containerOnline` 成立时返回 `{ checkedAt, containerOnline, lastError: co…`。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 包含 `checkedAt`、`containerOnline`、`lastError`、`qqLoginMessage`、`qqLoginStatus` 字段的运行态状态；无法解析或未命中时为 `null`。
   */
  async inspectRuntimeStatus(
    container: NapcatContainer,
  ): Promise<NapcatRuntimeStatusSnapshot> {
    const checkedAt = new Date();
    const containerOnline = container.status === 'running';
    if (!containerOnline) {
      return {
        checkedAt,
        containerOnline,
        lastError: container.lastError,
        qqLoginMessage: null,
        qqLoginStatus: 'offline',
        webuiOnline: false,
      };
    }

    if (!container.baseUrl || !container.webuiToken) {
      const message = 'NapCat WebUI 配置缺失';
      await this.containerRepository.update(
        { id: container.id },
        {
          lastCheckedAt: checkedAt,
          lastError: message,
        },
      );
      return {
        checkedAt,
        containerOnline,
        lastError: message,
        qqLoginMessage: null,
        qqLoginStatus: 'unknown',
        webuiOnline: false,
      };
    }

    try {
      const runtime = this.toRuntime(container);
      const status = await this.requestNapcatLoginStatus(runtime);
      const snapshot = this.toRuntimeStatusSnapshot(
        status,
        containerOnline,
        checkedAt,
      );
      await this.containerRepository.update(
        { id: container.id },
        {
          lastCheckedAt: checkedAt,
          lastError: (() => {
            if (snapshot.qqLoginStatus === 'online') {
              return null;
            }
            return (
              this.toolsService.toColumnText(
                snapshot.qqLoginMessage || snapshot.lastError || '',
                500,
              ) || null
            );
          })(),
        },
      );
      return snapshot;
    } catch (err) {
      const message = this.toolsService.toColumnText(
        this.toolsService.getErrorMessage(err),
        500,
      );
      await this.containerRepository.update(
        { id: container.id },
        {
          lastCheckedAt: checkedAt,
          lastError: message,
        },
      );
      return {
        checkedAt,
        containerOnline,
        lastError: message,
        qqLoginMessage: null,
        qqLoginStatus: 'unknown',
        webuiOnline: false,
      };
    }
  }

  /**
   * 按`containerId`移除容器；把变更持久化到当前存储（`containerRepository.update`）。
   * @param containerId - 用于精确定位容器的标识。
   * @returns 满足容器约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async removeContainer(containerId: string) {
    const container = await this.containerRepository.findOne({
      where: {
        id: containerId,
        isDeleted: false,
      },
    });
    if (!container) return false;

    if (this.getManagedMode() === 'ssh') {
      await this.removeRemoteDockerContainer(container);
    }

    await this.containerRepository.update(
      { id: container.id },
      {
        isDeleted: true,
        lastError: null,
        status: 'stopped',
      },
    );
    return true;
  }

  /**
   * 按`accountId`、`keepContainerId`移除Other账号Containers；把变更持久化到当前存储（`bindingRepository.createQueryBuilder`）。
   * @param accountId - 用于精确定位账号的标识。
   * @param keepContainerId - 用于精确定位keep容器的标识。
   */
  private async removeOtherAccountContainers(
    accountId: string,
    keepContainerId: string,
  ) {
    const bindings = await this.bindingRepository.find({
      where: {
        accountId,
        isDeleted: false,
      },
    });
    for (const binding of bindings) {
      if (binding.containerId === keepContainerId) continue;

      const sharedCount = await this.bindingRepository
        .createQueryBuilder('binding')
        .where('binding.containerId = :containerId', {
          containerId: binding.containerId,
        })
        .andWhere('binding.accountId != :accountId', { accountId })
        .andWhere('binding.isDeleted = :isDeleted', { isDeleted: false })
        .getCount();
      if (sharedCount <= 0) {
        await this.removeContainer(binding.containerId);
      }

      await this.bindingRepository.update(
        { id: binding.id },
        {
          bindStatus: 'disabled',
          isDeleted: true,
          isPrimary: false,
        },
      );
    }
  }

  /**
   * 按`container`移除远端Docker容器；从 `getSshArgs` 读取远端Docker容器。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   */
  private async removeRemoteDockerContainer(container: NapcatContainer) {
    const script = this.buildRemoteRemoveScript(container);
    await this.runProcess('ssh', [...this.getSshArgs(), 'sh -s'], script);
  }

  /**
   * 根据`container`构造远端脚本；从 `getRootDir` 读取远端脚本。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 按参数编码并拼接完成的远端脚本。
   */
  private buildRemoteRemoveScript(container: NapcatContainer) {
    const dataDir = this.sh(container.dataDir || '');
    const name = this.sh(container.name);
    const rootDir = this.sh(this.getRootDir());

    return `
set -eu
${this.buildRemoteMutationLockScript()}
NAME=${name}
DATA_DIR=${dataDir}
ROOT_DIR=${rootDir}

docker rm -f "$NAME" >/dev/null 2>&1 || true

if [ -n "$DATA_DIR" ] && [ "$DATA_DIR" != "/" ]; then
  case "$DATA_DIR" in
    "$ROOT_DIR"/*)
      rm -rf "$DATA_DIR"
      ;;
    *)
      echo "skip unsafe data dir: $DATA_DIR" >&2
      ;;
  esac
fi
`;
  }

  /**
   * 根据`container`构造远端ResetLogin状态脚本；从 `getRootDir` 读取远端ResetLogin状态脚本。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 按参数编码并拼接完成的远端ResetLogin状态脚本。
   */
  private buildRemoteResetLoginStateScript(container: NapcatContainer) {
    const dataDir = this.sh(container.dataDir || '');
    const name = this.sh(container.name);
    const rootDir = this.sh(this.getRootDir());

    return `
set -eu
${this.buildRemoteMutationLockScript()}
NAME=${name}
DATA_DIR=${dataDir}
ROOT_DIR=${rootDir}

if [ -z "$DATA_DIR" ] || [ "$DATA_DIR" = "/" ]; then
  echo "unsafe empty data dir" >&2
  exit 1
fi

case "$DATA_DIR" in
  "$ROOT_DIR"/*)
    ;;
  *)
    echo "skip unsafe data dir: $DATA_DIR" >&2
    exit 1
    ;;
esac

docker exec "$NAME" rm -f /app/napcat/cache/qrcode.png >/dev/null 2>&1 || true
echo "__KT_PROGRESS__:container-stop:正在停止 NapCat 容器"
docker stop "$NAME" >/dev/null 2>&1 || true
echo "__KT_PROGRESS__:login-data-clean:正在清理旧 QQ 登录态"
mkdir -p "$DATA_DIR/QQ"
find "$DATA_DIR/QQ" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
echo "__KT_PROGRESS__:container-start:正在启动 NapCat 容器"
docker start "$NAME" >/dev/null
echo "__KT_PROGRESS__:container-started:NapCat 容器已启动"
`;
  }

  /**
   * 根据`container`构造远端最近日志集合脚本。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 远端最近日志集合脚本。
   */
  private buildRemoteRecentLogsScript(container: NapcatContainer) {
    return this.buildRemoteRecentLogsByNameScript(container.name);
  }

  /**
   * 生成读取指定容器最近三百行 Docker 日志且忽略读取失败的远端 Shell 脚本。
   * @param name - 要读取日志的 Docker 容器名。
   * @returns 已安全转义容器名的日志采集脚本；`docker logs` 失败不会令脚本报错退出。
   */
  private buildRemoteRecentLogsByNameScript(name: string) {
    return `
set -eu
NAME=${this.sh(name)}
docker logs --tail 300 "$NAME" 2>&1 || true
`;
  }

  /**
   * 生成从指定时间点起读取容器最近三百行 Docker 日志且忽略读取失败的远端 Shell 脚本。
   * @param name - 要读取日志的 Docker 容器名。
   * @param since - 传给 `docker logs --since` 的起始时间或相对时长。
   * @returns 已安全转义容器名与起始时间的日志采集脚本；日志读取失败不会令脚本报错退出。
   */
  private buildRemoteRecentLogsSinceScript(name: string, since: string) {
    return `
set -eu
NAME=${this.sh(name)}
SINCE=${this.sh(since)}
docker logs --since "$SINCE" --tail 300 "$NAME" 2>&1 || true
`;
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param logs - 决定Login状态内容、边界或目标的 `logs` 值。
   * @returns 包含 `offlineReason`、`state` 字段的Login状态；无法解析或未命中时为 `null`。
   */
  private extractLoginState(logs: string): NapcatLoginLogResult {
    const lines = logs
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse();

    const matchedLine = lines.find(
      (line) =>
        this.toolsService.isNapcatOfflineLoginMessage(line) ||
        this.toolsService.isNapcatOnlineLoginMessage(line),
    );
    if (!matchedLine) {
      return {
        offlineReason: null,
        state: 'unknown',
      };
    }

    if (this.toolsService.isNapcatOnlineLoginMessage(matchedLine)) {
      return {
        offlineReason: null,
        state: 'online',
      };
    }

    const message = matchedLine
      .replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\[[^\]]+\]\s+/, '')
      .replace(/^Mirror\s*\|\s*/, '')
      .replace(/\[KickedOffLine]/gi, '')
      .replace(/\[下线通知]/g, '')
      .trim();
    const offlineReason = (() => {
      if (this.toolsService.isNapcatOfflineFlagMessage(matchedLine)) {
        return 'NapCat 账号状态变更为离线';
      }
      return message || 'NapCat 账号状态变更为离线';
    })();

    return {
      offlineReason,
      state: 'offline',
    };
  }

  /**
   * 按`accountId`读取Primary运行态；当 `container` 成立时返回 `this.toRuntime(container)`。
   * @param accountId - 用于精确定位账号的标识。
   * @returns Primary运行态；无法解析或未命中时为 `null`。
   */
  private async getPrimaryRuntime(accountId: string) {
    const binding = await this.bindingRepository.findOne({
      order: {
        updateTime: 'DESC',
      },
      where: {
        accountId,
        bindStatus: 'bound',
        isDeleted: false,
        isPrimary: true,
      },
    });
    if (!binding) return null;

    const container = await this.containerRepository
      .createQueryBuilder('container')
      .addSelect('container.webuiToken')
      .where('container.id = :containerId', {
        containerId: binding.containerId,
      })
      .andWhere('container.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('container.status != :status', { status: 'error' })
      .getOne();
    if (container) {
      return this.toRuntime(container);
    }
    return null;
  }

  /**
   * 按`accountId`读取主要的容器（按账号标识匹配）；从 `getPrimaryRuntime` 读取主要的容器（按账号标识匹配）。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 主要的容器（按账号标识匹配）。
   */
  async findPrimaryContainerByAccountId(accountId: string) {
    return this.getPrimaryRuntime(accountId);
  }

  /**
   * 按`containerId`读取容器令牌；把变更持久化到当前存储（`containerRepository.createQueryBuilder`）。
   * @param containerId - 用于精确定位容器的标识。
   * @returns 容器令牌。
   */
  private async findContainerWithToken(containerId: string) {
    return this.containerRepository
      .createQueryBuilder('container')
      .addSelect('container.webuiToken')
      .where('container.id = :containerId', { containerId })
      .andWhere('container.isDeleted = :isDeleted', { isDeleted: false })
      .getOne();
  }

  /**
   * 根据`selfId`、`loginPassword`、`accountId`构造托管模式容器；把变更持久化到当前存储（`containerRepository.create`）。
   * @param selfId - 用于精确定位QQ 账号的标识；为空时采用 `identityAccountId` 作为兜底。
   * @param loginPassword - 决定托管模式容器内容、边界或目标的 `loginPassword` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param accountId - 用于精确定位账号的标识；为空时采用 `null` 作为兜底。
   * @param options - 控制托管模式容器筛选、缓存或输出方式的可选项，包含 `startRemote` 字段；省略时默认采用 `{}`。
   * @returns 包含 `baseUrl`、`dataDir`、`id`、`name`、`webuiPort` 字段的托管模式容器。
   */
  private async createManagedContainer(
    selfId?: string,
    loginPassword?: string,
    accountId?: string,
    options: CreateManagedContainerOptions = {},
  ) {
    const mode = this.getManagedMode();
    if (mode !== 'ssh') {
      throwVbenError('当前仅支持通过 SSH 创建 NapCat 容器');
    }

    const image = this.getConfig('NAPCAT_IMAGE');
    if (!image) {
      throwVbenError('NapCat 镜像未配置，请先设置 NAPCAT_IMAGE');
    }
    const port = await this.allocatePort();
    const token = randomBytes(24).toString('hex');
    const container = this.containerRepository.create({
      baseUrl: this.buildBaseUrl(port),
      accountId: accountId || null,
      dataDir: '',
      image,
      isDeleted: false,
      lastError: null,
      name: '',
      remark: '',
      reverseWsUrl: this.buildReverseWsUrl(),
      status: 'creating',
      webuiPort: port,
      webuiToken: token,
    });
    ensureSnowflakeId(container);
    const identityAccountId = accountId || container.id;
    const name = this.buildContainerName(selfId || identityAccountId);
    let dataDir = `${this.getRootDir()}/${name}`;
    let deviceIdentity: NapcatDockerDeviceOptions | undefined;
    if (identityAccountId && this.deviceIdentityService) {
      const identity = await this.deviceIdentityService.resolveForAccount({
        accountId: identityAccountId,
        containerId: container.id,
        selfId,
      });
      dataDir = identity.dataDir || dataDir;
      deviceIdentity = toNapcatDockerDeviceOptions(identity);
    }
    const baseUrl = container.baseUrl;
    const reverseWsUrl = container.reverseWsUrl;
    Object.assign(container, {
      dataDir,
      name,
    });

    const savedContainer = await this.containerRepository.save(container);

    try {
      if (options.startRemote !== false) {
        await this.createRemoteDockerContainer({
          account: selfId,
          accountId: identityAccountId,
          containerId: savedContainer.id,
          dataDir,
          deviceIdentity,
          image,
          loginPassword,
          name,
          port,
          reverseWsUrl,
          token,
        });
        await this.containerRepository.update(
          { id: savedContainer.id },
          {
            lastError: null,
            lastStartedAt: new Date(),
            status: 'running',
          },
        );
      }
      if (accountId && this.deviceIdentityService) {
        const identity = await this.deviceIdentityService.resolveForAccount({
          accountId,
          containerId: savedContainer.id,
          selfId,
        });
        await this.bindingRepository.update(
          { accountId, containerId: savedContainer.id, isDeleted: false },
          { deviceIdentityId: identity.id },
        );
      }
      return {
        baseUrl,
        dataDir,
        id: savedContainer.id,
        name,
        webuiPort: port,
        webuiToken: token,
      };
    } catch (err) {
      const message = this.toolsService.getErrorMessage(err);
      await this.containerRepository.update(
        { id: savedContainer.id },
        {
          lastError: this.toolsService.toColumnText(message, 500),
          status: 'error',
        },
      );
      throwVbenError(`创建 NapCat 容器失败：${message}`);
    }
  }

  /**
   * 根据`input`构造远端Docker容器；从 `getSshArgs` 读取远端Docker容器。
   * @param input - 用于远端Docker容器的结构化输入。
   */
  private async createRemoteDockerContainer(input: {
    account?: string;
    accountId?: string;
    containerId?: string;
    dataDir: string;
    deviceIdentity?: NapcatDockerDeviceOptions;
    image: string;
    loginPassword?: string;
    name: string;
    port: number;
    reverseWsUrl: string;
    skipPull?: boolean;
    token: string;
  }) {
    const script = this.buildRemoteCreateScript(input);
    await this.runProcess('ssh', [...this.getSshArgs(), 'sh -s'], script);
    await this.recordPlannedProfiles(input);
  }

  /**
   * 根据账号、镜像和运行档案生成受变更锁保护的远程脚本，准备目录与配置后创建 NapCat 容器。
   * @param input - 容器名称、镜像、端口、数据目录、登录凭据及设备身份等创建参数。
   * @returns 已转义敏感参数并包含配置写入、目录校验和 Docker 创建步骤的 Shell 脚本。
   */
  private buildRemoteCreateScript(input: {
    account?: string;
    accountId?: string;
    containerId?: string;
    dataDir: string;
    deviceIdentity?: NapcatDockerDeviceOptions;
    image: string;
    loginPassword?: string;
    name: string;
    port: number;
    reverseWsUrl: string;
    skipPull?: boolean;
    token: string;
  }) {
    const dataDir = this.sh(input.dataDir);
    const image = this.sh(input.image);
    const name = this.sh(input.name);
    const reverseWsUrl = this.sh(input.reverseWsUrl);
    const token = this.sh(input.token);
    const account = `${input.account || ''}`.trim();
    const loginPassword = this.toolsService.toSecretText(input.loginPassword);
    const runtimeProfile = this.runtimeProfileService.resolveRuntimeProfile({
      accountId: account || input.name,
      containerId: input.containerId,
      dataDir: input.dataDir,
      deviceIdentityId: input.deviceIdentity?.deviceIdentityId,
    });
    const configBundle = this.configWriterService.buildConfigFiles({
      account,
      reverseWsUrl: '$REVERSE_WS_URL',
      token: '$WEBUI_TOKEN',
    });
    const configWriteScript = this.renderConfigFiles(configBundle.files);
    const accountHeader = (() => {
      if (account) {
        return `ACCOUNT=${this.sh(account)}\n`;
      }
      return '';
    })();
    const accountRunFlag = (() => {
      if (account) {
        return '  -e ACCOUNT="$ACCOUNT" \\\n';
      }
      return '';
    })();
    const passwordHeader = (() => {
      if (loginPassword) {
        return `NAPCAT_QUICK_PASSWORD=${this.sh(loginPassword)}\n`;
      }
      return '';
    })();
    const passwordRunFlag = (() => {
      if (loginPassword) {
        return '  -e NAPCAT_QUICK_PASSWORD="$NAPCAT_QUICK_PASSWORD" \\\n';
      }
      return '';
    })();
    const pullCmd = (() => {
      if (input.skipPull) {
        return '';
      }
      return `if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker pull "$IMAGE" >/dev/null
fi
`;
    })();
    const deviceHeader = (() => {
      if (input.deviceIdentity) {
        return (
          [
            `NAPCAT_HOSTNAME=${this.sh(input.deviceIdentity.hostname)}`,
            `NAPCAT_MAC_ADDRESS=${this.sh(input.deviceIdentity.macAddress)}`,
            `NAPCAT_MAC_HYPHEN=${this.sh(input.deviceIdentity.macAddressHyphen)}`,
            `MACHINE_ID_PATH=${this.sh(input.deviceIdentity.machineIdPath)}`,
            `MACHINE_INFO_PATH=${this.sh(input.deviceIdentity.machineInfoPath)}`,
            `DEVICE_ENV_PATH=${this.sh(input.deviceIdentity.deviceEnvPath)}`,
          ].join('\n') + '\n'
        );
      }
      return '';
    })();
    const deviceProfileHeader = [
      `NAPCAT_DMI_PRODUCT_NAME=${this.sh('imini Pro')}`,
      `NAPCAT_DMI_SYS_VENDOR=${this.sh('MECHREVO')}`,
      `NAPCAT_DMI_BOARD_VENDOR=${this.sh('MECHREVO')}`,
      `NAPCAT_DMI_BOARD_NAME=${this.sh('imini Pro')}`,
      `NAPCAT_DMI_BIOS_VENDOR=${this.sh(
        'American Megatrends International, LLC.',
      )}`,
      `NAPCAT_DMI_BIOS_VERSION=${this.sh('imini Pro 1.10')}`,
      `NAPCAT_DMI_MODALIAS=${this.sh(
        'dmi:bvnAmericanMegatrendsInternational,LLC.:bvriminiPro1.10:bd03/31/2024:br1.10:efr1.10:svnMECHREVO:pniminiPro:pvrStandard:rvnMECHREVO:rniminiPro:rvrStandard:cvnMECHREVO:ct3:cvrDefaultstring:skuStandard:',
      )}`,
      `NAPCAT_DEVICE_KERNEL_RELEASE=${this.sh('6.8.0-60-generic')}`,
      `NAPCAT_DEVICE_KERNEL_VERSION=${this.sh(
        '#63-Ubuntu SMP PREEMPT_DYNAMIC Tue Apr 15 19:04:15 UTC 2025',
      )}`,
      `NAPCAT_DEVICE_PROC_VERSION=${this.sh(
        'Linux version 6.8.0-60-generic (buildd@lcy02-amd64-001) (x86_64-linux-gnu-gcc (Ubuntu 13.3.0-6ubuntu2~24.04) 13.3.0, GNU ld (GNU Binutils for Ubuntu) 2.42) #63-Ubuntu SMP PREEMPT_DYNAMIC Tue Apr 15 19:04:15 UTC 2025',
      )}`,
      `NAPCAT_DEVICE_CPU_MODEL=${this.sh(
        'AMD Ryzen 7 8845H w/ Radeon 780M Graphics',
      )}`,
      `NAPCAT_DEVICE_UPTIME=${this.sh('7200.00 14400.00')}`,
      `NAPCAT_DEVICE_TTY_ACTIVE=${this.sh('tty1')}`,
    ].join('\n');
    const devicePrepareScript = (() => {
      if (input.deviceIdentity) {
        return `
mkdir -p "$(dirname "$DEVICE_ENV_PATH")" "$(dirname "$MACHINE_INFO_PATH")"
cat > "$DEVICE_ENV_PATH" <<EOF
NAPCAT_HOSTNAME=$NAPCAT_HOSTNAME
NAPCAT_MAC_ADDRESS=$NAPCAT_MAC_ADDRESS
NAPCAT_MAC_HYPHEN=$NAPCAT_MAC_HYPHEN
MACHINE_ID_PATH=$MACHINE_ID_PATH
MACHINE_INFO_PATH=$MACHINE_INFO_PATH
EOF
if [ ! -s "$MACHINE_ID_PATH" ]; then
  printf '%s' "$NAME" | sha256sum | cut -c 1-32 > "$MACHINE_ID_PATH"
fi
if [ -s "$MACHINE_INFO_PATH" ]; then
  CURRENT_MACHINE_INFO_MAC="$(dd if="$MACHINE_INFO_PATH" bs=1 skip=4 2>/dev/null | tr 'A-Za-z' 'N-ZA-Mn-za-m' || true)"
  if [ "$CURRENT_MACHINE_INFO_MAC" != "$NAPCAT_MAC_HYPHEN" ]; then
    cp "$MACHINE_INFO_PATH" "$MACHINE_INFO_PATH.bak.$(date +%Y%m%d%H%M%S)"
  fi
fi
MACHINE_INFO_TMP="$MACHINE_INFO_PATH.tmp"
printf '\\000\\000\\000\\021' > "$MACHINE_INFO_TMP"
printf '%s' "$NAPCAT_MAC_HYPHEN" | tr 'A-Za-z' 'N-ZA-Mn-za-m' >> "$MACHINE_INFO_TMP"
mv "$MACHINE_INFO_TMP" "$MACHINE_INFO_PATH"
chmod 644 "$MACHINE_INFO_PATH"
`;
      }
      return '';
    })();
    const deviceProfilePrepareScript = `
if [ -z "\${MACHINE_ID_PATH:-}" ]; then
  MACHINE_ID_PATH="$DATA_DIR/machine-id"
fi
mkdir -p "$(dirname "$MACHINE_ID_PATH")"
if [ ! -s "$MACHINE_ID_PATH" ]; then
  printf '%s' "$NAME" | sha256sum | cut -c 1-32 > "$MACHINE_ID_PATH"
fi
NAPCAT_DEVICE_MACHINE_ID="$(tr -d '\\r\\n' < "$MACHINE_ID_PATH" | cut -c 1-64)"
format_uuid_from_seed() {
  uuid_hash="$(printf '%s' "$1" | sha256sum | awk '{print $1}')"
  printf '%s-%s-%s-%s-%s' \\
    "$(printf '%s' "$uuid_hash" | cut -c 1-8)" \\
    "$(printf '%s' "$uuid_hash" | cut -c 9-12)" \\
    "$(printf '%s' "$uuid_hash" | cut -c 13-16)" \\
    "$(printf '%s' "$uuid_hash" | cut -c 17-20)" \\
    "$(printf '%s' "$uuid_hash" | cut -c 21-32)"
}
if [ ! -s "$DATA_DIR/device-boot-id" ]; then
  format_uuid_from_seed "$NAPCAT_DEVICE_MACHINE_ID:boot" > "$DATA_DIR/device-boot-id"
fi
NAPCAT_DEVICE_BOOT_ID="$(tr -d '\\r\\n' < "$DATA_DIR/device-boot-id" | cut -c 1-36)"
NAPCAT_DMI_PRODUCT_UUID="$(format_uuid_from_seed "$NAPCAT_DEVICE_MACHINE_ID:dmi")"
`;
    const deviceRunFlags = (() => {
      if (input.deviceIdentity) {
        return '  --hostname "$NAPCAT_HOSTNAME" \\\n  --mac-address "$NAPCAT_MAC_ADDRESS" \\\n  -v "$MACHINE_ID_PATH:/etc/machine-id:ro" \\\n';
      }
      return '  -v "$MACHINE_ID_PATH:/etc/machine-id:ro" \\\n';
    })();

    return `
set -eu
${this.buildRemoteMutationLockScript()}
DATA_DIR=${dataDir}
IMAGE=${image}
NAME=${name}
PORT=${input.port}
REVERSE_WS_URL=${reverseWsUrl}
WEBUI_TOKEN=${token}
NAPCAT_UID=${this.sh(`${runtimeProfile.runtimeUid}`)}
NAPCAT_GID=${this.sh(`${runtimeProfile.runtimeGid}`)}
NAPCAT_SHM_SIZE=${this.sh(runtimeProfile.shmSize)}
${accountHeader}
${passwordHeader}
${deviceHeader}
${deviceProfileHeader}
if docker container inspect "$NAME" >/dev/null 2>&1; then
  CURRENT_IMAGE="$(docker container inspect --format '{{.Config.Image}}' "$NAME")"
  if [ "$CURRENT_IMAGE" != "$IMAGE" ]; then
    echo "NapCat runtime image changed while waiting for the mutation lock" >&2
    exit 75
  fi
fi
mkdir -p "$DATA_DIR/QQ" "$DATA_DIR/config" "$DATA_DIR/plugins" "$DATA_DIR/logs" "$DATA_DIR/cache" "$DATA_DIR/local-share" "$DATA_DIR/runtime"
chmod 700 "$DATA_DIR"
chmod 700 "$DATA_DIR/runtime"
${devicePrepareScript}
${deviceProfilePrepareScript}

${configWriteScript}

${pullCmd}docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d \\
  --name "$NAME" \\
  --restart unless-stopped \\
  --init \\
  --cap-add SYS_ADMIN \\
  --security-opt apparmor=unconfined \\
  --security-opt seccomp=unconfined \\
  --shm-size "$NAPCAT_SHM_SIZE" \\
  -e NAPCAT_UID="$NAPCAT_UID" \\
  -e NAPCAT_GID="$NAPCAT_GID" \\
  -e NAPCAT_REQUIRE_DEVICE_PROFILE=1 \\
  -e NAPCAT_DEVICE_MACHINE_ID="$NAPCAT_DEVICE_MACHINE_ID" \\
  -e NAPCAT_DEVICE_BOOT_ID="$NAPCAT_DEVICE_BOOT_ID" \\
  -e NAPCAT_DEVICE_KERNEL_RELEASE="$NAPCAT_DEVICE_KERNEL_RELEASE" \\
  -e NAPCAT_DEVICE_KERNEL_VERSION="$NAPCAT_DEVICE_KERNEL_VERSION" \\
  -e NAPCAT_DEVICE_PROC_VERSION="$NAPCAT_DEVICE_PROC_VERSION" \\
  -e NAPCAT_DEVICE_CPU_MODEL="$NAPCAT_DEVICE_CPU_MODEL" \\
  -e NAPCAT_DEVICE_UPTIME="$NAPCAT_DEVICE_UPTIME" \\
  -e NAPCAT_DEVICE_TTY_ACTIVE="$NAPCAT_DEVICE_TTY_ACTIVE" \\
  -e NAPCAT_DMI_PRODUCT_NAME="$NAPCAT_DMI_PRODUCT_NAME" \\
  -e NAPCAT_DMI_PRODUCT_UUID="$NAPCAT_DMI_PRODUCT_UUID" \\
  -e NAPCAT_DMI_SYS_VENDOR="$NAPCAT_DMI_SYS_VENDOR" \\
  -e NAPCAT_DMI_BOARD_VENDOR="$NAPCAT_DMI_BOARD_VENDOR" \\
  -e NAPCAT_DMI_BOARD_NAME="$NAPCAT_DMI_BOARD_NAME" \\
  -e NAPCAT_DMI_BIOS_VENDOR="$NAPCAT_DMI_BIOS_VENDOR" \\
  -e NAPCAT_DMI_BIOS_VERSION="$NAPCAT_DMI_BIOS_VERSION" \\
  -e NAPCAT_DMI_MODALIAS="$NAPCAT_DMI_MODALIAS" \\
  -e WEBUI_TOKEN="$WEBUI_TOKEN" \\
  -e LANG=${runtimeProfile.locale} \\
  -e LC_ALL=${runtimeProfile.locale} \\
  -e LANGUAGE=zh_CN:zh \\
  -e TZ=${runtimeProfile.timezone} \\
  -e HOME=/app \\
  -e XDG_CONFIG_HOME=${runtimeProfile.xdgConfigHome} \\
  -e XDG_CACHE_HOME=${runtimeProfile.xdgCacheHome} \\
  -e XDG_DATA_HOME=${runtimeProfile.xdgDataHome} \\
  -e XDG_RUNTIME_DIR=/tmp/runtime-napcat \\
${accountRunFlag}${passwordRunFlag}${deviceRunFlags}  -p "$PORT:6099" \\
  -v "$DATA_DIR/QQ:/app/.config/QQ" \\
  -v "$DATA_DIR/config:/app/napcat/config" \\
  -v "$DATA_DIR/plugins:/app/napcat/plugins" \\
  -v "$DATA_DIR/cache:/app/.cache" \\
  -v "$DATA_DIR/local-share:/app/.local/share" \\
  -v "$DATA_DIR/runtime:/tmp/runtime-napcat" \\
  -v "$DATA_DIR/logs:/app/napcat/logs" \\
  "$IMAGE" >/dev/null
`;
  }

  /**
   * 生成远程运行态变更保护段：验证依赖、限时取得文件锁，并在迁移恢复尚未完成时拒绝变更。
   * @returns 可嵌入容器变更脚本开头的互斥锁与迁移状态检查脚本。
   */
  private buildRemoteMutationLockScript() {
    return `NAPCAT_RUNTIME_MUTATION_LOCK=${this.sh(
      NAPCAT_RUNTIME_MUTATION_LOCK_PATH,
    )}
NAPCAT_RUNTIME_MIGRATION_STATE=${this.sh(NAPCAT_RUNTIME_MIGRATION_STATE_PATH)}
for NAPCAT_RUNTIME_REQUIRED_COMMAND in flock find; do
  command -v "$NAPCAT_RUNTIME_REQUIRED_COMMAND" >/dev/null 2>&1 || {
    echo "NapCat runtime mutation guard requires $NAPCAT_RUNTIME_REQUIRED_COMMAND" >&2
    exit 75
  }
done
exec 9>"$NAPCAT_RUNTIME_MUTATION_LOCK"
flock -w 30 9 || {
  echo "NapCat runtime mutation is busy" >&2
  exit 75
}
if [ -e "$NAPCAT_RUNTIME_MIGRATION_STATE" ] || [ -L "$NAPCAT_RUNTIME_MIGRATION_STATE" ]; then
  if [ -L "$NAPCAT_RUNTIME_MIGRATION_STATE" ] || [ ! -d "$NAPCAT_RUNTIME_MIGRATION_STATE" ]; then
    echo "NapCat runtime migration state path is unsafe" >&2
    exit 75
  fi
  if ! NAPCAT_RUNTIME_PENDING_JOURNAL="$(
    find "$NAPCAT_RUNTIME_MIGRATION_STATE" \
      -mindepth 1 -maxdepth 1 -type f -name '*.json' -print -quit
  )"; then
    echo "NapCat runtime migration state inspection failed" >&2
    exit 75
  fi
  if [ -n "$NAPCAT_RUNTIME_PENDING_JOURNAL" ]; then
    echo "NapCat runtime migration recovery is pending" >&2
    exit 75
  fi
fi
`;
  }

  /**
   * 根据参数 `action`，生成先取得运行态变更锁、再启动或重启指定 NapCat 容器的远程脚本。
   * @param action - 要执行的 Docker 生命周期动作，仅允许 `start` 或 `restart`。
   * @param name - 目标 NapCat Docker 容器名称，将按 Shell 单词安全转义。
   * @returns 受互斥锁和迁移状态保护的容器生命周期 Shell 脚本。
   */
  private buildRemoteDockerLifecycleScript(
    action: 'restart' | 'start',
    name: string,
  ) {
    return `
set -eu
${this.buildRemoteMutationLockScript()}
NAME=${this.sh(name)}
docker ${action} "$NAME" >/dev/null
`;
  }

  /**
   * 根据`input`处理记录已规划的配置档案。
   * @param input - 用于记录已规划的配置档案的结构化输入，包含 `accountId`、`deviceIdentity`、`account`、`containerId` 字段。
   */
  private async recordPlannedProfiles(input: {
    account?: string;
    accountId?: string;
    containerId?: string;
    dataDir: string;
    deviceIdentity?: NapcatDockerDeviceOptions;
    image: string;
    loginPassword?: string;
    name: string;
    port: number;
    reverseWsUrl: string;
    skipPull?: boolean;
    token: string;
  }) {
    const accountId =
      this.toolsService.toTrimmedString(input.accountId) ||
      this.toolsService.toTrimmedString(input.deviceIdentity?.accountId);
    if (!accountId || !input.deviceIdentity) return;

    const account = `${input.account || ''}`.trim();
    const runtimeProfile = this.runtimeProfileService.resolveRuntimeProfile({
      accountId,
      containerId: input.containerId,
      dataDir: input.dataDir,
      deviceIdentityId: input.deviceIdentity.deviceIdentityId,
    });
    const configBundle = this.configWriterService.buildConfigFiles({
      account,
      reverseWsUrl: input.reverseWsUrl,
      token: input.token,
    });

    await this.runtimeProfileService.recordPlannedProfiles({
      accountId,
      containerId: input.containerId,
      dataDir: input.dataDir,
      deviceIdentity: {
        deviceIdentityId: input.deviceIdentity.deviceIdentityId,
        hostname: input.deviceIdentity.hostname,
        hostnameStrategy: input.deviceIdentity.hostnameStrategy,
        machineInfoPath: input.deviceIdentity.machineInfoPath,
        macAddress: input.deviceIdentity.macAddress,
        macStrategy: input.deviceIdentity.macStrategy,
      },
      protocolProfile: {
        napcatConfigHash: configBundle.napcatConfigHash,
        napcatConfigJson: configBundle.napcatConfig,
        o3HookGrayEnabled: false,
        o3HookMode: configBundle.napcatConfig.o3HookMode,
        onebotConfigHash: configBundle.onebotConfigHash,
        onebotConfigJson: configBundle.onebotConfig,
        packetBackend: configBundle.napcatConfig.packetBackend,
        packetServer: configBundle.napcatConfig.packetServer,
      },
      runtimeProfile,
    });
  }

  /**
   * 根据`files`绘制或格式化配置文件。
   * @param files - 按原有顺序参与配置文件筛选、合并或汇总的集合。
   * @returns 配置文件。
   */
  private renderConfigFiles(files: NapcatConfigFile[]) {
    return files
      .map((file) => {
        return `cat > "$DATA_DIR/config/${file.path}" <<EOF
${file.content}EOF`;
      })
      .join('\n\n');
  }

  /**
   * 根据当前运行态处理allocate端口；从 `getConfig` 读取allocate端口。
   * @returns allocate端口。
   */
  private async allocatePort() {
    const start = Number(this.getConfig('NAPCAT_PORT_START', '6100'));
    const end = Number(this.getConfig('NAPCAT_PORT_END', '6199'));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      throwVbenError('NapCat 端口池配置错误');
    }

    const containers = await this.containerRepository.find({
      select: ['webuiPort'],
      where: {
        isDeleted: false,
      },
    });
    const used = new Set(
      containers
        .map((container) => container.webuiPort)
        .filter((port): port is number => typeof port === 'number'),
    );
    for (let port = start; port <= end; port += 1) {
      if (!used.has(port)) return port;
    }
    throwVbenError('NapCat 端口池已用完');
  }

  /**
   * 根据`selfId`构造容器名称；从 `getConfig` 读取容器名称。
   * @param selfId - 用于精确定位QQ 账号的标识；为空时采用 `randomUUID().slice(0, 8)` 作为兜底。
   * @returns 容器名称。
   */
  private buildContainerName(selfId?: string) {
    const prefix = this.getConfig('NAPCAT_CONTAINER_PREFIX', 'kt-napcat');
    const suffix = `${selfId || randomUUID().slice(0, 8)}`
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
      .toLowerCase();
    return `${prefix}-${suffix}`.replace(/-+/g, '-').slice(0, 120);
  }

  /**
   * 根据`port`构造BaseURL 地址；当 `template` 成立时返回 `template.replace('{port}', `${port}`)`。
   * @param port - 决定BaseURL 地址内容、边界或目标的 `port` 值。
   * @returns 按参数编码并拼接完成的BaseURL 地址。
   */
  private buildBaseUrl(port: number) {
    const template = this.getConfig('NAPCAT_BASE_URL_TEMPLATE', '');
    if (template) {
      return template.replace('{port}', `${port}`);
    }

    const host = this.getConfig('NAPCAT_HOST', '127.0.0.1');
    return `http://${host}:${port}`;
  }

  /**
   * 根据当前运行态构造ReverseWsURL 地址；从 `getConfig` 读取ReverseWsURL 地址。
   * @returns 按参数编码并拼接完成的ReverseWsURL 地址。
   */
  private buildReverseWsUrl() {
    const configured =
      this.getConfig('NAPCAT_REVERSE_WS_URL', '') ||
      this.getConfig('NAPCAT_REVERSE_WS_BASE', '');
    const path = this.getConfig(
      'BOT_REVERSE_WS_PATH',
      '/bot-adapter/napcat/onebot/reverse',
    );
    const base = configured || `ws://127.0.0.1:48085${path}`;
    const token = this.getConfig('BOT_REVERSE_WS_TOKEN', '');
    if (!token || base.includes('token=')) return base;
    const joiner = (() => {
      if (base.includes('?')) {
        return '&';
      }
      return '?';
    })();
    return `${base}${joiner}token=${encodeURIComponent(token)}`;
  }

  /**
   * 按当前运行态读取Legacy运行态；从 `getConfig` 读取Legacy运行态。
   * @returns 包含 `baseUrl`、`name`、`webuiToken` 字段的Legacy运行态。
   */
  private getLegacyRuntime(): NapcatRuntime {
    return {
      baseUrl: this.normalizeBaseUrl(
        this.getConfig('NAPCAT_WEBUI_BASE_URL', '') ||
          this.getConfig('NAPCAT_WEBUI_URL', ''),
      ),
      name: 'kt-napcat',
      webuiToken:
        this.getConfig('NAPCAT_WEBUI_TOKEN', '') ||
        this.getConfig('NAPCAT_WEBUI_TOKEN', ''),
    };
  }

  /**
   * 将 NapCat 容器实体投影为登录运行态，规范基础 URL 并由容器状态推导源容器在线标志。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 包含 `baseUrl`、`id`、`name`、`sourceContainerOnline`、`webuiPort` 字段的运行态。
   */
  private toRuntime(container: NapcatContainer): NapcatRuntime {
    return {
      baseUrl: this.normalizeBaseUrl(container.baseUrl),
      id: container.id,
      name: container.name,
      sourceContainerOnline: container.status === 'running',
      webuiPort: container.webuiPort,
      webuiToken: container.webuiToken,
    };
  }

  /**
   * 按`runtime`读取NapCat登录凭据；当 `cached && Date.now() < cached.expiresAt` 成立时返回 `cached.credential`。
   * @param runtime - 决定NapCat登录凭据内容、边界或目标的 `runtime` 值。
   * @returns NapCat登录凭据。
   */
  private async getNapcatCredential(runtime: NapcatRuntime) {
    const cacheKey = this.getNapcatCredentialCacheKey(runtime);
    const cached = this.webuiCredentials[cacheKey];
    if (cached && Date.now() < cached.expiresAt) {
      return cached.credential;
    }

    const pending = this.webuiCredentialRequests[cacheKey];
    if (pending) {
      return pending;
    }

    const request = this.fetchNapcatCredential(runtime, cacheKey);
    this.webuiCredentialRequests[cacheKey] = request;
    try {
      return await request;
    } finally {
      delete this.webuiCredentialRequests[cacheKey];
    }
  }

  /**
   * 从 NapCat WebUI 换取并缓存新的 Bearer Credential。
   * @param runtime - NapCat runtime；提供 WebUI 地址和 token 以调用 `/api/auth/login`。
   * @param cacheKey - 已由调用方按容器身份和 token 生成的缓存键，用于落入同一 single-flight 槽位。
   * @returns 可用于后续 NapCat WebUI 请求的 Credential。
   */
  private async fetchNapcatCredential(
    runtime: NapcatRuntime,
    cacheKey: string,
  ) {
    const token = runtime.webuiToken || '';
    const hash = createHash('sha256').update(`${token}.napcat`).digest('hex');
    const data = await this.requestNapcat<NapcatCredential>(
      runtime,
      '/api/auth/login',
      { hash },
    );
    if (!data.Credential) {
      throwVbenError('NapCat WebUI 登录失败');
    }
    this.webuiCredentials[cacheKey] = {
      credential: data.Credential,
      expiresAt: Date.now() + NAPCAT_WEBUI_CREDENTIAL_TTL_MS,
    };
    return data.Credential;
  }

  /**
   * 请求 NapCat QQ 登录状态，并在 WebUI Credential 失效时刷新一次。
   * @param runtime - 决定NapCatLogin状态内容、边界或目标的 `runtime` 值。
   * @returns NapCatLogin状态。
   * @throws 当 `!this.isNapcatCredentialRejected(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  private async requestNapcatLoginStatus(runtime: NapcatRuntime) {
    const credential = await this.getNapcatCredential(runtime);
    try {
      return await this.requestNapcat<NapcatLoginStatus>(
        runtime,
        '/api/QQLogin/CheckLoginStatus',
        {},
        credential,
      );
    } catch (err) {
      if (!this.isNapcatCredentialRejected(err)) {
        throw err;
      }
      this.clearNapcatCredential(runtime, credential);
      const refreshedCredential = await this.getNapcatCredential(runtime);
      return this.requestNapcat<NapcatLoginStatus>(
        runtime,
        '/api/QQLogin/CheckLoginStatus',
        {},
        refreshedCredential,
      );
    }
  }

  /**
   * 清理当前容器的 NapCat WebUI Credential 缓存。
   * @param runtime - NapCat runtime；`id/baseUrl/token` 决定需要失效的进程内缓存条目。
   * @param rejectedCredential - NapCat 刚拒绝的 Credential；有值时只清理仍等于它的缓存，避免旧请求删除已刷新的新缓存。
   */
  private clearNapcatCredential(
    runtime: NapcatRuntime,
    rejectedCredential?: string,
  ) {
    const cacheKey = this.getNapcatCredentialCacheKey(runtime);
    const cached = this.webuiCredentials[cacheKey];
    if (rejectedCredential && cached?.credential !== rejectedCredential) {
      return;
    }
    delete this.webuiCredentials[cacheKey];
  }

  /**
   * 判断 NapCat WebUI 是否拒绝了当前 Credential。
   * @param err - NapCat 请求异常；来源可能是 WebUI `Unauthorized` 或旧 token 失效提示。
   * @returns 为 true 时调用方可安全刷新一次 Credential 后重试状态请求。
   */
  private isNapcatCredentialRejected(err: unknown) {
    const message = this.toolsService.getErrorMessage(err);
    return /Unauthorized|token is invalid/i.test(message);
  }

  /**
   * 将容器身份与 WebUI token 组合为凭据缓存键，避免换密钥后的运行实例复用旧凭据。
   * @param runtime - NapCat 运行实例；优先用 `id` 标识容器，缺失时使用 `baseUrl`，并以 `webuiToken` 区分鉴权边界。
   * @returns 由容器身份和 token 组成的进程内凭据缓存键；缺失 token 时使用空段。
   */
  private getNapcatCredentialCacheKey(runtime: NapcatRuntime) {
    return [runtime.id || runtime.baseUrl, runtime.webuiToken || ''].join('\n');
  }

  /**
   * 将`status`、`containerOnline`、`checkedAt`转换为运行态状态快照。
   * @param status - 用于运行态状态快照的领域对象，包含 `loginError` 字段。
   * @param containerOnline - 决定运行态状态快照内容、边界或目标的 `containerOnline` 值。
   * @param checkedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 包含 `checkedAt`、`containerOnline`、`lastError`、`qqLoginMessage`、`qqLoginStatus` 字段的运行态状态快照；无法解析或未命中时为 `null`。
   */
  private toRuntimeStatusSnapshot(
    status: NapcatLoginStatus,
    containerOnline: boolean,
    checkedAt: Date,
  ): NapcatRuntimeStatusSnapshot {
    const message = this.toolsService.toTrimmedString(status.loginError);
    const qqLoginStatus = this.toQqLoginStatus(status, message);
    return {
      checkedAt,
      containerOnline,
      lastError: (() => {
        if (qqLoginStatus === 'online') {
          return null;
        }
        return message || null;
      })(),
      qqLoginMessage: (() => {
        if (qqLoginStatus === 'online') {
          return null;
        }
        return message || null;
      })(),
      qqLoginStatus,
      webuiOnline: true,
    };
  }

  /**
   * 通过 `toolsService.isNapcatExpiredQrcodeStatus` 判断输入是否满足函数约束。
   * @param status - 用于QqLogin状态的领域对象，包含 `isLogin`、`qrcodeurl`、`isOffline` 字段。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 当前状态对应的QqLogin状态，取值为 `'online'`、`'qrcode_expired'`、`'qrcode_pending'`、`'offline'`、`'unknown'`。
   */
  private toQqLoginStatus(
    status: NapcatLoginStatus,
    message: string,
  ): NapcatRuntimeLoginStatus {
    if (status.isLogin) return 'online';
    if (
      this.toolsService.isNapcatExpiredQrcodeStatus(status) ||
      message.includes('二维码已过期')
    ) {
      return 'qrcode_expired';
    }
    if (status.qrcodeurl) return 'qrcode_pending';
    if (
      status.isOffline ||
      this.toolsService.isNapcatOfflineLoginMessage(message)
    ) {
      return 'offline';
    }
    return 'unknown';
  }

  /**
   * 根据 NapCat URL 协议选择 HTTP 或 HTTPS，在有界超时内发送 JSON POST 请求，并将非 JSON、异常状态与网络失败转为稳定异常。
   * @param runtime - 用于NapCat的领域对象，包含 `baseUrl` 字段。
   * @param path - 必须保持在受控根目录内的路径。
   * @param body - 用于NapCat的结构化输入；省略时默认采用 `{}`。
   * @param credential - 决定NapCat内容、边界或目标的 `credential` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 完成初始化并携带当前边界配置的NapCat。
   */
  private requestNapcat<T>(
    runtime: NapcatRuntime,
    path: string,
    body: Record<string, any> = {},
    credential?: string,
  ): Promise<T> {
    const target = new URL(path, runtime.baseUrl);
    const payload = JSON.stringify(body);
    const client = (() => {
      if (target.protocol === 'https:') {
        return https;
      }
      return http;
    })();

    return new Promise<T>((resolve, reject) => {
      const req = client.request(
        {
          headers: {
            ...(() => {
              if (credential) {
                return {
                  Authorization: `Bearer ${credential}`,
                };
              }
              return {};
            })(),
            'Content-Length': Buffer.byteLength(payload),
            'Content-Type': 'application/json',
          },
          hostname: target.hostname,
          method: 'POST',
          path: `${target.pathname}${target.search}`,
          port: target.port,
          protocol: target.protocol,
          timeout: this.getRuntimeCheckTimeoutMs(),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let result: NapcatApiResponse<T>;
            try {
              if (raw) {
                result = JSON.parse(raw);
              } else {
                result = { code: -1 } as any;
              }
            } catch {
              reject(new Error('NapCat 返回非 JSON 响应'));
              return;
            }
            if (result.code !== 0) {
              reject(new Error(result.message || 'NapCat 请求失败'));
              return;
            }
            resolve(result.data as T);
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('NapCat 请求超时'));
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * 将`value`规范为BaseURL 地址，使等价输入得到一致表示；当 `baseUrl.endsWith('/')` 成立时返回 `baseUrl`。
   * @param value - 待转换为BaseURL 地址的原始值。
   * @returns 按参数编码并拼接完成的BaseURL 地址。
   */
  private normalizeBaseUrl(value: string) {
    const baseUrl = `${value || ''}`.trim();
    if (!baseUrl) {
      throwVbenError('NapCat WebUI 地址未配置');
    }
    if (baseUrl.endsWith('/')) {
      return baseUrl;
    }
    return `${baseUrl}/`;
  }

  /**
   * 按当前运行态读取根目录Dir；从 `getConfig` 读取根目录Dir。
   * @returns 根目录Dir。
   */
  private getRootDir() {
    return this.getConfig(
      'NAPCAT_ROOT',
      '/vol1/docker/kt-bot-adapter/napcat-instances',
    ).replace(/\/+$/, '');
  }

  /**
   * 根据当前运行态与当前约束判定托管模式Mode；从 `getManagedMode` 读取托管模式Mode。
   * @returns 满足托管模式Mode约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isManagedMode() {
    return !!this.getManagedMode();
  }

  /**
   * 按当前运行态读取托管模式Mode；从 `getConfig` 读取托管模式Mode。
   * @returns 托管模式Mode。
   */
  private getManagedMode() {
    return this.getConfig('NAPCAT_CONTAINER_MODE', '').toLowerCase();
  }

  /**
   * 按当前运行态读取SSH启动参数；从 `getConfig` 读取SSH启动参数。
   * @returns SSH启动参数。
   */
  private getSshArgs() {
    const target = this.getConfig('NAPCAT_SSH_TARGET', 'nas');
    if (!target) {
      throwVbenError('NapCat SSH 目标未配置');
    }

    const args: string[] = [
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'UserKnownHostsFile=/tmp/napcat-known-hosts',
    ];
    const port = this.getConfig('NAPCAT_SSH_PORT', '');
    const keyPath = this.getConfig('NAPCAT_SSH_KEY_PATH', '');
    if (port) args.push('-p', port);
    if (keyPath) args.push('-i', keyPath);
    args.push(target);
    return args;
  }

  /**
   * 按`key`、`defaultValue`读取配置；从 `configService.get` 读取配置。
   * @param key - 用于读取或更新配置的稳定键。
   * @param defaultValue - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
   * @returns 配置。
   */
  private getConfig(key: string, defaultValue = '') {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }

  /**
   * 按当前运行态读取子进程超时Ms；当 `Number.isFinite(timeoutMs) && timeoutMs > 0` 成立时返回 `timeoutMs`。
   * @returns 当前状态对应的子进程超时Ms，取值为 `120000`。
   */
  private getProcessTimeoutMs() {
    const timeoutMs = Number(this.getConfig('NAPCAT_SSH_TIMEOUT_MS', '120000'));
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      return timeoutMs;
    }
    return 120000;
  }

  /**
   * 按当前运行态读取运行态超时Ms；当 `Number.isFinite(timeoutMs) && timeoutMs > 0` 成立时返回 `timeoutMs`。
   * @returns 当前状态对应的运行态超时Ms，取值为 `5000`。
   */
  private getRuntimeCheckTimeoutMs() {
    const timeoutMs = Number(
      this.getConfig('NAPCAT_RUNTIME_CHECK_TIMEOUT_MS', '5000'),
    );
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      return timeoutMs;
    }
    return 5000;
  }

  /**
   * 通过 `Math.max` 收敛数值边界。
   * @returns 验证码日志超时Ms。
   */
  private getCaptchaLogReadTimeoutMs() {
    return Math.max(this.getRuntimeCheckTimeoutMs(), 15000);
  }

  /**
   * 把脚本参数中的单引号转义并包裹为安全的 Shell 单词，避免内容改变命令结构。
   * @param value - 参与把脚本参数中的单引号转义并包裹为安全的 Shell 单词，避免内容改变命令结构比较、格式化或输出的候选值。
   * @returns 按参数编码并拼接完成的sh。
   */
  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }

  /**
   * 在可选标准输入与超时边界内执行子进程，并收集退出码、标准输出和标准错误。
   * @param command - 决定子进程内容、边界或目标的 `command` 值。
   * @param args - 决定子进程内容、边界或目标的 `args` 值。
   * @param input - 用于子进程的结构化输入。
   * @param onStdoutLine - 决定子进程内容、边界或目标的 `onStdoutLine` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param timeoutMs - 用于子进程超时、有效期或退避计算的毫秒数；省略时默认采用 `this.getProcessTimeoutMs()`。
   * @returns 完成初始化并携带当前边界配置的子进程。
   */
  private runProcess(
    command: string,
    args: string[],
    input: string,
    onStdoutLine?: (line: string) => void,
    timeoutMs = this.getProcessTimeoutMs(),
  ) {
    return new Promise<{ stderr: string; stdout: string }>(
      (resolve, reject) => {
        const child = spawn(command, args, {
          windowsHide: true,
        });
        let settled = false;
        let stdout = '';
        let stderr = '';
        let stdoutLineBuffer = '';
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill('SIGTERM');
          reject(new Error(`${command} timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback();
        };
        child.stdout.on('data', (chunk) => {
          const text = Buffer.from(chunk).toString('utf8');
          stdout += text;
          if (onStdoutLine) {
            const lines = `${stdoutLineBuffer}${text}`.split(/\r?\n/);
            stdoutLineBuffer = lines.pop() || '';
            lines
              .map((line) => line.trim())
              .filter(Boolean)
              .forEach((line) => onStdoutLine(line));
          }
        });
        child.stderr.on('data', (chunk) => {
          stderr += Buffer.from(chunk).toString('utf8');
        });
        child.on('error', (err) => {
          finish(() => reject(err));
        });
        child.on('close', (code) => {
          finish(() => {
            if (onStdoutLine && stdoutLineBuffer.trim()) {
              onStdoutLine(stdoutLineBuffer.trim());
            }
            if (code === 0) {
              resolve({ stderr, stdout });
              return;
            }
            reject(new Error((stderr || stdout || `${command} failed`).trim()));
          });
        });
        child.stdin.write(input);
        child.stdin.end();
      },
    );
  }
}
