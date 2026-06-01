import { spawn } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { QqbotAccount } from '../account/qqbot-account.entity';
import { QqbotAccountNapcat } from './qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from './qqbot-napcat-container.entity';

export type QqbotNapcatRuntime = {
  baseUrl: string;
  id?: string;
  name: string;
  webuiPort?: null | number;
  webuiToken?: null | string;
};

@Injectable()
export class QqbotNapcatContainerService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(QqbotNapcatContainer)
    private readonly containerRepository: Repository<QqbotNapcatContainer>,
    @InjectRepository(QqbotAccountNapcat)
    private readonly bindingRepository: Repository<QqbotAccountNapcat>,
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
      const message = this.getErrorMessage(err);
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

  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }

  private runProcess(command: string, args: string[], input: string) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += Buffer.from(chunk).toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += Buffer.from(chunk).toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error((stderr || stdout || `${command} failed`).trim()));
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  }

  private getErrorMessage(err: unknown) {
    return err instanceof Error ? err.message : `${err}`;
  }
}
