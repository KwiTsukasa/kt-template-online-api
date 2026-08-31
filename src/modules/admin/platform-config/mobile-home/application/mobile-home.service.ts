import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { EnvironmentDashboardService } from '../../environment-dashboard/application/environment-dashboard.service';
import { AdminNoticeService } from '../../notice/admin-notice.service';
import type {
  MobileGameAppSnapshot,
  MobileGamePinResponse,
  MobileGameSnapshotResponse,
  MobileHomeActivitySnapshot,
  MobileHomeAssistRequest,
  MobileHomeAssistResponse,
  MobileHomeBootstrapResponse,
  MobileHomeEnergyEntitySnapshot,
  MobileHomeEntityAttributeSnapshot,
  MobileHomeEntitySnapshot,
  MobileHomeHomeSnapshotResponse,
  MobileHomeNoticeItem,
  MobileHomeSceneSnapshot,
  MobileHomeServiceCallRequest,
  MobileHomeServiceCallResponse,
} from '../domain/mobile-home.types';
import {
  HomeAssistantMobileClient,
  type HomeAssistantDevicePayload,
  type HomeAssistantEntityRegistryPayload,
  type HomeAssistantLogbookPayload,
  type HomeAssistantSnapshotPayload,
  type HomeAssistantStatePayload,
} from '../infrastructure/home-assistant-mobile.client';
import { SunshineMobileClient } from '../infrastructure/sunshine-mobile.client';

const MOBILE_HOME_NOTICE_PAGE_SIZE = 40;
const HOME_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SERVICE_CALL_CACHE_MS = 5 * 60 * 1000;
const MOBILE_ENTITY_DOMAINS = new Set([
  'automation',
  'binary_sensor',
  'climate',
  'cover',
  'fan',
  'humidifier',
  'input_boolean',
  'light',
  'lock',
  'media_player',
  'person',
  'scene',
  'script',
  'sensor',
  'switch',
  'vacuum',
  'weather',
]);
const SCENE_DOMAINS = new Set(['automation', 'scene', 'script']);
const ENERGY_DEVICE_CLASSES = new Set(['energy', 'power']);
const MOBILE_ATTRIBUTE_KEYS = new Set([
  'brightness',
  'color_temp_kelvin',
  'current_temperature',
  'device_class',
  'friendly_name',
  'humidity',
  'hvac_mode',
  'icon',
  'percentage',
  'rgb_color',
  'temperature',
  'unit_of_measurement',
]);
const HOME_SERVICE_ALLOWLIST = new Map<string, Set<string>>([
  ['automation', new Set(['turn_off', 'turn_on'])],
  ['climate', new Set(['set_hvac_mode', 'set_temperature'])],
  ['fan', new Set(['set_percentage', 'turn_off', 'turn_on'])],
  ['humidifier', new Set(['set_humidity', 'turn_off', 'turn_on'])],
  ['input_boolean', new Set(['turn_off', 'turn_on'])],
  ['light', new Set(['turn_off', 'turn_on'])],
  ['scene', new Set(['turn_on'])],
  ['script', new Set(['turn_on'])],
  ['switch', new Set(['turn_off', 'turn_on'])],
]);
const HOME_SERVICE_DATA_KEYS = new Set([
  'brightness',
  'color_temp_kelvin',
  'humidity',
  'hvac_mode',
  'percentage',
  'rgb_color',
  'temperature',
]);
const HOME_AREA_LOCALIZATION = new Map([
  ['balcony', '阳台'],
  ['bathroom', '卫生间'],
  ['bedroom', '卧室'],
  ['dining room', '餐厅'],
  ['entrance', '玄关'],
  ['hallway', '走廊'],
  ['kitchen', '厨房'],
  ['living room', '客厅'],
  ['office', '书房'],
  ['study', '书房'],
]);
const HOME_ENTITY_LOCALIZATION = new Map([
  ['sensor.backup_backup_manager_state', '备份管理器状态'],
  ['sensor.backup_last_attempted_automatic_backup', '上次备份尝试'],
  ['sensor.backup_last_successful_automatic_backup', '上次成功备份'],
  ['sensor.backup_next_scheduled_automatic_backup', '下次自动备份'],
  ['sensor.sun_next_dawn', '下次曙光'],
  ['sensor.sun_next_dusk', '下次暮光'],
  ['sensor.sun_next_midnight', '下次午夜'],
  ['sensor.sun_next_noon', '下次正午'],
  ['sensor.sun_next_rising', '下次日出'],
  ['sensor.sun_next_setting', '下次日落'],
]);

type AdminNoticePageItem = Awaited<
  ReturnType<AdminNoticeService['page']>
>['items'][number];

interface ServiceCallCacheEntry {
  expiresAt: number;
  response: MobileHomeServiceCallResponse;
}

@Injectable()
export class MobileHomeService {
  private readonly serviceCallCache = new Map<string, ServiceCallCacheEntry>();

  constructor(
    private readonly environmentDashboard: EnvironmentDashboardService,
    private readonly adminNotices: AdminNoticeService,
    private readonly homeAssistant: HomeAssistantMobileClient,
    private readonly sunshine: SunshineMobileClient,
  ) {}

  /**
   * 并行读取环境快照、最新站内信和未读数，任一权威来源失败时拒绝返回部分聚合结果。
   * @returns 供 KwiCore 概览、智能家居和游戏页面共享的只读启动快照。
   */
  async getBootstrap(): Promise<MobileHomeBootstrapResponse> {
    const [environment, noticePage, unreadCount] = await Promise.all([
      this.environmentDashboard.getDashboard(),
      this.adminNotices.page({
        pageNo: 1,
        pageSize: MOBILE_HOME_NOTICE_PAGE_SIZE,
      }),
      this.adminNotices.getUnreadCount(),
    ]);

    return {
      environment,
      notices: {
        items: noticePage.items.map((notice) => this.projectNotice(notice)),
        total: noticePage.total,
        unreadCount,
      },
    };
  }

  /**
   * 读取 Home Assistant 全量移动快照，并把注册表、状态、日志与能源历史压缩为白名单合同。
   * @returns 不含 token、context 和任意 attributes 的智能家居快照。
   */
  async getHomeSnapshot(): Promise<MobileHomeHomeSnapshotResponse> {
    const source = await this.homeAssistant.snapshot();
    const entityRegistry = new Map(
      source.entities.map((entity) => [entity.entity_id, entity]),
    );
    const devices = new Map(
      source.devices.map((device) => [device.id, device]),
    );
    const entities = source.states
      .filter((state) =>
        MOBILE_ENTITY_DOMAINS.has(this.domainOf(state.entity_id)),
      )
      .map((state) =>
        this.projectEntity(state, entityRegistry.get(state.entity_id), devices),
      );
    const areas = source.areas.map((area) => ({
      entityCount: entities.filter((entity) => entity.areaId === area.area_id)
        .length,
      floorId: area.floor_id || undefined,
      id: area.area_id,
      name: this.localizeAreaName(area.name, area.area_id),
    }));
    const scenes = source.states
      .filter((state) => SCENE_DOMAINS.has(this.domainOf(state.entity_id)))
      .map((state) => this.projectScene(state));
    const activities = source.logbook
      .slice(0, 100)
      .map((entry, index) => this.projectActivity(entry, index));
    const energy = await this.projectEnergy(source, entityRegistry, devices);
    return {
      activities,
      areas,
      connected: true,
      energy,
      entities,
      generatedAt: new Date().toISOString(),
      scenes,
    };
  }

  /**
   * 校验 requestId、实体 domain、service 和 data 白名单后执行 Home Assistant 写操作，并缓存幂等结果。
   * @param input - 移动端服务调用请求。
   * @returns 同一 requestId 稳定返回的最新实体投影。
   */
  async callHomeService(
    input: MobileHomeServiceCallRequest,
  ): Promise<MobileHomeServiceCallResponse> {
    this.cleanupServiceCallCache();
    const cached = this.serviceCallCache.get(input.requestId);
    if (cached) return cached.response;
    this.validateServiceCall(input);
    const data = this.projectServiceData(input.data || {});
    const states = await this.homeAssistant.callService({
      data: { ...data, entity_id: input.entityId },
      domain: input.domain,
      service: input.service,
    });
    const updated = states.find((state) => state.entity_id === input.entityId);
    const response: MobileHomeServiceCallResponse = {
      requestId: input.requestId,
    };
    if (updated) {
      response.entity = this.projectEntity(updated, undefined, new Map());
    }
    this.serviceCallCache.set(input.requestId, {
      expiresAt: Date.now() + SERVICE_CALL_CACHE_MS,
      response,
    });
    return response;
  }

  /**
   * 把用户文本发送给 Home Assistant Conversation API，并仅投影语音、会话和响应类型。
   * @param input - 用户文本、语言与可选会话标识。
   * @returns 脱敏 Assist 回应。
   * @throws 文本去除空白后为空时抛出 400。
   */
  async assist(
    input: MobileHomeAssistRequest,
  ): Promise<MobileHomeAssistResponse> {
    if (!input.text.trim())
      throw new BadRequestException('Assist 文本不能为空');
    const raw = await this.homeAssistant.assist(input);
    return this.projectAssist(raw);
  }

  /**
   * 读取 Sunshine 真实应用目录与固定 WireGuard 主机，不暴露 Basic 凭据或本地路径。
   * @returns 移动端游戏目录快照。
   */
  async getGameSnapshot(): Promise<MobileGameSnapshotResponse> {
    const [source, vigemStatus] = await Promise.all([
      this.sunshine.apps(),
      this.sunshine.vigemStatus(),
    ]);
    const apps: MobileGameAppSnapshot[] = [];
    for (const app of source.apps || []) {
      const name = `${app.name || ''}`.trim();
      if (!name) continue;
      const id = `${app.uuid || ''}`.trim() || this.stableId(name);
      const snapshot: MobileGameAppSnapshot = { id, name };
      const imagePath = `${app['image-path'] || ''}`.trim();
      if (/^https?:\/\//iu.test(imagePath)) snapshot.imagePath = imagePath;
      apps.push(snapshot);
    }
    return {
      apps,
      generatedAt: new Date().toISOString(),
      host: this.sunshine.host(),
      httpsPort: this.sunshine.httpsPort(),
      managementReady: true,
      streamPort: this.sunshine.streamPort(),
      virtualGamepadReady:
        vigemStatus.installed === true &&
        vigemStatus.version_compatible === true,
    };
  }

  /**
   * 校验四位临时 PIN 与客户端名称后提交 Sunshine 配对确认。
   * @param pin - 四位十进制配对码。
   * @param name - 当前 KwiCore 客户端名称。
   * @returns Sunshine 是否接受配对确认。
   * @throws PIN 或客户端名称不满足固定格式时抛出 400。
   */
  async submitGamePin(
    pin: string,
    name: string,
  ): Promise<MobileGamePinResponse> {
    if (!/^\d{4}$/u.test(pin))
      throw new BadRequestException('配对码必须为四位数字');
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 64) {
      throw new BadRequestException('客户端名称无效');
    }
    return { accepted: await this.sunshine.submitPin(pin, normalizedName) };
  }

  /**
   * 把站内信管理对象收敛为移动端所需白名单，排除去重键、接收人和内部元数据。
   * @param notice - 站内信服务返回的单条管理对象。
   * @returns 只含移动端展示字段和显式时间字段的通知投影。
   */
  private projectNotice(notice: AdminNoticePageItem): MobileHomeNoticeItem {
    return {
      content: notice.content,
      createTime: notice.createTime,
      eventType: notice.eventType,
      id: notice.id,
      isTop: notice.isTop,
      lastSeenAt: notice.lastSeenAt,
      occurrenceCount: notice.occurrenceCount,
      severity: notice.severity,
      source: notice.source,
      status: notice.status,
      summary: notice.summary,
      title: notice.title,
    };
  }

  /**
   * 把单条 HA state 与 registry 映射为移动实体，并只保留允许的 attributes。
   * @param state - Home Assistant 实体状态。
   * @param registry - 实体注册表项。
   * @param devices - 设备注册表索引。
   * @returns 脱敏实体投影。
   */
  private projectEntity(
    state: HomeAssistantStatePayload,
    registry: HomeAssistantEntityRegistryPayload | undefined,
    devices: Map<string, HomeAssistantDevicePayload>,
  ): MobileHomeEntitySnapshot {
    const attributes = state.attributes || {};
    const deviceId = registry?.device_id || undefined;
    let device: HomeAssistantDevicePayload | undefined;
    if (deviceId) device = devices.get(deviceId);
    const areaId = registry?.area_id || device?.area_id || undefined;
    const friendlyName = `${attributes.friendly_name || ''}`.trim();
    const registryName =
      `${registry?.name || registry?.original_name || ''}`.trim();
    return {
      areaId,
      attributes: this.projectAttributes(attributes),
      deviceId,
      domain: this.domainOf(state.entity_id),
      entityId: state.entity_id,
      name: this.localizeEntityName(
        friendlyName || registryName || state.entity_id,
        state.entity_id,
      ),
      state: state.state,
      updatedAt: state.last_updated || state.last_changed,
    };
  }

  /**
   * 把 scene、script 与 automation state 统一为可展示动作。
   * @param state - Home Assistant 动作实体状态。
   * @returns 场景或自动化投影。
   */
  private projectScene(
    state: HomeAssistantStatePayload,
  ): MobileHomeSceneSnapshot {
    const domain = this.domainOf(state.entity_id) as
      | 'automation'
      | 'scene'
      | 'script';
    const friendlyName = `${state.attributes?.friendly_name || ''}`.trim();
    let enabled = true;
    if (domain === 'automation' && state.state === 'off') enabled = false;
    return {
      domain,
      enabled,
      entityId: state.entity_id,
      lastChanged: state.last_changed,
      name: this.localizeEntityName(
        friendlyName || state.entity_id,
        state.entity_id,
      ),
    };
  }

  /**
   * 把 logbook 项压缩为稳定活动摘要，不返回 context 或原始事件数据。
   * @param entry - Home Assistant logbook 项。
   * @param index - 当前返回窗口中的稳定顺序。
   * @returns 移动活动投影。
   */
  private projectActivity(
    entry: HomeAssistantLogbookPayload,
    index: number,
  ): MobileHomeActivitySnapshot {
    const localizedName = this.localizeEntityName(
      `${entry.name || ''}`,
      `${entry.entity_id || ''}`,
    );
    const parts = [localizedName, entry.message]
      .map((item) => `${item || ''}`.trim())
      .filter(Boolean);
    const state = `${entry.state || ''}`.trim();
    if (
      state &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(state) &&
      !parts.includes(state)
    ) {
      parts.push(state);
    }
    const summary = parts.join(' · ') || 'Home Assistant 状态变化';
    let severity: 'info' | 'success' | 'warning' = 'info';
    if (/unavailable|unknown|alarm|leak|smoke|异常|失败|告警/iu.test(summary)) {
      severity = 'warning';
    } else if (/locked|closed|normal|恢复|上锁|关闭/iu.test(summary)) {
      severity = 'success';
    }
    return {
      entityId: entry.entity_id,
      id: this.stableId(`${entry.when}:${entry.entity_id || ''}:${index}`),
      observedAt: entry.when,
      severity,
      summary,
    };
  }

  /**
   * 为能源与功率实体读取 24 小时真实历史，并拒绝把非数值状态写入趋势。
   * @param source - Home Assistant 原始快照。
   * @param entityRegistry - 实体注册表索引。
   * @param devices - 设备注册表索引。
   * @returns 能源实体当前值和真实历史点。
   */
  private async projectEnergy(
    source: HomeAssistantSnapshotPayload,
    entityRegistry: Map<string, HomeAssistantEntityRegistryPayload>,
    devices: Map<string, HomeAssistantDevicePayload>,
  ): Promise<MobileHomeEnergyEntitySnapshot[]> {
    const energyStates = source.states.filter((state) => {
      const deviceClass =
        `${state.attributes?.device_class || ''}`.toLowerCase();
      return ENERGY_DEVICE_CLASSES.has(deviceClass);
    });
    if (energyStates.length === 0) return [];
    const end = new Date();
    const start = new Date(end.getTime() - HOME_HISTORY_WINDOW_MS);
    const history = await this.homeAssistant.history(
      energyStates.map((state) => state.entity_id),
      start.toISOString(),
      end.toISOString(),
    );
    const historyByEntity = new Map<string, HomeAssistantStatePayload[]>();
    for (const series of history) {
      const entityId = series.find((item) => item.entity_id)?.entity_id;
      if (entityId) historyByEntity.set(entityId, series);
    }
    return energyStates
      .map((state) => {
        const current = Number(state.state);
        if (!Number.isFinite(current)) return null;
        const entity = this.projectEntity(
          state,
          entityRegistry.get(state.entity_id),
          devices,
        );
        const points = (historyByEntity.get(state.entity_id) || [])
          .map((item) => ({
            observedAt: item.last_updated || item.last_changed || '',
            value: Number(item.state),
          }))
          .filter((point) => point.observedAt && Number.isFinite(point.value));
        return {
          entityId: entity.entityId,
          name: entity.name,
          points,
          state: current,
          unit: `${state.attributes?.unit_of_measurement || ''}`,
        };
      })
      .filter((item): item is MobileHomeEnergyEntitySnapshot => item !== null);
  }

  /**
   * 只投影移动端明确需要的 attributes，并拒绝对象和任意长数组。
   * @param attributes - Home Assistant 原始 attributes。
   * @returns 键名有序的白名单属性列表。
   */
  private projectAttributes(
    attributes: Record<string, unknown>,
  ): MobileHomeEntityAttributeSnapshot[] {
    const result: MobileHomeEntityAttributeSnapshot[] = [];
    for (const key of [...MOBILE_ATTRIBUTE_KEYS].sort()) {
      if (!(key in attributes)) continue;
      const value = this.projectAttributeValue(attributes[key]);
      if (value === undefined) continue;
      result.push({ key, value });
    }
    return result;
  }

  /**
   * 接纳属性中的标量和最多四项数值数组，其他复杂值保持缺失。
   * @param value - Home Assistant attribute 值。
   * @returns 可安全序列化的移动属性值或 undefined。
   */
  private projectAttributeValue(
    value: unknown,
  ): boolean | number | string | null | number[] | undefined {
    if (value === null) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.length <= 256) return value;
    if (
      Array.isArray(value) &&
      value.length <= 4 &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ) {
      return value as number[];
    }
    return undefined;
  }

  /**
   * 校验服务调用的幂等键、实体前缀、domain 与 service 白名单。
   * @param input - 移动服务调用请求。
   * @throws 任何字段越界或 domain/service 不匹配时抛出 400。
   */
  private validateServiceCall(input: MobileHomeServiceCallRequest): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/u.test(input.requestId)) {
      throw new BadRequestException('requestId 无效');
    }
    if (this.domainOf(input.entityId) !== input.domain) {
      throw new BadRequestException('实体与 domain 不匹配');
    }
    const services = HOME_SERVICE_ALLOWLIST.get(input.domain);
    if (!services?.has(input.service)) {
      throw new BadRequestException('Home Assistant 服务不在移动白名单');
    }
  }

  /**
   * 只保留当前移动控制合同允许的服务参数。
   * @param data - 用户提交的服务参数。
   * @returns 白名单参数。
   * @throws 出现任意未知参数时抛出 400。
   */
  private projectServiceData(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!HOME_SERVICE_DATA_KEYS.has(key)) {
        throw new BadRequestException(`不允许的 Home Assistant 参数: ${key}`);
      }
      const projected = this.projectAttributeValue(value);
      if (projected === undefined) {
        throw new BadRequestException(`Home Assistant 参数类型无效: ${key}`);
      }
      result[key] = projected;
    }
    return result;
  }

  /**
   * 从 Home Assistant Conversation API 中读取纯文本与会话状态，不透传 card 或原始 data。
   * @param raw - Conversation API 原始响应。
   * @returns 脱敏 Assist 投影。
   * @throws 响应缺少纯文本时拒绝返回伪结果。
   */
  private projectAssist(raw: unknown): MobileHomeAssistResponse {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Home Assistant Assist 返回无效响应');
    }
    const root = raw as Record<string, unknown>;
    const response = root.response as Record<string, unknown> | undefined;
    const speech = response?.speech as Record<string, unknown> | undefined;
    const plain = speech?.plain as Record<string, unknown> | undefined;
    const text = `${plain?.speech || ''}`.trim();
    if (!text) throw new Error('Home Assistant Assist 未返回纯文本');
    return {
      continueConversation: root.continue_conversation === true,
      conversationId: `${root.conversation_id || ''}`.trim() || undefined,
      responseType: `${response?.response_type || 'action_done'}`,
      speech: text,
    };
  }

  /**
   * 清除超过五分钟的服务调用幂等结果，避免内存缓存无限增长。
   */
  private cleanupServiceCallCache(): void {
    const now = Date.now();
    for (const [requestId, entry] of this.serviceCallCache) {
      if (entry.expiresAt <= now) this.serviceCallCache.delete(requestId);
    }
  }

  /**
   * 从实体 ID 读取首段 domain；非法 ID 返回空字符串。
   * @param entityId - Home Assistant 实体标识。
   * @returns 点号前的 domain。
   */
  private domainOf(entityId: string): string {
    const separator = entityId.indexOf('.');
    if (separator <= 0) return '';
    return entityId.slice(0, separator);
  }

  /**
   * 按区域名称和稳定 ID 的规范键匹配常见中文区域，未知用户自定义名称保持原文。
   * @param name - Home Assistant 区域显示名。
   * @param id - Home Assistant 稳定区域标识。
   * @returns 已知常见区域的中文名或原始显示名。
   */
  private localizeAreaName(name: string, id: string): string {
    const nameMatch = HOME_AREA_LOCALIZATION.get(this.homeNameKey(name));
    if (nameMatch) return nameMatch;
    const idMatch = HOME_AREA_LOCALIZATION.get(this.homeNameKey(id));
    if (idMatch) return idMatch;
    return name;
  }

  /**
   * 按稳定 entityId 本土化 HA 内置系统实体，用户自定义 friendly_name 保持权威原文。
   * @param name - registry 或 state 提供的实体显示名。
   * @param entityId - Home Assistant 稳定实体标识。
   * @returns 已知系统实体的中文名或原始显示名。
   */
  private localizeEntityName(name: string, entityId: string): string {
    const localized = HOME_ENTITY_LOCALIZATION.get(entityId);
    if (localized) return localized;
    return name;
  }

  /**
   * 把区域名称的大小写、下划线、连字符与连续空白收敛为同一匹配键。
   * @param value - 区域名称或区域 ID。
   * @returns 用单空格分隔的小写匹配键。
   */
  private homeNameKey(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replaceAll(/[_-]+/gu, ' ')
      .replaceAll(/\s+/gu, ' ');
  }

  /**
   * 为未提供 UUID 的目录项生成不可逆稳定标识。
   * @param value - 目录项稳定名称或事件身份。
   * @returns 24 位十六进制摘要。
   */
  private stableId(value: string): string {
    return createHash('sha256')
      .update(value, 'utf8')
      .digest('hex')
      .slice(0, 24);
  }
}
