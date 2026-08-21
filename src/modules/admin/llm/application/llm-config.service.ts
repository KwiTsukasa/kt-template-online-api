import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { normalizeVbenErrorText, throwVbenError, ToolsService } from '@/common';
import {
  LlmConfigCreateDto,
  LlmConfigListQueryDto,
  LlmConfigUpdateDto,
} from '../contract/llm.dto';
import {
  LLM_PROVIDER_CATALOG,
  type LlmAdapterConfig,
  type LlmModelDiscoveryResult,
  type LlmModelItem,
  type LlmProvider,
} from '../contract/llm.types';
import {
  LlmModelDiscoveryError,
  LlmProviderAdapterRegistry,
  normalizeLlmModelItems,
} from '../infrastructure/integration/llm-provider.adapter';
import { AdminLlmConfigEntity } from '../infrastructure/persistence/llm.entities';

const INSECURE_LLM_SECRET_VALUES = new Set([
  'change-me',
  'kt-template-online-admin-token-secret',
]);
const TEST_PROMPT = '请只回复“连接成功”';

export interface LlmRuntimeConfigRecord {
  adapterConfig: LlmAdapterConfig;
  entity: AdminLlmConfigEntity;
}

export interface LlmResolvedModelSelection {
  model: string;
  reasoningEffort?: string;
  serviceTier?: string;
}

@Injectable()
export class LlmConfigService {
  constructor(
    @InjectRepository(AdminLlmConfigEntity)
    private readonly repository: Repository<AdminLlmConfigEntity>,
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
    private readonly adapters: LlmProviderAdapterRegistry,
  ) {}

  /**
   * 返回六类供应商的标签、默认端点、协议与凭据要求。
   * @returns 按固定供应商顺序排列的目录。
   */
  providerCatalog() {
    const order: LlmProvider[] = [
      'openai',
      'anthropic',
      'zhipu',
      'deepseek',
      'moonshot',
      'codex',
    ];
    return order.map((provider) => {
      const item = { ...LLM_PROVIDER_CATALOG[provider] };
      if (provider === 'codex') {
        item.defaultBaseUrl = this.codexGatewayBaseUrl();
      }
      return item;
    });
  }

  /**
   * 按关键词、供应商、连接状态和分页读取脱敏连接卡片。
   * @param query - 配置页筛选与分页条件。
   * @returns 包含脱敏连接项与总数的分页结果。
   */
  async list(query: LlmConfigListQueryDto) {
    const pageNo = this.toolsService.toPositiveNumber(query.pageNo, 1);
    const pageSize = Math.min(
      this.toolsService.toPositiveNumber(query.pageSize, 20),
      100,
    );
    const builder = this.repository
      .createQueryBuilder('config')
      .addSelect('config.apiKeySecret')
      .where('config.isDeleted = :isDeleted', { isDeleted: false });
    const keyword = this.toolsService.toTrimmedString(query.keyword);
    if (keyword) {
      builder.andWhere(
        new Brackets((nested) => {
          nested
            .where('config.name LIKE :keyword', { keyword: `%${keyword}%` })
            .orWhere('config.baseUrl LIKE :keyword', {
              keyword: `%${keyword}%`,
            });
        }),
      );
    }
    if (query.provider) {
      builder.andWhere('config.provider = :provider', {
        provider: query.provider,
      });
    }
    if (query.status) {
      builder.andWhere('config.connectionStatus = :status', {
        status: query.status,
      });
    }
    const [items, total] = await builder
      .orderBy('config.isDefault', 'DESC')
      .addOrderBy('config.updateTime', 'DESC')
      .skip((pageNo - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: items.map((item) => this.toView(item)), total };
  }

  /**
   * 按未删除连接的状态分组计数，并把未出现的看板状态保留为零值。
   * @returns 配置看板顶部使用的四项计数。
   */
  async summary() {
    const rows = await this.repository
      .createQueryBuilder('config')
      .select('config.connectionStatus', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('config.isDeleted = :isDeleted', { isDeleted: false })
      .groupBy('config.connectionStatus')
      .getRawMany<{ count: string; status: string }>();
    const summary = {
      connected: 0,
      disabled: 0,
      error: 0,
      total: 0,
    };
    for (const row of rows) {
      const count = Number(row.count || 0);
      summary.total += count;
      if (row.status === 'connected') summary.connected = count;
      if (row.status === 'disabled') summary.disabled = count;
      if (row.status === 'error') summary.error = count;
    }
    return summary;
  }

  /**
   * 按标识读取单个脱敏连接详情。
   * @param id - 大模型连接 Snowflake ID。
   * @returns 不含密钥或静态模型数组的连接详情。
   */
  async detail(id: string) {
    return this.toView(await this.requireEntity(id, undefined, true));
  }

  /**
   * 经当前连接适配器即时读取供应商目录，并附上获取时间而不触碰配置持久化。
   * @param id - 大模型连接 Snowflake ID。
   * @returns 获取时间、供应商与规范化模型目录。
   */
  async models(id: string): Promise<LlmModelDiscoveryResult> {
    const runtime = await this.runtime(id);
    const items = await this.fetchModelItems(runtime);
    return {
      fetchedAt: new Date().toISOString(),
      items,
      provider: runtime.entity.provider,
    };
  }

  /**
   * 在事务中校验名称和默认项约束，加密非空凭据后返回不含密文的新连接视图。
   * @param body - 连接名称、供应商、端点、凭据和启用状态。
   * @returns 新连接的脱敏视图。
   */
  async create(body: LlmConfigCreateDto) {
    return this.repository.manager.transaction(async (manager) => {
      await this.assertUniqueName(body.name, undefined, manager);
      if (body.isDefault && !body.enabled) {
        throwVbenError('已停用连接不能设为默认', HttpStatus.CONFLICT);
      }
      const repository = manager.getRepository(AdminLlmConfigEntity);
      let connectionStatus: AdminLlmConfigEntity['connectionStatus'] =
        'disabled';
      if (body.enabled) connectionStatus = 'untested';
      const baseUrl = this.normalizeBaseUrl(body.baseUrl);
      this.assertProviderEndpoint(body.provider, baseUrl);
      const entity = repository.create({
        apiKeySecret: null,
        baseUrl,
        connectionStatus,
        enabled: body.enabled,
        firstTokenLatencyMs: null,
        isDefault: body.isDefault,
        isDeleted: false,
        lastErrorMessage: null,
        lastTestedAt: null,
        name: body.name.trim(),
        provider: body.provider,
      });
      this.applyApiKey(entity, body.apiKey);
      if (entity.provider === 'codex') entity.apiKeySecret = null;
      if (entity.isDefault) await this.clearOtherDefaults(manager);
      return this.toView(await repository.save(entity));
    });
  }

  /**
   * 更新连接字段；空 API Key 保留旧密钥，供应商切为 Codex 时清除无用密文。
   * @param id - 大模型连接 Snowflake ID。
   * @param body - 允许局部更新的连接字段。
   * @returns 更新后的脱敏连接视图。
   */
  async update(id: string, body: LlmConfigUpdateDto) {
    return this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(AdminLlmConfigEntity);
      const entity = await this.requireEntity(id, manager, true);
      let connectionChanged = false;
      if (body.name !== undefined) {
        await this.assertUniqueName(body.name, id, manager);
        entity.name = body.name.trim();
      }
      if (body.provider !== undefined && body.provider !== entity.provider) {
        entity.provider = body.provider;
        connectionChanged = true;
      }
      if (body.baseUrl !== undefined) {
        const baseUrl = this.normalizeBaseUrl(body.baseUrl);
        if (baseUrl !== entity.baseUrl) connectionChanged = true;
        entity.baseUrl = baseUrl;
      }
      if (body.enabled !== undefined) {
        entity.enabled = body.enabled;
        entity.connectionStatus = 'disabled';
        if (body.enabled) entity.connectionStatus = 'untested';
        if (!body.enabled) entity.isDefault = false;
      }
      if (body.isDefault !== undefined) entity.isDefault = body.isDefault;
      if (this.applyApiKey(entity, body.apiKey)) connectionChanged = true;
      if (entity.provider === 'codex' && entity.apiKeySecret) {
        entity.apiKeySecret = null;
        connectionChanged = true;
      }
      this.assertProviderEndpoint(entity.provider, entity.baseUrl);
      if (entity.isDefault && !entity.enabled) {
        throwVbenError('已停用连接不能设为默认', HttpStatus.CONFLICT);
      }
      if (connectionChanged) {
        entity.connectionStatus = 'disabled';
        if (entity.enabled) entity.connectionStatus = 'untested';
        entity.firstTokenLatencyMs = null;
        entity.lastErrorMessage = null;
        entity.lastTestedAt = null;
      }
      if (entity.isDefault) await this.clearOtherDefaults(manager, entity.id);
      return this.toView(await repository.save(entity));
    });
  }

  /**
   * 软删除连接并取消默认标记；历史会话仍保留数据库审计数据。
   * @param id - 大模型连接 Snowflake ID。
   * @returns 删除后的连接标识。
   */
  async remove(id: string) {
    const entity = await this.requireEntity(id);
    if (entity.enabled) {
      throwVbenError('请先停用连接再删除', HttpStatus.CONFLICT);
    }
    await this.repository.update({ id }, { isDefault: false, isDeleted: true });
    return { id };
  }

  /**
   * 切换连接启用状态，并把重新启用的连接重置为待测试。
   * @param id - 大模型连接 Snowflake ID。
   * @param enabled - 目标启用状态。
   * @returns 更新后的脱敏连接视图。
   */
  async setEnabled(id: string, enabled: boolean) {
    const entity = await this.requireEntity(id, undefined, true);
    entity.enabled = enabled;
    entity.connectionStatus = 'disabled';
    if (enabled) entity.connectionStatus = 'untested';
    if (!enabled) entity.isDefault = false;
    return this.toView(await this.repository.save(entity));
  }

  /**
   * 在事务内把指定连接设为唯一默认连接。
   * @param id - 大模型连接 Snowflake ID。
   * @returns 更新后的脱敏连接视图。
   */
  async setDefault(id: string) {
    return this.repository.manager.transaction(async (manager) => {
      const entity = await this.requireEntity(id, manager, true);
      if (!entity.enabled) {
        throwVbenError('已停用连接不能设为默认', HttpStatus.CONFLICT);
      }
      await this.clearOtherDefaults(manager, entity.id);
      entity.isDefault = true;
      return this.toView(
        await manager.getRepository(AdminLlmConfigEntity).save(entity),
      );
    });
  }

  /**
   * 用已保存连接和指定模型执行真实流式最小调用，并记录首 Token 延迟。
   * @param id - 大模型连接 Snowflake ID。
   * @param requestedModel - 可选测试模型；缺省使用实时模型目录首项。
   * @returns 实际模型、首 Token 延迟、总耗时和短预览。
   * @throws 所选模型不在实时目录时保留 400；模型发现或流请求失败时记录状态并抛出 502。
   */
  async testConnection(id: string, requestedModel?: string) {
    const runtime = await this.runtime(id);
    const startedAt = Date.now();
    let firstTokenLatencyMs: number | undefined;
    let preview = '';
    let actualModel = '';
    const abortController = new AbortController();
    try {
      const selection = await this.resolveModelSelection(
        runtime,
        requestedModel,
      );
      actualModel = selection.model;
      const adapter = this.adapters.resolve(runtime.entity.provider);
      for await (const event of adapter.stream({
        clientMessageId: `llm-test-${Date.now()}`,
        config: runtime.adapterConfig,
        messages: [{ content: TEST_PROMPT, role: 'user' }],
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        serviceTier: selection.serviceTier,
        signal: abortController.signal,
      })) {
        if (
          (event.type === 'text-delta' || event.type === 'reasoning-delta') &&
          firstTokenLatencyMs === undefined
        ) {
          firstTokenLatencyMs = Date.now() - startedAt;
        }
        if (event.type === 'text-delta' && preview.length < 200) {
          preview += event.content;
        }
        if (event.type === 'done') actualModel = event.model;
      }
      const latencyMs = Date.now() - startedAt;
      if (firstTokenLatencyMs === undefined) firstTokenLatencyMs = latencyMs;
      await this.repository.update(
        { id },
        {
          connectionStatus: 'connected',
          firstTokenLatencyMs,
          lastErrorMessage: null,
          lastTestedAt: new Date(),
        },
      );
      return {
        checkedAt: new Date().toISOString(),
        firstTokenLatencyMs,
        latencyMs,
        model: actualModel,
        preview: preview.slice(0, 200),
      };
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.BAD_REQUEST
      ) {
        throw error;
      }
      const message = this.safeErrorMessage(error);
      await this.repository.update(
        { id },
        {
          connectionStatus: 'error',
          firstTokenLatencyMs: null,
          lastErrorMessage: message,
          lastTestedAt: new Date(),
        },
      );
      throwVbenError(message, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * 加载含密钥的启用连接，并转换为单次适配器运行参数。
   * @param id - 大模型连接 Snowflake ID。
   * @returns 数据库实体与已解密适配器配置。
   */
  async runtime(id: string): Promise<LlmRuntimeConfigRecord> {
    const entity = await this.requireEntity(id, undefined, true);
    return this.toRuntime(entity);
  }

  /**
   * 按供应商选择当前默认或最近更新的启用连接，供媒体治理等内部业务复用同一配置。
   * @param provider - 需要解析运行连接的供应商。
   * @returns 当前供应商的数据库实体与适配器运行配置。
   */
  async runtimeForProvider(
    provider: LlmProvider,
  ): Promise<LlmRuntimeConfigRecord> {
    const entity = await this.repository
      .createQueryBuilder('config')
      .addSelect('config.apiKeySecret')
      .where('config.provider = :provider', { provider })
      .andWhere('config.enabled = :enabled', { enabled: true })
      .andWhere('config.isDeleted = :isDeleted', { isDeleted: false })
      .orderBy('config.isDefault', 'DESC')
      .addOrderBy('config.updateTime', 'DESC')
      .getOne();
    if (!entity) {
      throwVbenError(
        `尚未配置启用的 ${LLM_PROVIDER_CATALOG[provider].label} 连接`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.toRuntime(entity);
  }

  /**
   * 将已加载密文的启用实体转换为单次适配器运行配置。
   * @param entity - 已显式加载 API Key 密文的连接实体。
   * @returns 可安全传给供应商适配器的运行记录。
   */
  private toRuntime(entity: AdminLlmConfigEntity): LlmRuntimeConfigRecord {
    if (!entity.enabled) {
      throwVbenError('大模型连接已停用', HttpStatus.CONFLICT);
    }
    let apiKey = '';
    if (entity.apiKeySecret) {
      apiKey = this.toolsService.decryptSecretText(
        entity.apiKeySecret,
        this.encryptionKey(),
      );
    }
    const catalog = LLM_PROVIDER_CATALOG[entity.provider];
    if (catalog.requiresApiKey && !apiKey) {
      throwVbenError('当前连接尚未配置 API Key', HttpStatus.BAD_REQUEST);
    }
    return {
      adapterConfig: {
        apiKey,
        baseUrl: entity.baseUrl,
        provider: entity.provider,
      },
      entity,
    };
  }

  /**
   * 以实时供应商目录校验用户模型，缺省时选择目录首项且禁止静态回退。
   * @param runtime - 当前连接实体及已解密适配器配置。
   * @param requestedModel - 用户选择或测试请求传入的模型。
   * @returns 当前供应商实时声明可用的规范模型标识。
   * @throws 实时模型请求失败或所选模型不在实时目录时抛出对应 Vben 异常。
   */
  async resolveModel(
    runtime: LlmRuntimeConfigRecord,
    requestedModel?: string,
  ): Promise<string> {
    return (await this.resolveModelSelection(runtime, requestedModel)).model;
  }

  /**
   * 按模型实时能力校验推理强度与速度档位，并在调用方未指定时采用供应商声明默认值。
   * @param runtime - 当前连接实体及已解密适配器配置。
   * @param requestedModel - 用户选择或测试请求传入的模型。
   * @param requestedReasoningEffort - 可选模型级推理强度；供应商未声明时不得传入。
   * @param requestedServiceTier - 可选模型级速度/服务档位；供应商未声明时不得传入。
   * @returns 实时校验后的模型及可选推理、速度参数。
   * @throws 模型或能力值未被当前实时目录声明时抛出 400。
   */
  async resolveModelSelection(
    runtime: LlmRuntimeConfigRecord,
    requestedModel?: string,
    requestedReasoningEffort?: string,
    requestedServiceTier?: string,
  ): Promise<LlmResolvedModelSelection> {
    const items = await this.fetchModelItems(runtime);
    let model = this.toolsService.toTrimmedString(requestedModel);
    if (!model) model = items[0].id;
    const item = items.find((current) => current.id === model);
    if (!item) {
      throwVbenError(
        '所选模型不属于当前连接的实时可用模型',
        HttpStatus.BAD_REQUEST,
      );
    }
    let reasoningEffort = this.toolsService.toTrimmedString(
      requestedReasoningEffort,
    );
    if (!reasoningEffort && item.defaultReasoningEffort) {
      reasoningEffort = item.defaultReasoningEffort;
    }
    if (
      reasoningEffort &&
      !item.reasoningEfforts.some((option) => option.id === reasoningEffort)
    ) {
      throwVbenError('所选推理强度不受当前模型支持', HttpStatus.BAD_REQUEST);
    }
    let serviceTier = this.toolsService.toTrimmedString(requestedServiceTier);
    if (!serviceTier && item.defaultServiceTier) {
      serviceTier = item.defaultServiceTier;
    }
    if (
      serviceTier &&
      !item.serviceTiers.some((option) => option.id === serviceTier)
    ) {
      throwVbenError('所选速度档位不受当前模型支持', HttpStatus.BAD_REQUEST);
    }
    const selection: LlmResolvedModelSelection = { model: item.id };
    if (reasoningEffort) selection.reasoningEffort = reasoningEffort;
    if (serviceTier) selection.serviceTier = serviceTier;
    return selection;
  }

  /**
   * 调用唯一供应商适配器并再次规范模型项，未知异常统一收敛为不泄露上游信息的 502。
   * @param runtime - 当前连接实体及已解密适配器配置。
   * @returns 非空且按 ID 去重的实时模型目录。
   * @throws 适配器请求或协议校验失败时抛出不含上游原文的 502。
   */
  private async fetchModelItems(
    runtime: LlmRuntimeConfigRecord,
  ): Promise<LlmModelItem[]> {
    try {
      const adapter = this.adapters.resolve(runtime.entity.provider);
      const items = await adapter.fetchModels(runtime.adapterConfig);
      return normalizeLlmModelItems(items, '实时模型列表响应协议不合法');
    } catch (error) {
      let message = '实时模型列表获取失败';
      if (error instanceof LlmModelDiscoveryError) message = error.message;
      throwVbenError(message, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * 读取连接实体并按需显式选择 API Key 密文。
   * @param id - 大模型连接 Snowflake ID。
   * @param manager - 可选事务管理器。
   * @param includeSecret - 是否显式选择默认排除的密文字段；省略时为 false。
   * @returns 未删除的连接实体。
   */
  private async requireEntity(
    id: string,
    manager?: EntityManager,
    includeSecret = false,
  ) {
    let repository = this.repository;
    if (manager) repository = manager.getRepository(AdminLlmConfigEntity);
    const builder = repository
      .createQueryBuilder('config')
      .where('config.id = :id', { id })
      .andWhere('config.isDeleted = :isDeleted', { isDeleted: false });
    if (includeSecret) builder.addSelect('config.apiKeySecret');
    const entity = await builder.getOne();
    if (!entity) throwVbenError('大模型连接不存在', HttpStatus.NOT_FOUND);
    return entity;
  }

  /**
   * 以去空白名称查询未删除连接；更新场景排除自身，并在冲突时拒绝当前事务。
   * @param name - 待保存的连接名称。
   * @param excludedId - 更新时排除的当前连接标识。
   * @param manager - 当前事务管理器。
   */
  private async assertUniqueName(
    name: string,
    excludedId: string | undefined,
    manager: EntityManager,
  ) {
    const builder = manager
      .getRepository(AdminLlmConfigEntity)
      .createQueryBuilder('config')
      .where('config.name = :name', { name: name.trim() })
      .andWhere('config.isDeleted = :isDeleted', { isDeleted: false });
    if (excludedId)
      builder.andWhere('config.id <> :excludedId', { excludedId });
    if (await builder.getOne()) {
      throwVbenError('大模型连接名称已存在', HttpStatus.CONFLICT);
    }
  }

  /**
   * 在同一事务中撤销其他未删除连接的默认标记，并保留调用方指定的当前连接。
   * @param manager - 当前事务管理器。
   * @param excludedId - 需要保留默认标记的连接标识。
   */
  private async clearOtherDefaults(
    manager: EntityManager,
    excludedId?: string,
  ) {
    const builder = manager
      .getRepository(AdminLlmConfigEntity)
      .createQueryBuilder()
      .update(AdminLlmConfigEntity)
      .set({ isDefault: false })
      .where('is_default = :isDefault', { isDefault: true })
      .andWhere('is_deleted = :isDeleted', { isDeleted: false });
    if (excludedId) builder.andWhere('id <> :excludedId', { excludedId });
    await builder.execute();
  }

  /**
   * 非空 API Key 使用 AES-GCM 包装后覆盖密文，空白输入保持旧值。
   * @param entity - 待保存的连接实体。
   * @param apiKey - 请求作用域内的可选新 API Key。
   * @returns 密文实际被更新时返回 true。
   */
  private applyApiKey(entity: AdminLlmConfigEntity, apiKey?: string): boolean {
    const normalized = this.toolsService.toTrimmedString(apiKey);
    if (!normalized) return false;
    entity.apiKeySecret = this.toolsService.encryptSecretText(
      normalized,
      this.encryptionKey(),
    );
    return true;
  }

  /**
   * 限制凭据供应商使用 HTTPS 或本机测试端点，并把 Codex 固定到部署允许的私有网关。
   * @param provider - 当前连接供应商。
   * @param baseUrl - 已规范化的连接端点。
   */
  private assertProviderEndpoint(provider: LlmProvider, baseUrl: string) {
    if (provider === 'codex') {
      if (baseUrl !== this.codexGatewayBaseUrl()) {
        throwVbenError(
          '本地 Codex 端点必须使用部署配置的私有网关',
          HttpStatus.BAD_REQUEST,
        );
      }
      return;
    }
    const url = new URL(baseUrl);
    if (
      LLM_PROVIDER_CATALOG[provider].requiresApiKey &&
      url.protocol !== 'https:' &&
      !this.isLoopbackHost(url.hostname)
    ) {
      throwVbenError(
        '携带 API Key 的连接端点必须使用 HTTPS',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * 将 localhost、IPv4 回环段与 IPv6 回环归入本机例外，其他主机一律拒绝例外。
   * @param hostname - URL 解析后的主机名。
   * @returns localhost、IPv4 回环段或 IPv6 回环时返回 true。
   */
  private isLoopbackHost(hostname: string): boolean {
    if (hostname === 'localhost') return true;
    if (hostname === '::1' || hostname === '[::1]') return true;
    return /^127(?:\.\d{1,3}){3}$/.test(hostname);
  }

  /**
   * 读取部署允许的唯一 Codex 私有网关地址，并回退供应商目录默认值。
   * @returns 已规范化且不含查询串或凭据的网关 Base URL。
   */
  private codexGatewayBaseUrl(): string {
    const value = this.toolsService.pickFirstText(
      this.configService.get('LLM_CODEX_GATEWAY_BASE_URL'),
      LLM_PROVIDER_CATALOG.codex.defaultBaseUrl,
    );
    return this.normalizeBaseUrl(value);
  }

  /**
   * 规范绝对 HTTP(S) 地址并拒绝凭据、查询串和锚点。
   * @param value - 管理员填写的供应商或私有 gateway Base URL。
   * @returns 移除尾斜杠后的绝对地址。
   */
  private normalizeBaseUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throwVbenError('连接端点 URL 不合法', HttpStatus.BAD_REQUEST);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throwVbenError('连接端点仅支持 HTTP 或 HTTPS', HttpStatus.BAD_REQUEST);
    }
    if (url.username || url.password || url.search || url.hash) {
      throwVbenError(
        '连接端点不能包含凭据、查询串或锚点',
        HttpStatus.BAD_REQUEST,
      );
    }
    return url.toString().replace(/\/+$/, '');
  }

  /**
   * 读取 LLM 专用加密密钥并回退到安全的 Admin Token Secret。
   * @returns 可派生 AES-GCM 密钥的非默认 Secret。
   */
  private encryptionKey(): string {
    const secret = this.toolsService.pickFirstText(
      this.configService.get('LLM_CONFIG_SECRET_KEY'),
      this.configService.get('ADMIN_TOKEN_SECRET'),
    );
    if (!secret || INSECURE_LLM_SECRET_VALUES.has(secret)) {
      throwVbenError(
        '请配置 LLM_CONFIG_SECRET_KEY 或安全的 ADMIN_TOKEN_SECRET',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return secret;
  }

  /**
   * 把未知异常转换为不含请求配置、认证头或堆栈的短文本。
   * @param error - 适配器或数据库抛出的未知错误。
   * @returns 最长 500 字符的用户可读错误。
   */
  private safeErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      return normalizeVbenErrorText(error.getResponse(), '大模型连接测试失败')
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 500);
    }
    if (error instanceof Error && error.message) {
      return error.message
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 500);
    }
    return '大模型连接测试失败';
  }

  /**
   * 把连接实体投影为不含密文和明文的 Admin 视图。
   * @param entity - 可能含密文的连接实体。
   * @returns 配置卡、详情和对话页共用的脱敏连接结构。
   */
  private toView(entity: AdminLlmConfigEntity) {
    const catalog = LLM_PROVIDER_CATALOG[entity.provider];
    return {
      baseUrl: entity.baseUrl,
      connectionStatus: entity.connectionStatus,
      createTime: entity.createTime,
      enabled: entity.enabled,
      firstTokenLatencyMs: entity.firstTokenLatencyMs,
      hasApiKey: !!entity.apiKeySecret,
      id: entity.id,
      isDefault: entity.isDefault,
      lastErrorMessage: entity.lastErrorMessage,
      lastTestedAt: entity.lastTestedAt,
      name: entity.name,
      provider: entity.provider,
      providerLabel: catalog.label,
      requiresApiKey: catalog.requiresApiKey,
      updateTime: entity.updateTime,
    };
  }
}
