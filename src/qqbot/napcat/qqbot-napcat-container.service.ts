import * as http from 'http';
import * as https from 'https';
import { spawn } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import {
  NapcatDeviceIdentityService,
  toNapcatDockerDeviceOptions,
  type NapcatDockerDeviceOptions,
} from '@/modules/qqbot/napcat';
import { QqbotAccount } from '../account/qqbot-account.entity';
import { QqbotAccountNapcat } from './qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from './qqbot-napcat-container.entity';
import type {
  NapcatApiResponse,
  NapcatCredential,
  NapcatLoginStatus,
  QqbotNapcatRuntime,
  QqbotNapcatRuntimeLoginStatus,
  QqbotNapcatRuntimeStatusSnapshot,
} from '../qqbot.types';

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

type NapcatAutoLoginResult = {
  cleanupFailed?: boolean;
  method?: 'password' | 'quick';
  success: boolean;
};

@Injectable()
export class QqbotNapcatContainerService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(QqbotNapcatContainer)
    private readonly containerRepository: Repository<QqbotNapcatContainer>,
    @InjectRepository(QqbotAccountNapcat)
    private readonly bindingRepository: Repository<QqbotAccountNapcat>,
    private readonly toolsService: ToolsService,
    private readonly deviceIdentityService?: NapcatDeviceIdentityService,
  ) {}

  async prepareCreateContainer() {
    if (!this.isManagedMode()) {
      return this.getLegacyRuntime();
    }

    return this.createManagedContainer();
  }

  async prepareAccountContainer(account: QqbotAccount) {
    if (!this.isManagedMode()) {
      return this.getLegacyRuntime();
    }

    const existing = await this.getPrimaryRuntime(account.id);
    if (existing) {
      await this.ensureRuntimeQuickLogin(existing, account.selfId);
      return { ...existing, hasExistingPrimaryBinding: true };
    }

    const created = await this.createManagedContainer(
      account.selfId,
      undefined,
      account.id,
    );
    return { ...created, hasExistingPrimaryBinding: false };
  }

  /**
   * 让已绑定账号的容器带上 ACCOUNT 环境变量（NapCat 的 -q 快速登录）。
   * 仅在 ssh 托管模式下原地重建容器：保留 QQ 数据卷，因此随后的容器重启
   * 能从持久化会话免扫码自动重登。硬踢（登录已失效）时会话作废，仍需扫码。
   */
  async ensureRuntimeQuickLogin(runtime: QqbotNapcatRuntime, selfId?: string) {
    return this.ensureRuntimeLoginEnv(runtime, { selfId });
  }

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
      await this.createRemoteDockerContainer({
        account,
        dataDir: container.dataDir || `${this.getRootDir()}/${container.name}`,
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

  async tryAutoLogin(
    container: QqbotNapcatContainer,
    options: NapcatLoginEnvOptions,
  ): Promise<NapcatAutoLoginResult> {
    const selfId = this.toolsService.toTrimmedString(options.selfId);
    if (!selfId || this.getManagedMode() !== 'ssh' || !container.id) {
      return { success: false };
    }

    const runtimeContainer = await this.findContainerWithToken(container.id);
    if (!runtimeContainer?.name) return { success: false };
    const runtime = this.toRuntime(runtimeContainer);

    const quickCleanup = await this.ensureRuntimeLoginEnv(runtime, {
      clearLoginPassword: true,
      selfId,
    });
    if (!quickCleanup.ok) return { cleanupFailed: true, success: false };

    const quickState = await this.restartAndDetectLoginState(runtime);
    if (quickState.state === 'online') {
      return { method: 'quick', success: true };
    }

    const loginPassword = this.toolsService.toSecretText(options.loginPassword);
    if (!loginPassword) return { success: false };

    const passwordEnv = await this.ensureRuntimeLoginEnv(runtime, {
      loginPassword,
      selfId,
    });
    if (!passwordEnv.ok) return { success: false };

    const passwordState = await this.restartAndDetectLoginState(runtime);
    if (passwordState.state !== 'online') {
      const cleaned = await this.ensureRuntimeLoginEnv(runtime, {
        clearLoginPassword: true,
        selfId,
      });
      return cleaned.ok
        ? { success: false }
        : { cleanupFailed: true, success: false };
    }

    const cleaned = await this.ensureRuntimeLoginEnv(runtime, {
      clearLoginPassword: true,
      selfId,
    });
    if (!cleaned.ok) return { cleanupFailed: true, success: false };

    return { method: 'password', success: true };
  }

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

  private buildRemoteInspectEnvScript(name: string) {
    return `
set -eu
NAME=${this.sh(name)}
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$NAME"
`;
  }

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

  async bindAccount(accountId: string, containerId?: string) {
    if (!containerId) return;

    await this.bindingRepository.update(
      { accountId, isDeleted: false },
      { isPrimary: false },
    );

    const existing = await this.bindingRepository.findOne({
      where: {
        accountId,
        containerId,
        isDeleted: false,
      },
    });
    if (existing) {
      await this.bindingRepository.update(
        { id: existing.id },
        {
          bindStatus: 'bound',
          isPrimary: true,
          lastLoginAt: new Date(),
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
        isPrimary: true,
        lastLoginAt: new Date(),
        remark: '',
      }),
    );
    await this.removeOtherAccountContainers(accountId, containerId);
  }

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

  async detectRuntimeOffline(container: QqbotNapcatContainer) {
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

  async inspectRuntimeStatus(
    container: QqbotNapcatContainer,
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

  private async removeRemoteDockerContainer(container: QqbotNapcatContainer) {
    const script = this.buildRemoteRemoveScript(container);
    await this.runProcess('ssh', [...this.getSshArgs(), 'sh -s'], script);
  }

  private buildRemoteRemoveScript(container: QqbotNapcatContainer) {
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

  private buildRemoteResetLoginStateScript(container: QqbotNapcatContainer) {
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

  private buildRemoteRecentLogsScript(container: QqbotNapcatContainer) {
    return this.buildRemoteRecentLogsByNameScript(container.name);
  }

  private buildRemoteRecentLogsByNameScript(name: string) {
    return `
set -eu
NAME=${this.sh(name)}
docker logs --tail 300 "$NAME" 2>&1 || true
`;
  }

  private buildRemoteRecentLogsSinceScript(name: string, since: string) {
    return `
set -eu
NAME=${this.sh(name)}
SINCE=${this.sh(since)}
docker logs --since "$SINCE" --tail 300 "$NAME" 2>&1 || true
`;
  }

  private async restartAndDetectLoginState(runtime: QqbotNapcatRuntime) {
    const since = new Date(Date.now() - 1000).toISOString();
    await this.restartRuntimeContainer(runtime);
    const attempts = Number(
      this.getConfig('QQBOT_NAPCAT_AUTO_LOGIN_RETRIES', '10'),
    );
    const delayMs = Number(
      this.getConfig('QQBOT_NAPCAT_AUTO_LOGIN_INTERVAL_MS', '2000'),
    );
    let latest: NapcatLoginLogResult = {
      offlineReason: null,
      state: 'unknown',
    };
    for (let index = 0; index < attempts; index += 1) {
      await this.toolsService.sleep(Number.isFinite(delayMs) ? delayMs : 2000);
      latest = await this.detectRuntimeLoginStateSince(runtime.name, since);
      if (latest.state !== 'unknown') return latest;
    }
    return latest;
  }

  private async detectRuntimeLoginStateSince(name: string, since: string) {
    const result = await this.runProcess(
      'ssh',
      [...this.getSshArgs(), 'sh -s'],
      this.buildRemoteRecentLogsSinceScript(name, since),
      undefined,
      this.getRuntimeCheckTimeoutMs(),
    );
    return this.extractLoginState(result.stdout);
  }

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

  private async findContainerWithToken(containerId: string) {
    return this.containerRepository
      .createQueryBuilder('container')
      .addSelect('container.webuiToken')
      .where('container.id = :containerId', { containerId })
      .andWhere('container.isDeleted = :isDeleted', { isDeleted: false })
      .getOne();
  }

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
        await this.deviceIdentityService.resolveForAccount({
          accountId,
          containerId: container.id,
          selfId,
        });
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

  private async createRemoteDockerContainer(input: {
    account?: string;
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
  }

  private buildRemoteCreateScript(input: {
    account?: string;
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
          `MACHINE_ID_PATH=${this.sh(input.deviceIdentity.machineIdPath)}`,
          `DEVICE_ENV_PATH=${this.sh(input.deviceIdentity.deviceEnvPath)}`,
        ].join('\n') + '\n'
      : '';
    const devicePrepareScript = input.deviceIdentity
      ? `
cat > "$DEVICE_ENV_PATH" <<EOF
NAPCAT_HOSTNAME=$NAPCAT_HOSTNAME
NAPCAT_MAC_ADDRESS=$NAPCAT_MAC_ADDRESS
MACHINE_ID_PATH=$MACHINE_ID_PATH
EOF
if [ ! -s "$MACHINE_ID_PATH" ]; then
  printf '%s' "$NAME" | sha256sum | cut -c 1-32 > "$MACHINE_ID_PATH"
fi
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
${accountHeader}
${passwordHeader}
${deviceHeader}
mkdir -p "$DATA_DIR/QQ" "$DATA_DIR/config" "$DATA_DIR/plugins" "$DATA_DIR/logs"
chmod 700 "$DATA_DIR"
${devicePrepareScript}

cat > "$DATA_DIR/config/webui.json" <<EOF
{
  "host": "0.0.0.0",
  "port": 6099,
  "token": "$WEBUI_TOKEN",
  "loginRate": 3
}
EOF

cat > "$DATA_DIR/config/onebot11.json" <<EOF
{
  "network": {
    "httpServers": [],
    "httpClients": [],
    "websocketServers": [],
    "websocketClients": [
      {
        "name": "kt-template-online-api-reverse",
        "enable": true,
        "url": "$REVERSE_WS_URL",
        "messagePostFormat": "array",
        "reportSelfMessage": false,
        "reconnectInterval": 5000,
        "token": "",
        "debug": false,
        "heartInterval": 30000
      }
    ]
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false
}
EOF

${pullCmd}docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d \\
  --name "$NAME" \\
  --restart unless-stopped \\
  -e NAPCAT_UID=0 \\
  -e NAPCAT_GID=0 \\
  -e WEBUI_TOKEN="$WEBUI_TOKEN" \\
${accountRunFlag}${passwordRunFlag}${deviceRunFlags}  -p "$PORT:6099" \\
  -v "$DATA_DIR/QQ:/app/.config/QQ" \\
  -v "$DATA_DIR/config:/app/napcat/config" \\
  -v "$DATA_DIR/plugins:/app/napcat/plugins" \\
  "$IMAGE" >/dev/null
`;
  }

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

  private buildBaseUrl(port: number) {
    const template = this.getConfig('QQBOT_NAPCAT_BASE_URL_TEMPLATE', '');
    if (template) {
      return template.replace('{port}', `${port}`);
    }

    const host = this.getConfig('QQBOT_NAPCAT_HOST', '127.0.0.1');
    return `http://${host}:${port}`;
  }

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

  private toRuntime(container: QqbotNapcatContainer): QqbotNapcatRuntime {
    return {
      baseUrl: this.normalizeBaseUrl(container.baseUrl),
      id: container.id,
      name: container.name,
      webuiPort: container.webuiPort,
      webuiToken: container.webuiToken,
    };
  }

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

  private normalizeBaseUrl(value: string) {
    const baseUrl = `${value || ''}`.trim();
    if (!baseUrl) {
      throwVbenError('NapCat WebUI 地址未配置');
    }
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  private getRootDir() {
    return this.getConfig(
      'QQBOT_NAPCAT_ROOT',
      '/vol1/docker/kt-qqbot/napcat-instances',
    ).replace(/\/+$/, '');
  }

  private isManagedMode() {
    return !!this.getManagedMode();
  }

  private getManagedMode() {
    return this.getConfig('QQBOT_NAPCAT_CONTAINER_MODE', '').toLowerCase();
  }

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

  private getConfig(key: string, defaultValue = '') {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }

  private getProcessTimeoutMs() {
    const timeoutMs = Number(
      this.getConfig('QQBOT_NAPCAT_SSH_TIMEOUT_MS', '120000'),
    );
    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;
  }

  private getRuntimeCheckTimeoutMs() {
    const timeoutMs = Number(
      this.getConfig('QQBOT_NAPCAT_RUNTIME_CHECK_TIMEOUT_MS', '5000'),
    );
    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000;
  }

  private getCaptchaLogReadTimeoutMs() {
    return Math.max(this.getRuntimeCheckTimeoutMs(), 15000);
  }

  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }

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
