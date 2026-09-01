import { createHmac, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';

const TOKEN_ISSUER = 'kt-admin-sso';
const TOKEN_TTL_SECONDS = 120;
const NODE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export interface CodexRemoteProject {
  cwd: string;
  id: string;
  label: string;
}

interface CodexRemoteNode {
  audience: string;
  id: string;
  label: string;
  projects: CodexRemoteProject[];
  secret: string;
  wsUrl: string;
}

@Injectable()
export class CodexRemoteService {
  constructor(private readonly config: ConfigService) {}

  /**
   * 返回已完整配置的 Windows Desktop Relay 节点，不回传 Relay 签名密钥。
   * @returns 可由手机通过 WireGuard 访问的唯一 Desktop writer 与项目目录。
   */
  nodes() {
    return this.configuredNodes().map((node) => this.publicNode(node));
  }

  /**
   * 为已通过 Admin SSO 的用户签发两分钟 Relay 管理 token，不创建第二 App Server writer。
   * @param nodeId - 目标 Windows PC 节点标识。
   * @param projectId - 节点声明的项目标识。
   * @param user - 当前 Admin 登录用户。
   * @returns WebSocket 地址、短期 token、到期时间和精确项目目录。
   * @throws 节点未配置或项目不属于节点时抛出对应 HTTP 异常。
   */
  createSession(nodeId: string, projectId: string, user: AdminUser) {
    const node = this.configuredNodes().find((item) => item.id === nodeId);
    if (!node) throw new NotFoundException('Remote 节点不存在或未配置');
    const project = node.projects.find((item) => item.id === projectId);
    if (!project) throw new BadRequestException('Remote 项目不属于当前节点');
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + TOKEN_TTL_SECONDS;
    const token = this.signJwt(node.secret, {
      aud: node.audience,
      exp: expiresAt,
      iat: issuedAt,
      iss: TOKEN_ISSUER,
      jti: randomUUID(),
      nbf: issuedAt - 5,
      nodeId: node.id,
      projectCwd: project.cwd,
      projectId: project.id,
      sub: user.id,
      username: user.username,
    });
    return {
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      node: this.publicNode(node),
      project,
      token,
      wsUrl: node.wsUrl,
    };
  }

  /**
   * 从固定 PC Relay 环境变量构造唯一节点，并过滤缺密钥、缺项目或地址非法的半配置项。
   * @returns 可安全签发 Relay 会话的 Windows PC 节点。
   */
  private configuredNodes(): CodexRemoteNode[] {
    const nodes: CodexRemoteNode[] = [];
    const pc = this.readNode({
      address: '10.66.66.4',
      id: 'pc',
      label: 'Windows PC',
      prefix: 'CODEX_REMOTE_PC',
    });
    if (pc) nodes.push(pc);
    return nodes;
  }

  /**
   * 读取固定 PC Relay 身份，要求 WebSocket 只绑定其 WireGuard 地址且 secret 至少 32 字节。
   * @param input - 节点固定 ID、标签、WireGuard IPv4 和环境变量前缀。
   * @returns 完整节点；任一配置缺失或非法时为 null。
   */
  private readNode(input: {
    address: string;
    id: string;
    label: string;
    prefix: string;
  }): CodexRemoteNode | null {
    const wsUrl = String(this.config.get(`${input.prefix}_WS_URL`) || '').trim();
    const secret = String(
      this.config.get(`${input.prefix}_WS_SHARED_SECRET`) || '',
    ).trim();
    const rawProjects = String(
      this.config.get(`${input.prefix}_PROJECTS_JSON`) || '',
    ).trim();
    if (!wsUrl || secret.length < 32 || !rawProjects) return null;
    if (!NODE_ID_PATTERN.test(input.id)) return null;
    if (!this.validWsUrl(wsUrl, input.address)) return null;
    const projects = this.parseProjects(rawProjects);
    if (projects.length === 0) return null;
    return {
      audience: `kt-codex-remote-${input.id}`,
      id: input.id,
      label: input.label,
      projects,
      secret,
      wsUrl,
    };
  }

  /**
   * 解析项目 JSON，要求 ID 唯一、标签非空且 cwd 为无换行绝对路径。
   * @param raw - 单节点项目 JSON 数组。
   * @returns 通过全部约束的项目；整体非法时为空数组。
   */
  private parseProjects(raw: string): CodexRemoteProject[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const projects: CodexRemoteProject[] = [];
      const ids = new Set<string>();
      for (const value of parsed) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return [];
        }
        const record = value as Record<string, unknown>;
        let id = '';
        if (typeof record.id === 'string') id = record.id.trim();
        let label = '';
        if (typeof record.label === 'string') label = record.label.trim();
        let cwd = '';
        if (typeof record.cwd === 'string') cwd = record.cwd.trim();
        if (!this.validProject(id, label, cwd, ids)) return [];
        ids.add(id);
        projects.push({ cwd, id, label });
      }
      return projects;
    } catch {
      return [];
    }
  }

  /**
   * 逐项约束 Remote 项目标识、显示名和绝对目录，避免重复 ID 或换行注入进入节点目录。
   * @param id - 已去除首尾空白的项目标识。
   * @param label - 已去除首尾空白的项目显示名。
   * @param cwd - 已去除首尾空白的节点绝对目录。
   * @param ids - 当前节点已经接收的项目标识。
   * @returns 三个字段均满足目录合同时返回 true。
   */
  private validProject(
    id: string,
    label: string,
    cwd: string,
    ids: Set<string>,
  ) {
    if (!PROJECT_ID_PATTERN.test(id)) return false;
    if (ids.has(id)) return false;
    if (!label || label.length > 100) return false;
    if (!cwd.startsWith('/') || cwd.length > 1000) return false;
    if (cwd.includes('\n') || cwd.includes('\r')) return false;
    return true;
  }

  /**
   * 校验节点 URL 只能是无凭据、无 query/hash 的固定 WireGuard ws 根地址。
   * @param value - 候选 WebSocket URL。
   * @param expectedAddress - 节点固定 WireGuard IPv4。
   * @returns URL 满足私网边界时返回 true。
   */
  private validWsUrl(value: string, expectedAddress: string) {
    try {
      const url = new URL(value);
      const port = Number(url.port);
      if (url.protocol !== 'ws:') return false;
      if (url.hostname !== expectedAddress) return false;
      if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
        return false;
      }
      if (url.username || url.password) return false;
      if (url.pathname !== '/') return false;
      if (url.search || url.hash) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 移除节点签名 secret，只保留手机建立短期会话所需的目录信息。
   * @param node - 完整内部节点。
   * @returns 不含 secret 的节点视图。
   */
  private publicNode(node: CodexRemoteNode) {
    return {
      id: node.id,
      label: node.label,
      projects: node.projects,
      wsUrl: node.wsUrl,
    };
  }

  /**
   * 按 App Server `signed-bearer-token` 合同生成无填充 base64url HS256 JWT。
   * @param secret - 节点本地与 API 共享的至少 32 字节签名密钥。
   * @param claims - 含 exp/nbf/iss/aud 和 Admin 用户身份的短期声明。
   * @returns 可放入 WebSocket Authorization Bearer 的 JWT。
   */
  private signJwt(secret: string, claims: Record<string, unknown>) {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const unsigned = `${header}.${payload}`;
    const signature = createHmac('sha256', secret)
      .update(unsigned)
      .digest('base64url');
    return `${unsigned}.${signature}`;
  }
}
