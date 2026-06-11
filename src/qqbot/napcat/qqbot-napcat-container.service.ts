import { spawn } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { QqbotAccount } from '../account/qqbot-account.entity';
import { QqbotAccountNapcat } from './qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from './qqbot-napcat-container.entity';
import type { QqbotNapcatRuntime } from '../qqbot.types';

type NapcatLoginLogState = 'offline' | 'online' | 'unknown';

type NapcatLoginLogResult = {
  offlineReason: string | null;
  state: NapcatLoginLogState;
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
    if (existing) return existing;

    return this.createManagedContainer(account.selfId);
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
            ? { lastError: loginState.offlineReason }
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
          lastError: this.toolsService.getErrorMessage(err),
        },
      );
      return null;
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
    const name = this.sh(container.name);

    return `
set -eu
NAME=${name}
docker logs --tail 300 "$NAME" 2>&1 || true
`;
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

  private async createManagedContainer(selfId?: string) {
    const mode = this.getManagedMode();
    if (mode !== 'ssh') {
      throwVbenError('当前仅支持通过 SSH 创建 NapCat 容器');
    }

    const port = await this.allocatePort();
    const name = this.buildContainerName(selfId);
    const token = randomBytes(24).toString('hex');
    const image = this.getConfig(
      'QQBOT_NAPCAT_IMAGE',
      'mlikiowa/napcat-docker:latest',
    );
    const dataDir = `${this.getRootDir()}/${name}`;
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
        dataDir,
        image,
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
      return {
        baseUrl,
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
          lastError: message,
          status: 'error',
        },
      );
      throwVbenError(`创建 NapCat 容器失败：${message}`);
    }
  }

  private async createRemoteDockerContainer(input: {
    dataDir: string;
    image: string;
    name: string;
    port: number;
    reverseWsUrl: string;
    token: string;
  }) {
    const script = this.buildRemoteCreateScript(input);
    await this.runProcess('ssh', [...this.getSshArgs(), 'sh -s'], script);
  }

  private buildRemoteCreateScript(input: {
    dataDir: string;
    image: string;
    name: string;
    port: number;
    reverseWsUrl: string;
    token: string;
  }) {
    const dataDir = this.sh(input.dataDir);
    const image = this.sh(input.image);
    const name = this.sh(input.name);
    const reverseWsUrl = this.sh(input.reverseWsUrl);
    const token = this.sh(input.token);

    return `
set -eu
DATA_DIR=${dataDir}
IMAGE=${image}
NAME=${name}
PORT=${input.port}
REVERSE_WS_URL=${reverseWsUrl}
WEBUI_TOKEN=${token}

mkdir -p "$DATA_DIR/QQ" "$DATA_DIR/config" "$DATA_DIR/plugins" "$DATA_DIR/logs"
chmod 700 "$DATA_DIR"

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

docker pull "$IMAGE" >/dev/null
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d \\
  --name "$NAME" \\
  --restart unless-stopped \\
  -e NAPCAT_UID=0 \\
  -e NAPCAT_GID=0 \\
  -e WEBUI_TOKEN="$WEBUI_TOKEN" \\
  -p "$PORT:6099" \\
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
