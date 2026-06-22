import * as http from 'http';
import * as https from 'https';
import { spawn } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { NapcatConfigWriterService } from '../../../application/runtime/napcat-config-writer.service';
import { NapcatRuntimeProfileService } from '../../../application/runtime/napcat-runtime-profile.service';
import type { NapcatConfigFile } from '../../../domain/runtime/napcat-profile.types';
import {
  toNapcatDockerDeviceOptions,
  type NapcatDockerDeviceOptions,
} from './napcat-docker-device-options';
import { NapcatDeviceIdentityService } from '../device/napcat-device-identity.service';
import { QqbotAccount } from '@/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';
import { NapcatAccountBinding } from '../../persistence/napcat-account-binding.entity';
import { NapcatContainer } from '../../persistence/napcat-container.entity';
import type {
  NapcatApiResponse,
  NapcatCredential,
  NapcatLoginStatus,
  QqbotNapcatRuntime,
  QqbotNapcatRuntimeLoginStatus,
  QqbotNapcatRuntimeStatusSnapshot,
} from '@/modules/qqbot/core/contract/qqbot.types';

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

@Injectable()
export class QqbotNapcatContainerService {
  private readonly configWriterService: NapcatConfigWriterService;

  private readonly runtimeProfileService: NapcatRuntimeProfileService;

  /**
   * 初始化 QqbotNapcatContainerService 实例。
   * @param configService - Runtime configuration source for NAS SSH, Docker image, port pool, and profile defaults.
   * @param containerRepository - Persistence adapter for NapCat container rows created or updated by runtime actions.
   * @param bindingRepository - Persistence adapter that links QQBot accounts to their primary NapCat containers.
   * @param toolsService - Shared helper for error extraction, text truncation, and bounded sleeps.
   * @param deviceIdentityService - Device identity resolver that supplies stable hostname, MAC, data-dir, and machine-id values.
   * @param runtimeProfileService - Runtime profile resolver used to generate Docker env and mount settings.
   * @param configWriterService - Config writer used to generate NapCat and OneBot config files.
   */
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
   * 执行 NapCat 登录运行态流程。
   */
  async prepareCreateContainer() {
    if (!this.isManagedMode()) {
      return this.getLegacyRuntime();
    }

    return this.createManagedContainer();
  }

  /**
   * 为账号更新登录准备 NapCat 容器。
   * @param account - QQBot 账号；提供主绑定容器查询条件和创建期 ACCOUNT env。
   * @param loginPassword - 已保存的 QQ 登录密码明文；仅在新建或 Docker 离线重建容器时注入创建期 env。
   * @returns 可用于登录流程的 NapCat 运行态，携带源 Docker 容器是否在线的门禁证据。
   */
  async prepareAccountContainer(account: QqbotAccount, loginPassword?: string) {
    if (!this.isManagedMode()) {
      return this.getLegacyRuntime();
    }

    const existing = await this.getPrimaryRuntime(account.id);
    if (existing) {
      const sourceContainerOnline = existing.sourceContainerOnline !== false;
      const quickLoginEnv = sourceContainerOnline
        ? { changed: false, ok: true }
        : await this.ensureRuntimeLoginEnv(existing, {
            loginPassword,
            selfId: account.selfId,
          });
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
        runtimeRebuildCount: quickLoginEnv.changed ? 1 : 0,
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
   * 让已绑定账号的容器带上 ACCOUNT 环境变量（NapCat 的 -q 快速登录）。
   * 仅在 ssh 托管模式下原地重建容器：保留 QQ 数据卷，因此随后的容器重启
   * 能从持久化会话免扫码自动重登。硬踢（登录已失效）时会话作废，仍需扫码。
   */
  async ensureRuntimeQuickLogin(runtime: QqbotNapcatRuntime, selfId?: string) {
    return this.ensureRuntimeLoginEnv(runtime, { selfId });
  }

  /**
   * 确保Runtime Login Env。
   * @param runtime - runtime 输入；使用 `id` 字段生成结果。
   * @param options - NapCat列表；使用 `selfId`、`clearLoginPassword`、`loginPassword` 字段生成结果。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
  async ensureRuntimeLoginEnv(
    runtime: QqbotNapcatRuntime,
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
        loginPassword: options.clearLoginPassword
          ? undefined
          : this.toolsService.toSecretText(options.loginPassword),
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
          lastError: verified ? null : 'NapCat 运行态登录环境校验失败',
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
    runtime: QqbotNapcatRuntime,
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
   * 解析Runtime Device Identity。
   * @param container - container 输入；使用 `id` 字段生成结果。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @returns NapCat 登录运行态转换后的值。
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
   * Resolves the device identity id that belongs to an account/container binding.
   * @param accountId - Internal QQBot account id used to select the persistent device identity.
   * @param containerId - Managed NapCat container id that should be stored on the identity row.
   * @returns Device identity id when the identity service is available.
   */
  private async resolveBindingDeviceIdentityId(
    accountId: string,
    containerId: string,
  ) {
    if (!this.deviceIdentityService) return undefined;
    const identity = await this.deviceIdentityService.resolveForAccount({
      accountId,
      containerId,
    });
    return identity.id;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param name - 名称文本；驱动 `this.runProcess()` 的 NapCat步骤。
   * @param options - NapCat列表；使用 `selfId`、`clearLoginPassword`、`loginPassword` 字段生成结果。
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
   * 创建 NapCat 登录运行态对象或配置。
   * @param name - 名称文本；驱动 `this.sh()` 的 NapCat步骤。
   */
  private buildRemoteInspectEnvScript(name: string) {
    return `
set -eu
NAME=${this.sh(name)}
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$NAME"
`;
  }

  /**
   * 解析Docker Env。
   * @param stdout - stdout 输入；影响 parseDockerEnv 的返回值。
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
   * 查询 NapCat 登录运行态数据。
   * @param containerId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
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
   * 执行 NapCat 登录运行态流程。
   * @param accountId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param containerId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  async bindAccount(accountId: string, containerId?: string) {
    if (!containerId) return;

    await this.bindingRepository.update(
      { accountId, isDeleted: false },
      { isPrimary: false },
    );
    const deviceIdentityId = await this.resolveBindingDeviceIdentityId(
      accountId,
      containerId,
    );
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
          ...(deviceIdentityId ? { deviceIdentityId } : {}),
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
        ...(deviceIdentityId ? { deviceIdentityId } : {}),
        isPrimary: true,
        lastLoginAt: new Date(),
        remark: '',
      }),
    );
    await this.removeOtherAccountContainers(accountId, containerId);
  }

  /**
   * 清理 NapCat 登录运行态状态。
   * @param accountId - 账号 ID；定位本次读取、更新、删除或关联的账号。
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
   * 清理 NapCat 登录运行态状态。
   * @param containerId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
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

    return this.removeContainer(containerId);
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param runtime - runtime 输入；使用 `id`、`name` 字段生成结果。
   */
  async restartRuntimeContainer(runtime: QqbotNapcatRuntime) {
    if (this.getManagedMode() !== 'ssh' || !runtime.id || !runtime.name) {
      return false;
    }

    await this.runProcess(
      'ssh',
      [...this.getSshArgs(), 'docker', 'restart', runtime.name],
      '',
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
   * Starts an existing managed NapCat container without rebuilding or restarting it.
   * @param runtime - Persisted runtime row whose Docker name and id identify the stopped container to start.
   * @returns True when the Docker start command was issued and the persisted row was marked running.
   */
  private async startRuntimeContainer(runtime: QqbotNapcatRuntime) {
    if (this.getManagedMode() !== 'ssh' || !runtime.id || !runtime.name) {
      return false;
    }

    await this.runProcess(
      'ssh',
      [...this.getSshArgs(), 'docker', 'start', runtime.name],
      '',
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
   * 重置Runtime Login State。
   * @param runtime - runtime 输入；使用 `id`、`name` 字段生成结果。
   * @param onProgress - NapCat列表；影响 resetRuntimeLoginState 的返回值。
   */
  async resetRuntimeLoginState(
    runtime: QqbotNapcatRuntime,
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
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；使用 `name`、`id` 字段生成结果。
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
          ...(loginState.state === 'offline'
            ? {
                lastError: loginState.offlineReason
                  ? this.toolsService.toColumnText(
                      loginState.offlineReason,
                      500,
                    )
                  : null,
              }
            : {}),
          ...(loginState.state === 'online' ? { lastError: null } : {}),
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
   * 执行 NapCat 登录运行态流程。
   * @param runtime - runtime 输入；使用 `name` 字段生成结果。
   * @param sinceMs - NapCat列表；驱动 `Number.isFinite()` 的 NapCat步骤。
   */
  async detectRuntimeCaptchaUrl(
    runtime: Pick<QqbotNapcatRuntime, 'name'>,
    sinceMs?: number,
  ) {
    if (this.getManagedMode() !== 'ssh' || !runtime.name) return null;

    const since =
      typeof sinceMs === 'number' && Number.isFinite(sinceMs)
        ? new Date(Math.max(0, sinceMs - 1000)).toISOString()
        : '';
    const script = since
      ? this.buildRemoteRecentLogsSinceScript(runtime.name, since)
      : this.buildRemoteRecentLogsByNameScript(runtime.name);

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
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；使用 `status`、`lastError`、`baseUrl`、`webuiToken` 字段生成结果。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
  async inspectRuntimeStatus(
    container: NapcatContainer,
  ): Promise<QqbotNapcatRuntimeStatusSnapshot> {
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
      const credential = await this.getNapcatCredential(runtime);
      const status = await this.requestNapcat<NapcatLoginStatus>(
        runtime,
        '/api/QQLogin/CheckLoginStatus',
        {},
        credential,
      );
      const snapshot = this.toRuntimeStatusSnapshot(
        status,
        containerOnline,
        checkedAt,
      );
      await this.containerRepository.update(
        { id: container.id },
        {
          lastCheckedAt: checkedAt,
          lastError:
            snapshot.qqLoginStatus === 'online'
              ? null
              : this.toolsService.toColumnText(
                  snapshot.qqLoginMessage || snapshot.lastError || '',
                  500,
                ) || null,
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
   * 清理 NapCat 登录运行态状态。
   * @param containerId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
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
   * 清理 NapCat 登录运行态状态。
   * @param accountId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param keepContainerId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
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
   * 清理 NapCat 登录运行态状态。
   * @param container - container 输入；驱动 `this.buildRemoteRemoveScript()` 的 NapCat步骤。
   */
  private async removeRemoteDockerContainer(container: NapcatContainer) {
    const script = this.buildRemoteRemoveScript(container);
    await this.runProcess('ssh', [...this.getSshArgs(), 'sh -s'], script);
  }

  /**
   * 创建 NapCat 登录运行态对象或配置。
   * @param container - container 输入；使用 `dataDir`、`name` 字段生成结果。
   */
  private buildRemoteRemoveScript(container: NapcatContainer) {
    const dataDir = this.sh(container.dataDir || '');
    const name = this.sh(container.name);
    const rootDir = this.sh(this.getRootDir());

    return `
set -eu
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
   * 创建 NapCat 登录运行态对象或配置。
   * @param container - container 输入；使用 `dataDir`、`name` 字段生成结果。
   */
  private buildRemoteResetLoginStateScript(container: NapcatContainer) {
    const dataDir = this.sh(container.dataDir || '');
    const name = this.sh(container.name);
    const rootDir = this.sh(this.getRootDir());

    return `
set -eu
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
   * 创建 NapCat 登录运行态对象或配置。
   * @param container - container 输入；使用 `name` 字段生成结果。
   */
  private buildRemoteRecentLogsScript(container: NapcatContainer) {
    return this.buildRemoteRecentLogsByNameScript(container.name);
  }

  /**
   * 创建 NapCat 登录运行态对象或配置。
   * @param name - 名称文本；驱动 `this.sh()` 的 NapCat步骤。
   */
  private buildRemoteRecentLogsByNameScript(name: string) {
    return `
set -eu
NAME=${this.sh(name)}
docker logs --tail 300 "$NAME" 2>&1 || true
`;
  }

  /**
   * 创建 NapCat 登录运行态对象或配置。
   * @param name - 名称文本；驱动 `this.sh()` 的 NapCat步骤。
   * @param since - since 输入；驱动 `this.sh()` 的 NapCat步骤。
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
   * 执行 NapCat 登录运行态流程。
   * @param logs - NapCat列表；影响 extractLoginState 的返回值。
   * @returns NapCat 登录运行态产出的 NapcatLoginLogResult。
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
    const offlineReason = this.toolsService.isNapcatOfflineFlagMessage(
      matchedLine,
    )
      ? 'NapCat 账号状态变更为离线'
      : message || 'NapCat 账号状态变更为离线';

    return {
      offlineReason,
      state: 'offline',
    };
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param accountId - 账号 ID；定位本次读取、更新、删除或关联的账号。
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
    return container ? this.toRuntime(container) : null;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param containerId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
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
   * 创建 NapCat 登录运行态对象或配置。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param loginPassword - loginPassword 输入；生成 NapCat对象。
   * @param accountId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  private async createManagedContainer(
    selfId?: string,
    loginPassword?: string,
    accountId?: string,
  ) {
    const mode = this.getManagedMode();
    if (mode !== 'ssh') {
      throwVbenError('当前仅支持通过 SSH 创建 NapCat 容器');
    }

    const image = this.getConfig('QQBOT_NAPCAT_IMAGE');
    if (!image) {
      throwVbenError('NapCat 镜像未配置，请先设置 QQBOT_NAPCAT_IMAGE');
    }
    const port = await this.allocatePort();
    const name = this.buildContainerName(selfId);
    const token = randomBytes(24).toString('hex');
    let dataDir = `${this.getRootDir()}/${name}`;
    let deviceIdentity: NapcatDockerDeviceOptions | undefined;
    if (accountId && this.deviceIdentityService) {
      const identity = await this.deviceIdentityService.resolveForAccount({
        accountId,
        selfId,
      });
      dataDir = identity.dataDir || dataDir;
      deviceIdentity = toNapcatDockerDeviceOptions(identity);
    }
    const baseUrl = this.buildBaseUrl(port);
    const reverseWsUrl = this.buildReverseWsUrl();

    const container = await this.containerRepository.save(
      this.containerRepository.create({
        baseUrl,
        accountId: accountId || null,
        dataDir,
        image,
        isDeleted: false,
        lastError: null,
        name,
        remark: '',
        reverseWsUrl,
        status: 'creating',
        webuiPort: port,
        webuiToken: token,
      }),
    );

    try {
      await this.createRemoteDockerContainer({
        account: selfId,
        accountId,
        containerId: container.id,
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
        { id: container.id },
        {
          lastError: null,
          lastStartedAt: new Date(),
          status: 'running',
        },
      );
      if (accountId && this.deviceIdentityService) {
        const identity = await this.deviceIdentityService.resolveForAccount({
          accountId,
          containerId: container.id,
          selfId,
        });
        await this.bindingRepository.update(
          { accountId, containerId: container.id, isDeleted: false },
          { deviceIdentityId: identity.id },
        );
      }
      return {
        baseUrl,
        dataDir,
        id: container.id,
        name,
        webuiPort: port,
        webuiToken: token,
      };
    } catch (err) {
      const message = this.toolsService.getErrorMessage(err);
      await this.containerRepository.update(
        { id: container.id },
        {
          lastError: this.toolsService.toColumnText(message, 500),
          status: 'error',
        },
      );
      throwVbenError(`创建 NapCat 容器失败：${message}`);
    }
  }

  /**
   * 创建 NapCat 登录运行态对象或配置。
   * @param input - input 输入；驱动 `this.buildRemoteCreateScript()` 的 NapCat步骤。
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
   * Builds the remote shell script that creates or recreates a managed NapCat container.
   * @param input - Container image, account, data-dir, device identity, and reverse-WS values that become Docker flags and config files.
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
    const accountHeader = account ? `ACCOUNT=${this.sh(account)}\n` : '';
    const accountRunFlag = account ? '  -e ACCOUNT="$ACCOUNT" \\\n' : '';
    const passwordHeader = loginPassword
      ? `NAPCAT_QUICK_PASSWORD=${this.sh(loginPassword)}\n`
      : '';
    const passwordRunFlag = loginPassword
      ? '  -e NAPCAT_QUICK_PASSWORD="$NAPCAT_QUICK_PASSWORD" \\\n'
      : '';
    const pullCmd = input.skipPull ? '' : 'docker pull "$IMAGE" >/dev/null\n';
    const deviceHeader = input.deviceIdentity
      ? [
          `NAPCAT_HOSTNAME=${this.sh(input.deviceIdentity.hostname)}`,
          `NAPCAT_MAC_ADDRESS=${this.sh(input.deviceIdentity.macAddress)}`,
          `NAPCAT_MAC_HYPHEN=${this.sh(input.deviceIdentity.macAddressHyphen)}`,
          `MACHINE_ID_PATH=${this.sh(input.deviceIdentity.machineIdPath)}`,
          `MACHINE_INFO_PATH=${this.sh(input.deviceIdentity.machineInfoPath)}`,
          `DEVICE_ENV_PATH=${this.sh(input.deviceIdentity.deviceEnvPath)}`,
        ].join('\n') + '\n'
      : '';
    const devicePrepareScript = input.deviceIdentity
      ? `
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
`
      : '';
    const deviceRunFlags = input.deviceIdentity
      ? '  --hostname "$NAPCAT_HOSTNAME" \\\n  --mac-address "$NAPCAT_MAC_ADDRESS" \\\n  -v "$MACHINE_ID_PATH:/etc/machine-id:ro" \\\n'
      : '';

    return `
set -eu
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
mkdir -p "$DATA_DIR/QQ" "$DATA_DIR/config" "$DATA_DIR/plugins" "$DATA_DIR/logs" "$DATA_DIR/cache" "$DATA_DIR/local-share" "$DATA_DIR/runtime"
chmod 700 "$DATA_DIR"
chmod 700 "$DATA_DIR/runtime"
${devicePrepareScript}

${configWriteScript}

${pullCmd}docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d \\
  --name "$NAME" \\
  --restart unless-stopped \\
  --init \\
  --shm-size "$NAPCAT_SHM_SIZE" \\
  -e NAPCAT_UID="$NAPCAT_UID" \\
  -e NAPCAT_GID="$NAPCAT_GID" \\
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
   * Records the expected runtime and protocol state for a successfully created managed container.
   * @param input - Docker creation request whose identity and config values define the planned profile.
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
   * Renders NapCat config files as shell here-doc writes under the account config directory.
   * @param files - Config files generated by `NapcatConfigWriterService` for this container.
   * @returns Shell fragment that writes each config file before Docker starts.
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
   * 执行 NapCat 登录运行态流程。
   */
  private async allocatePort() {
    const start = Number(this.getConfig('QQBOT_NAPCAT_PORT_START', '6100'));
    const end = Number(this.getConfig('QQBOT_NAPCAT_PORT_END', '6199'));
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
   * 创建 NapCat 登录运行态对象或配置。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  private buildContainerName(selfId?: string) {
    const prefix = this.getConfig(
      'QQBOT_NAPCAT_CONTAINER_PREFIX',
      'kt-qqbot-napcat',
    );
    const suffix = `${selfId || randomUUID().slice(0, 8)}`
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
      .toLowerCase();
    return `${prefix}-${suffix}`.replace(/-+/g, '-').slice(0, 120);
  }

  /**
   * 创建 NapCat 登录运行态对象或配置。
   * @param port - port 输入；生成 NapCat对象。
   */
  private buildBaseUrl(port: number) {
    const template = this.getConfig('QQBOT_NAPCAT_BASE_URL_TEMPLATE', '');
    if (template) {
      return template.replace('{port}', `${port}`);
    }

    const host = this.getConfig('QQBOT_NAPCAT_HOST', '127.0.0.1');
    return `http://${host}:${port}`;
  }

  /**
   * 创建 NapCat 登录运行态对象或配置。
   */
  private buildReverseWsUrl() {
    const configured =
      this.getConfig('QQBOT_NAPCAT_REVERSE_WS_URL', '') ||
      this.getConfig('QQBOT_NAPCAT_REVERSE_WS_BASE', '');
    const path = this.getConfig(
      'QQBOT_REVERSE_WS_PATH',
      '/qqbot/onebot/reverse',
    );
    const base = configured || `ws://127.0.0.1:48085${path}`;
    const token = this.getConfig('QQBOT_REVERSE_WS_TOKEN', '');
    if (!token || base.includes('token=')) return base;
    const joiner = base.includes('?') ? '&' : '?';
    return `${base}${joiner}token=${encodeURIComponent(token)}`;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @returns NapCat 登录运行态查询结果。
   */
  private getLegacyRuntime(): QqbotNapcatRuntime {
    return {
      baseUrl: this.normalizeBaseUrl(
        this.getConfig('NAPCAT_WEBUI_BASE_URL', '') ||
          this.getConfig('QQBOT_NAPCAT_WEBUI_URL', ''),
      ),
      name: 'kt-qqbot-napcat',
      webuiToken:
        this.getConfig('NAPCAT_WEBUI_TOKEN', '') ||
        this.getConfig('QQBOT_NAPCAT_WEBUI_TOKEN', ''),
    };
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；使用 `baseUrl`、`id`、`name`、`webuiPort` 字段生成结果。
   * @returns NapCat 登录运行态产出的 QqbotNapcatRuntime。
   */
  private toRuntime(container: NapcatContainer): QqbotNapcatRuntime {
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
   * 查询 NapCat 登录运行态数据。
   * @param runtime - runtime 输入；使用 `webuiToken` 字段生成结果。
   */
  private async getNapcatCredential(runtime: QqbotNapcatRuntime) {
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
    return data.Credential;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param status - NapCat列表；使用 `loginError` 字段生成结果。
   * @param containerOnline - containerOnline 输入；影响 toRuntimeStatusSnapshot 的返回值。
   * @param checkedAt - checkedAt 输入；影响 toRuntimeStatusSnapshot 的返回值。
   * @returns NapCat 登录运行态产出的 QqbotNapcatRuntimeStatusSnapshot。
   */
  private toRuntimeStatusSnapshot(
    status: NapcatLoginStatus,
    containerOnline: boolean,
    checkedAt: Date,
  ): QqbotNapcatRuntimeStatusSnapshot {
    const message = this.toolsService.toTrimmedString(status.loginError);
    const qqLoginStatus = this.toQqLoginStatus(status, message);
    return {
      checkedAt,
      containerOnline,
      lastError: qqLoginStatus === 'online' ? null : message || null,
      qqLoginMessage: qqLoginStatus === 'online' ? null : message || null,
      qqLoginStatus,
      webuiOnline: true,
    };
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param status - NapCat列表；使用 `isLogin`、`qrcodeurl`、`isOffline` 字段生成结果。
   * @param message - message 输入；计算 NapCat布尔判断。
   * @returns NapCat 登录运行态产出的 QqbotNapcatRuntimeLoginStatus。
   */
  private toQqLoginStatus(
    status: NapcatLoginStatus,
    message: string,
  ): QqbotNapcatRuntimeLoginStatus {
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
   * 执行 NapCat 登录运行态流程。
   * @param runtime - runtime 输入；使用 `baseUrl` 字段生成结果。
   * @param path - 路由或文件路径；驱动 `URL()` 的 NapCat步骤。
   * @param body - 请求体 DTO；承载 NapCat新增、更新、导入或执行字段。
   * @param credential - credential 输入；影响 requestNapcat 的返回值。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
  private requestNapcat<T>(
    runtime: QqbotNapcatRuntime,
    path: string,
    body: Record<string, any> = {},
    credential?: string,
  ): Promise<T> {
    const target = new URL(path, runtime.baseUrl);
    const payload = JSON.stringify(body);
    const client = target.protocol === 'https:' ? https : http;

    return new Promise<T>((resolve, reject) => {
      const req = client.request(
        {
          headers: {
            ...(credential
              ? {
                  Authorization: `Bearer ${credential}`,
                }
              : {}),
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
              result = raw ? JSON.parse(raw) : ({ code: -1 } as any);
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
   * 转换 NapCat 登录运行态输入。
   * @param value - 待转换值；影响 normalizeBaseUrl 的返回值。
   */
  private normalizeBaseUrl(value: string) {
    const baseUrl = `${value || ''}`.trim();
    if (!baseUrl) {
      throwVbenError('NapCat WebUI 地址未配置');
    }
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getRootDir() {
    return this.getConfig(
      'QQBOT_NAPCAT_ROOT',
      '/vol1/docker/kt-qqbot/napcat-instances',
    ).replace(/\/+$/, '');
  }

  /**
   * 判断 NapCat 登录运行态条件。
   */
  private isManagedMode() {
    return !!this.getManagedMode();
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getManagedMode() {
    return this.getConfig('QQBOT_NAPCAT_CONTAINER_MODE', '').toLowerCase();
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getSshArgs() {
    const target = this.getConfig('QQBOT_NAPCAT_SSH_TARGET', 'nas');
    if (!target) {
      throwVbenError('NapCat SSH 目标未配置');
    }

    const args: string[] = [
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'UserKnownHostsFile=/tmp/qqbot-napcat-known-hosts',
    ];
    const port = this.getConfig('QQBOT_NAPCAT_SSH_PORT', '');
    const keyPath = this.getConfig('QQBOT_NAPCAT_SSH_KEY_PATH', '');
    if (port) args.push('-p', port);
    if (keyPath) args.push('-i', keyPath);
    args.push(target);
    return args;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param key - 键名；限定 NapCat查询范围。
   * @param defaultValue - defaultValue 输入；限定 NapCat查询范围。
   */
  private getConfig(key: string, defaultValue = '') {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getProcessTimeoutMs() {
    const timeoutMs = Number(
      this.getConfig('QQBOT_NAPCAT_SSH_TIMEOUT_MS', '120000'),
    );
    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getRuntimeCheckTimeoutMs() {
    const timeoutMs = Number(
      this.getConfig('QQBOT_NAPCAT_RUNTIME_CHECK_TIMEOUT_MS', '5000'),
    );
    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getCaptchaLogReadTimeoutMs() {
    return Math.max(this.getRuntimeCheckTimeoutMs(), 15000);
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param value - 待转换值；影响 sh 的返回值。
   */
  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }

  /**
   * 执行Process。
   * @param command - command 输入；驱动 `spawn()` 的 NapCat步骤。
   * @param args - NapCat列表；驱动 `spawn()` 的 NapCat步骤。
   * @param input - input 输入；驱动 `stdin.write()` 的 NapCat步骤。
   * @param onStdoutLine - onStdoutLine 输入；驱动 `map()` 的 NapCat步骤。
   * @param timeoutMs - NapCat列表；影响 runProcess 的返回值。
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
        /**
         * 收束 NapCat 登录运行态异步流程。
         * @param callback - callback 输入；影响 finish 的返回值。
         */
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
