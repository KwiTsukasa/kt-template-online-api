import { isIP } from 'node:net';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Not, type EntityManager } from 'typeorm';
import * as mqtt from 'mqtt';
import type { IClientOptions, MqttClient } from 'mqtt';
import { KtDateTime } from '@/common';
import {
  SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
  SYSTEM_MESSAGE_EVENT_STAGER,
  type SystemMessageDeliveryCoordinator,
  type SystemMessageEventStager,
} from '@/modules/message-management/contract/message-management.types';
import { NetworkAgentState } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import { NetworkEndpointHistory } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-endpoint-history.entity';
import { NetworkDdnsService } from '@/modules/admin/platform-config/network-management/application/network-ddns.service';
import { NetworkManagementEventStreamService } from '@/modules/admin/platform-config/network-management/application/network-management-event-stream.service';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { NetworkPortForwardGroup } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import { NetworkTcpReleasePolicyService } from '@/modules/admin/platform-config/network-management/application/network-tcp-release-policy.service';
import {
  buildDesiredSnapshotV2,
  compareNetworkV2Timestamps,
  endpointLeaseIdentityV2,
  NetworkV2MessageValidationError,
  parseEndpointEventV2,
  parseReportedSnapshotV2,
  parseStatusSnapshotV2,
  type NetworkDesiredChannelV2,
  type NetworkEndpointEventV2,
  type NetworkEndpointLeaseV2,
  type NetworkReportedChannelV2,
  type NetworkReportedSnapshotV2,
  type NetworkStatusSnapshotV2,
} from '@/modules/admin/platform-config/network-management/contract/network-agent-v2.types';
import {
  buildDesiredSnapshot,
  desiredSnapshotDigest,
  desiredSnapshotBytes,
  NetworkMessageValidationError,
  parseEndpointEvent,
  parseReportedSnapshot,
  parseStatusSnapshot,
  type NetworkEndpointEvent,
  type NetworkReportedSnapshot,
  type NetworkStateChangeSource,
  type NetworkStatusSnapshot,
} from '@/modules/admin/platform-config/network-management/contract/network-management.types';

const DEFAULT_AGENT_ID = 'nas-main';
const DEFAULT_CLIENT_ID = 'kt-template-online-api-network-nas-main';
const DEFAULT_RETRY_MS = 5000;
const MAX_MESSAGE_BYTES = 256 * 1024;

export const NETWORK_MQTT_CLIENT_FACTORY = Symbol(
  'NETWORK_MQTT_CLIENT_FACTORY',
);

export type NetworkMqttClientFactory = (
  url: string,
  options: IClientOptions,
) => MqttClient;

@Injectable()
export class NetworkAgentMqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NetworkAgentMqttService.name);
  private client: MqttClient | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private publishPromise: Promise<void> | null = null;
  private publishRequested = false;
  private forcePublishRequested = false;
  private recoveryInProgress = false;
  private shuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly eventStream: NetworkManagementEventStreamService,
    @Inject(SYSTEM_MESSAGE_EVENT_STAGER)
    private readonly eventStager: SystemMessageEventStager,
    @Inject(SYSTEM_MESSAGE_DELIVERY_COORDINATOR)
    private readonly deliveryCoordinator: SystemMessageDeliveryCoordinator,
    @Optional()
    @Inject(NETWORK_MQTT_CLIENT_FACTORY)
    private readonly clientFactory?: NetworkMqttClientFactory,
    @Optional()
    private readonly ddnsService?: NetworkDdnsService,
    @Optional()
    private readonly releasePolicy?: NetworkTcpReleasePolicyService,
  ) {}

  onModuleInit(): void {
    const url = this.configService.get<string>('NETWORK_AGENT_MQTT_URL');
    if (!url) {
      this.logger.warn('Network Agent MQTT is not configured');
      return;
    }

    const factory = this.clientFactory || mqtt.connect;
    this.client = factory(url, {
      clean: false,
      clientId:
        this.configService.get<string>('NETWORK_AGENT_MQTT_CLIENT_ID') ||
        DEFAULT_CLIENT_ID,
      customHandleAcks: (topic, payload, _packet, callback) => {
        void this.acknowledgeIncoming(topic, payload, callback);
      },
      password: this.configService.get<string>('NETWORK_AGENT_MQTT_PASSWORD'),
      protocolVersion: 5,
      properties: { sessionExpiryInterval: 7 * 24 * 60 * 60 },
      reconnectPeriod: this.retryMs(),
      resubscribe: true,
      username: this.configService.get<string>('NETWORK_AGENT_MQTT_USERNAME'),
    });
    this.client.on('connect', () => this.handleConnect());
    this.client.on('error', (error) => this.handleClientError(error));

    this.retryTimer = setInterval(() => {
      this.requestDesiredPublish();
    }, this.retryMs());
    this.retryTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
    const client = this.client;
    if (!client) return;
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => resolve());
    });
    if (this.client === client) this.client = null;
    this.recoveryInProgress = false;
  }

  /**
   * 按当前运行态投递发布期望状态。
   */
  requestDesiredPublish(): void {
    this.publishRequested = true;
    this.startPublishDrain();
  }

  /**
   * 按`force`投递最新的期望的。
   * @param force - 决定是否启用“force”分支的布尔选项；省略时默认采用 `false`。
   * @returns 满足最新的期望的约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async publishLatestDesired(force = false): Promise<boolean> {
    if (!this.client?.connected) return false;
    const publication = await this.dataSource.transaction(async (manager) => {
      const state = await manager.getRepository(NetworkAgentState).findOne({
        where: { agentId: this.agentId() },
      });
      if (!state || BigInt(state.desiredRevision) === 0n) return null;
      const desiredSchemaVersion: 1 | 2 = (() => {
        if (state.desiredSchemaVersion === 2) {
          return 2;
        }
        return 1;
      })();
      const publishedSchemaVersion: 1 | 2 = (() => {
        if (state.publishedSchemaVersion === 2) {
          return 2;
        }
        return 1;
      })();
      if (
        !force &&
        BigInt(state.publishedRevision) >= BigInt(state.desiredRevision) &&
        publishedSchemaVersion === desiredSchemaVersion
      ) {
        return null;
      }
      const mappings = await manager.getRepository(NetworkPortForward).find({
        where: { isDeleted: false },
      });
      if (desiredSchemaVersion === 2) {
        const snapshot = buildDesiredSnapshotV2(state, mappings);
        return {
          payload: Buffer.from(JSON.stringify(snapshot), 'utf8'),
          publishedSchemaVersion,
          revision: String(snapshot.snapshotRevision),
          schemaVersion: 2 as const,
        };
      }
      const snapshot = buildDesiredSnapshot(state, mappings);
      return {
        payload: desiredSnapshotBytes(snapshot),
        publishedSchemaVersion,
        revision: String(snapshot.revision),
        schemaVersion: 1 as const,
      };
    });
    if (!publication) return false;
    if (publication.publishedSchemaVersion !== publication.schemaVersion) {
      await this.publishWithPuback(
        this.topic(publication.publishedSchemaVersion, 'desired'),
        Buffer.alloc(0),
      );
    }
    await this.publishWithPuback(
      this.topic(publication.schemaVersion, 'desired'),
      publication.payload,
    );
    await this.markRevisionPublished(
      publication.revision,
      publication.schemaVersion,
    );
    return true;
  }

  /**
   * 根据`topic`、`payload`处理消费消息。
   * @param topic - 负责完成消费消息外部交互的受控能力。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `byteLength`、`toString` 字段。
   * @throws 当 `payload.byteLength > MAX_MESSAGE_BYTES` 成立时拒绝当前输入并抛出 `NetworkMessageValidationError`；当 `JSON.parse` 或 `payload.toString` 调用失败时拒绝当前输入并抛出 `NetworkMessageValidationError`；
   *   当 `topic === this.topic(2, 'events')` 成立时拒绝当前输入并抛出 `NetworkMessageValidationError`。
   */
  async consumeMessage(topic: string, payload: Buffer): Promise<void> {
    if (payload.byteLength > MAX_MESSAGE_BYTES) {
      throw new NetworkMessageValidationError('Network MQTT message too large');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.toString('utf8'));
    } catch {
      throw new NetworkMessageValidationError('Invalid network MQTT JSON');
    }

    let changed = false;
    let ddnsSourceChanged = false;
    let deliveryWake = false;
    let source: NetworkStateChangeSource;
    if (topic === this.topic(1, 'reported')) {
      source = 'reported';
      const result = await this.applyReported(parseReportedSnapshot(parsed));
      changed = result.visibleStateChanged;
      ddnsSourceChanged = result.ddnsSourceChanged;
    } else if (topic === this.topic(2, 'reported')) {
      source = 'reported';
      const result = await this.applyReportedV2(
        parseReportedSnapshotV2(payload),
      );
      changed = result.visibleStateChanged;
      ddnsSourceChanged = result.ddnsSourceChanged;
      deliveryWake = result.deliveryAccepted;
    } else if (topic === this.topic(1, 'status')) {
      source = 'status';
      const result = await this.applyStatus(parseStatusSnapshot(parsed));
      changed = result.visibleStateChanged;
      ddnsSourceChanged = result.ddnsSourceChanged;
    } else if (topic === this.topic(2, 'status')) {
      source = 'status';
      const result = await this.applyV2Status(parseStatusSnapshotV2(payload));
      changed = result.visibleStateChanged;
      ddnsSourceChanged = result.ddnsSourceChanged;
    } else if (topic === this.topic(1, 'events')) {
      source = 'events';
      const endpointResult = await this.appendEndpointEvent(
        parseEndpointEvent(parsed),
      );
      changed = endpointResult.changed;
      deliveryWake = endpointResult.deliveryAccepted;
    } else if (topic === this.topic(2, 'events')) {
      source = 'events';
      const endpointResult = await this.appendEndpointEventV2(
        parseEndpointEventV2(payload),
      );
      changed = endpointResult.changed;
      deliveryWake = endpointResult.deliveryAccepted;
    } else {
      throw new NetworkMessageValidationError('Unexpected network MQTT topic');
    }
    if (deliveryWake) {
      try {
        this.deliveryCoordinator.requestDrain();
      } catch {
        this.logger.warn('System message delivery wake failed');
      }
    }
    if (changed) this.eventStream.publishCommitted(source);
    if (ddnsSourceChanged) this.ddnsService?.requestReconcile();
  }

  /**
   * 根据当前运行态处理连接事件。
   */
  private handleConnect(): void {
    const client = this.client;
    if (this.shuttingDown || !client) return;
    this.recoveryInProgress = false;
    client.subscribe(
      {
        [this.topic(1, 'reported')]: { qos: 1 },
        [this.topic(1, 'status')]: { qos: 1 },
        [this.topic(1, 'events')]: { qos: 1 },
        [this.topic(2, 'reported')]: { qos: 1 },
        [this.topic(2, 'status')]: { qos: 1 },
        [this.topic(2, 'events')]: { qos: 1 },
      },
      (error) => {
        if (this.shuttingDown || this.client !== client) return;
        if (error) {
          this.logger.warn('Network MQTT subscription failed');
          this.recoverClient();
          return;
        }
        this.forcePublishRequested = true;
        this.requestDesiredPublish();
      },
    );
  }

  /**
   * 根据`topic`、`payload`、`callback`处理入站消息后执行确认回调；当 `error instanceof NetworkMessageValidationError || error insta…` 成立时直接结束且不产生返回值。
   * @param topic - 决定入站消息后执行确认回调内容、边界或目标的 `topic` 值。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   * @param callback - 在当前锁、事务或错误边界内执行的受控回调。
   */
  private async acknowledgeIncoming(
    topic: string,
    payload: Buffer,
    callback: (error: Error | number, code?: number) => void,
  ): Promise<void> {
    try {
      await this.consumeMessage(topic, payload);
      callback(0);
    } catch (error) {
      if (
        error instanceof NetworkMessageValidationError ||
        error instanceof NetworkV2MessageValidationError
      ) {
        this.logger.warn(error.message);
        callback(0);
        return;
      }
      callback(
        (() => {
          if (error instanceof Error) {
            return error;
          }
          return new Error('Network MQTT database transaction failed');
        })(),
      );
    }
  }

  /**
   * 按当前运行态启动发布请求排空流程。
   */
  private startPublishDrain(): void {
    if (this.publishPromise) return;
    this.publishPromise = this.drainPublishRequests().finally(() => {
      this.publishPromise = null;
      if (this.publishRequested) this.startPublishDrain();
    });
  }

  /**
   * 根据当前运行态处理排空待发布请求。
   */
  private async drainPublishRequests(): Promise<void> {
    while (this.publishRequested) {
      const force = this.forcePublishRequested;
      this.publishRequested = false;
      this.forcePublishRequested = false;
      try {
        await this.publishLatestDesired(force);
      } catch {
        this.publishRequested = false;
        this.forcePublishRequested ||= force;
        this.logger.warn('Network desired snapshot publication failed');
        return;
      }
    }
  }

  /**
   * 按`topic`、`payload`投递消息并等待发布确认。
   * @param topic - 决定消息并等待发布确认内容、边界或目标的 `topic` 值。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   * @throws 当 `!client?.connected` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async publishWithPuback(
    topic: string,
    payload: Buffer,
  ): Promise<void> {
    const client = this.client;
    if (!client?.connected) throw new Error('Network MQTT disconnected');
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, { qos: 1, retain: true }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  /**
   * 根据`revision`、`schemaVersion`处理标记版本已发布的。
   * @param revision - 决定标记版本已发布的内容、边界或目标的 `revision` 值。
   * @param schemaVersion - 决定标记版本已发布的内容、边界或目标的 `schemaVersion` 值。
   */
  private async markRevisionPublished(
    revision: string,
    schemaVersion: 1 | 2,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NetworkAgentState);
      const state = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: this.agentId() },
      });
      if (!state) return;
      const confirmed = BigInt(revision);
      const desiredSchemaVersion = (() => {
        if (state.desiredSchemaVersion === 2) {
          return 2;
        }
        return 1;
      })();
      if (
        confirmed <= BigInt(state.desiredRevision) &&
        desiredSchemaVersion === schemaVersion &&
        (confirmed > BigInt(state.publishedRevision) ||
          state.publishedSchemaVersion !== schemaVersion)
      ) {
        state.publishedRevision = revision;
        state.publishedSchemaVersion = schemaVersion;
        await repository.save(state);
      }
    });
  }

  /**
   * 根据`report`更新已报告的；先通过 `assertAgentId` 校验输入边界。
   * @param report - 用于已报告的的领域对象，包含 `agentId`、`appliedRevision`、`desiredDigest`、`mappings` 字段。
   * @returns 包含 `ddnsSourceChanged`、`visibleStateChanged` 字段的已报告的。
   */
  private async applyReported(report: NetworkReportedSnapshot): Promise<{
    ddnsSourceChanged: boolean;
    visibleStateChanged: boolean;
  }> {
    this.assertAgentId(report.agentId);
    const result = await this.dataSource.transaction(async (manager) => {
      const stateRepository = manager.getRepository(NetworkAgentState);
      const mappingRepository = manager.getRepository(NetworkPortForward);
      const state = await stateRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: report.agentId },
      });
      if (
        !state ||
        BigInt(report.appliedRevision) > BigInt(state.desiredRevision)
      ) {
        throw new NetworkMessageValidationError('Invalid reported revision');
      }
      if (state.desiredSchemaVersion >= 2 || state.appliedSchemaVersion >= 2) {
        return {
          ddnsSourceChanged: false,
          desiredChanged: false,
          visibleStateChanged: false,
        };
      }
      if (BigInt(report.appliedRevision) < BigInt(state.appliedRevision)) {
        return {
          ddnsSourceChanged: false,
          desiredChanged: false,
          visibleStateChanged: false,
        };
      }
      const stateBefore = this.reportedAgentStateFingerprint(state);
      let ddnsSourceChanged = false;
      let visibleStateChanged = false;
      const isCurrentRevision =
        BigInt(report.appliedRevision) === BigInt(state.desiredRevision);
      const desiredMappings = await mappingRepository.find({
        where: { isDeleted: false },
      });
      if (isCurrentRevision) {
        const currentSnapshot = buildDesiredSnapshot(state, desiredMappings);
        if (desiredSnapshotDigest(currentSnapshot) !== report.desiredDigest) {
          throw new NetworkMessageValidationError(
            'Reported desired digest does not match current revision',
          );
        }
      }
      const mappingById = new Map(
        desiredMappings.map((mapping) => [mapping.id, mapping]),
      );
      const finalizedIds = new Set<string>();
      const finalizedGroupIds = new Set<string>();
      let finalizedDeletion = false;
      for (const item of report.mappings) {
        const mapping = mappingById.get(item.id);
        if (mapping) continue;
        if (isCurrentRevision) {
          throw new NetworkMessageValidationError(
            'Unknown mapping in current reported snapshot',
          );
        }
        const historical = await mappingRepository.findOne({
          where: { id: item.id },
        });
        if (
          historical?.isDeleted &&
          item.desiredState === 'absent' &&
          item.syncStatus === 'synced'
        ) {
          finalizedIds.add(item.id);
        } else {
          throw new NetworkMessageValidationError('Unknown reported mapping');
        }
      }
      if (isCurrentRevision) {
        const reportedIds = new Set(report.mappings.map((item) => item.id));
        if (desiredMappings.some((mapping) => !reportedIds.has(mapping.id))) {
          throw new NetworkMessageValidationError(
            'Incomplete current reported snapshot',
          );
        }
      }

      for (const item of report.mappings) {
        if (finalizedIds.has(item.id)) continue;
        const mapping = mappingById.get(item.id) as NetworkPortForward;
        if (BigInt(item.revision) < BigInt(mapping.desiredRevision)) {
          continue;
        }
        if (item.desiredState !== mapping.desiredPresence) {
          throw new NetworkMessageValidationError(
            'Reported mapping desired state does not match',
          );
        }
        if (item.keeperDesiredEnabled !== mapping.keeperDesiredEnabled) {
          throw new NetworkMessageValidationError(
            'Reported mapping Keeper intent does not match',
          );
        }
        const persistedMappingBefore =
          this.reportedPersistedMappingStateFingerprint(mapping);
        const refreshMappingBefore =
          this.reportedRefreshMappingStateFingerprint(mapping);
        const publicIpv4Before = mapping.currentPublicIpv4;
        mapping.reportedRevision = String(item.revision);
        mapping.syncStatus = item.syncStatus;
        mapping.keeperStatus = item.keeperStatus;
        mapping.lastErrorCode = item.errorCode || null;
        mapping.lastErrorMessage = item.errorMessage || null;
        this.applyReportedEndpoints(
          mapping,
          item.currentEndpoint,
          item.lastObservedEndpoint,
          report.reportedAt,
        );
        if (mapping.currentPublicIpv4 !== publicIpv4Before) {
          ddnsSourceChanged = true;
        }

        const deletionStateMatches =
          mapping.desiredPresence === 'absent' &&
          item.desiredState === 'absent' &&
          item.syncStatus === 'synced';
        const routeRemovalConfirmed =
          item.routerPresent === false && item.routePresent === false;
        const helperRevisionConfirmed =
          report.helperStatus === 'confirmed' &&
          report.helperAppliedRevision === report.appliedRevision;
        const keeperRemovalConfirmed =
          item.keeperDesiredEnabled === false &&
          item.keeperStatus === 'disabled' &&
          !item.currentEndpoint;
        if (
          deletionStateMatches &&
          routeRemovalConfirmed &&
          helperRevisionConfirmed &&
          keeperRemovalConfirmed
        ) {
          mapping.activeKey = null;
          mapping.activeGroupProtocolKey = null;
          mapping.isDeleted = true;
          finalizedDeletion = true;
          finalizedGroupIds.add(mapping.groupId);
        }
        if (
          this.reportedPersistedMappingStateFingerprint(mapping) !==
          persistedMappingBefore
        ) {
          await mappingRepository.save(mapping);
        }
        if (
          this.reportedRefreshMappingStateFingerprint(mapping) !==
          refreshMappingBefore
        ) {
          visibleStateChanged = true;
        }
      }

      for (const groupId of finalizedGroupIds) {
        const groupChannels = await mappingRepository.find({
          where: { groupId },
        });
        if (
          groupChannels.length === 0 ||
          groupChannels.some((mapping) => !mapping.isDeleted)
        ) {
          continue;
        }
        const groupRepository = manager.getRepository(NetworkPortForwardGroup);
        const group = await groupRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id: groupId },
        });
        if (group && !group.isDeleted) {
          group.isDeleted = true;
          await groupRepository.save(group);
          visibleStateChanged = true;
        }
      }

      if (BigInt(report.appliedRevision) > BigInt(state.appliedRevision)) {
        state.appliedRevision = String(report.appliedRevision);
      }
      state.appliedSchemaVersion = 1;
      const failedMapping = report.mappings.find(
        (item) =>
          item.syncStatus === 'conflict' || item.syncStatus === 'failed',
      );
      if (failedMapping) {
        state.lastReconcileErrorCode =
          failedMapping.errorCode || `sync_${failedMapping.syncStatus}`;
      } else {
        if (report.helperStatus === 'failed') {
          state.lastReconcileErrorCode = 'route_helper_failed';
        } else {
          state.lastReconcileErrorCode = null;
        }
      }
      state.lastReconcileErrorMessage = failedMapping?.errorMessage || null;
      if (finalizedDeletion) {
        state.desiredRevision = (BigInt(state.desiredRevision) + 1n).toString();
        state.desiredIssuedAt = new KtDateTime();
      }
      if (this.reportedAgentStateFingerprint(state) !== stateBefore) {
        visibleStateChanged = true;
        await stateRepository.save(state);
      }
      return {
        ddnsSourceChanged,
        desiredChanged: finalizedDeletion,
        visibleStateChanged,
      };
    });
    if (result.desiredChanged) this.requestDesiredPublish();
    return {
      ddnsSourceChanged: result.ddnsSourceChanged,
      visibleStateChanged: result.visibleStateChanged,
    };
  }

  /**
   * 根据`report`更新已报告的v2；先通过 `assertAgentId` 校验输入边界。
   * @param report - 用于已报告的v2的领域对象，包含 `agentId`、`snapshotRevision`、`snapshotDigest`、`channels` 字段。
   * @returns 包含 `ddnsSourceChanged`、`deliveryAccepted`、`visibleStateChanged` 字段的已报告的v2。
   */
  private async applyReportedV2(report: NetworkReportedSnapshotV2): Promise<{
    ddnsSourceChanged: boolean;
    deliveryAccepted: boolean;
    visibleStateChanged: boolean;
  }> {
    this.assertAgentId(report.agentId);
    const result = await this.dataSource.transaction(async (manager) => {
      const stateRepository = manager.getRepository(NetworkAgentState);
      const mappingRepository = manager.getRepository(NetworkPortForward);
      const groupRepository = manager.getRepository(NetworkPortForwardGroup);
      const state = await stateRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: report.agentId },
      });
      if (!state) {
        throw new NetworkMessageValidationError('Unknown network Agent');
      }
      if (state.desiredSchemaVersion !== 2) {
        return {
          ddnsSourceChanged: false,
          deliveryAccepted: false,
          desiredChanged: false,
          visibleStateChanged: false,
        };
      }
      if (BigInt(report.snapshotRevision) > BigInt(state.desiredRevision)) {
        throw new NetworkMessageValidationError(
          'Invalid v2 reported snapshot revision',
        );
      }
      if (
        BigInt(report.snapshotRevision) < BigInt(state.desiredRevision) ||
        BigInt(report.snapshotRevision) < BigInt(state.appliedRevision)
      ) {
        return {
          ddnsSourceChanged: false,
          deliveryAccepted: false,
          desiredChanged: false,
          visibleStateChanged: false,
        };
      }

      const unlockedDesiredChannels = await mappingRepository.find({
        where: { isDeleted: false },
      });
      const desiredChannels: NetworkPortForward[] = [];
      for (const channelId of unlockedDesiredChannels
        .map((channel) => channel.id)
        .sort()) {
        const channel = await mappingRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id: channelId },
        });
        if (!channel || channel.isDeleted) {
          throw new NetworkMessageValidationError(
            'V2 desired channel changed during reported transaction',
          );
        }
        desiredChannels.push(channel);
      }
      const desiredSnapshot = buildDesiredSnapshotV2(state, desiredChannels);
      if (desiredSnapshot.snapshotDigest !== report.snapshotDigest) {
        throw new NetworkMessageValidationError(
          'V2 reported snapshot digest does not match current revision',
        );
      }
      const desiredById = new Map(
        desiredSnapshot.channels.map((channel) => [channel.channelId, channel]),
      );
      const mappingById = new Map(
        desiredChannels.map((channel) => [channel.id, channel]),
      );
      const reportById = new Map(
        report.channels.map((channel) => [channel.channelId, channel]),
      );
      const failures: Array<{ code: string; message: null | string }> = [];
      const unknownReportedChannels = report.channels.filter(
        (channel) => !desiredById.has(channel.channelId),
      );
      if (unknownReportedChannels.length > 0) {
        failures.push({
          code: 'reported_channel_unknown',
          message: 'V2 reported snapshot contains an unknown channel',
        });
      }
      let ddnsSourceChanged = false;
      let deliveryAccepted = false;
      let finalizedDeletion = false;
      let visibleStateChanged = false;
      const finalizedGroupIds = new Set<string>();
      const isSameAppliedSnapshot =
        BigInt(report.snapshotRevision) === BigInt(state.appliedRevision);

      for (const desiredChannel of desiredSnapshot.channels) {
        const mapping = mappingById.get(desiredChannel.channelId);
        if (!mapping) continue;
        const item = reportById.get(desiredChannel.channelId);
        const persistedBefore =
          this.v2ReportedPersistedMappingFingerprint(mapping);
        const refreshBefore = this.v2ReportedRefreshMappingFingerprint(mapping);
        const publicIpv4Before = mapping.currentPublicIpv4 || null;
        const lastReportedAtWire =
          mapping.lastReportedAtWire ||
          (() => {
            if (mapping.lastReportedAt) {
              return new Date(mapping.lastReportedAt).toISOString();
            }
            return null;
          })();
        if (
          isSameAppliedSnapshot &&
          lastReportedAtWire &&
          compareNetworkV2Timestamps(report.reportedAt, lastReportedAtWire) < 0
        ) {
          continue;
        }
        mapping.lastReportedAt = new KtDateTime(report.reportedAt);
        mapping.lastReportedAtWire = report.reportedAt;
        if (!item) {
          this.applyV2ReportedConflict(
            mapping,
            undefined,
            report.reportedAt,
            'reported_channel_missing',
            'V2 reported snapshot omitted the desired channel',
          );
          failures.push({
            code: 'reported_channel_missing',
            message: 'V2 reported snapshot omitted the desired channel',
          });
        } else {
          const conflict = this.v2ReportedChannelConflict(
            mapping,
            desiredChannel,
            item,
          );
          if (conflict) {
            this.applyV2ReportedConflict(
              mapping,
              item,
              report.reportedAt,
              conflict.code,
              conflict.message,
            );
            failures.push(conflict);
          } else {
            mapping.reportedRevision = String(item.appliedDesiredRevision);
            mapping.syncStatus = item.syncStatus;
            mapping.lastErrorCode = item.errorCode || null;
            mapping.lastErrorMessage = item.errorMessage || null;
            if (item.protocol === 'tcp') {
              mapping.natmapStatus = item.natmapStatus;
              mapping.natmapLastErrorCode = item.natmapErrorCode || null;
              mapping.natmapLastErrorMessage = item.natmapErrorMessage || null;
              this.applyV2CandidateEndpoint(
                mapping,
                item.candidateEndpoint,
                report.reportedAt,
              );
            } else {
              mapping.keeperStatus = item.keeperStatus;
              mapping.keeperLastErrorCode = item.keeperErrorCode || null;
              mapping.keeperLastErrorMessage = item.keeperErrorMessage || null;
            }
            this.applyV2LastObservedEndpoint(
              mapping,
              item.lastObservedEndpoint,
            );
            const currentTupleBefore = this.currentEndpointTuple(mapping);
            const currentEndpoint = (() => {
              if (
                this.isV2CurrentPublishable(
                  desiredChannel,
                  item,
                  report.reportedAt,
                )
              ) {
                return item.currentEndpoint;
              }
              return undefined;
            })();
            this.applyV2CurrentEndpoint(
              mapping,
              currentEndpoint,
              report.reportedAt,
            );
            this.updateLastPublishedBaseline(mapping);
            const currentTupleAfter = this.currentEndpointTuple(mapping);

            if (this.isV2AbsenceConfirmed(item)) {
              mapping.activeKey = null;
              mapping.activeGroupProtocolKey = null;
              mapping.isDeleted = true;
              finalizedDeletion = true;
              finalizedGroupIds.add(mapping.groupId);
            } else if (
              item.syncStatus === 'conflict' ||
              item.syncStatus === 'failed'
            ) {
              failures.push({
                code: item.errorCode || `sync_${item.syncStatus}`,
                message: item.errorMessage || null,
              });
            }

            if (currentTupleBefore !== currentTupleAfter && currentTupleAfter) {
              const accepted = await (async () => {
                if (item.protocol === 'tcp') {
                  return await this.stageMatchingV2TcpHistory(manager, mapping);
                }
                return await this.stageMatchingV2UdpHistory(manager, mapping);
              })();
              deliveryAccepted = accepted || deliveryAccepted;
            }
          }
        }
        if ((mapping.currentPublicIpv4 || null) !== publicIpv4Before) {
          ddnsSourceChanged = true;
        }
        if (
          this.v2ReportedPersistedMappingFingerprint(mapping) !==
          persistedBefore
        ) {
          await mappingRepository.save(mapping);
        }
        if (
          this.v2ReportedRefreshMappingFingerprint(mapping) !== refreshBefore
        ) {
          visibleStateChanged = true;
        }
      }

      for (const groupId of finalizedGroupIds) {
        const groupChannels = await mappingRepository.find({
          where: { groupId },
        });
        if (
          groupChannels.length === 0 ||
          groupChannels.some((channel) => !channel.isDeleted)
        ) {
          continue;
        }
        const group = await groupRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id: groupId },
        });
        if (group && !group.isDeleted) {
          group.isDeleted = true;
          await groupRepository.save(group);
          visibleStateChanged = true;
        }
      }

      const stateBefore = this.reportedAgentStateFingerprint(state);
      if (BigInt(report.snapshotRevision) > BigInt(state.appliedRevision)) {
        state.appliedRevision = String(report.snapshotRevision);
      }
      state.appliedSchemaVersion = 2;
      const persistedFailure = desiredChannels.find(
        (channel) =>
          channel.syncStatus === 'conflict' || channel.syncStatus === 'failed',
      );
      const firstFailure =
        failures[0] ||
        (() => {
          if (persistedFailure) {
            return {
              code:
                persistedFailure.lastErrorCode ||
                `sync_${persistedFailure.syncStatus}`,
              message: persistedFailure.lastErrorMessage || null,
            };
          }
          return undefined;
        })();
      state.lastReconcileErrorCode = firstFailure?.code || null;
      state.lastReconcileErrorMessage = firstFailure?.message || null;
      if (finalizedDeletion) {
        state.desiredRevision = (BigInt(state.desiredRevision) + 1n).toString();
        state.desiredIssuedAt = new KtDateTime();
      }
      if (this.reportedAgentStateFingerprint(state) !== stateBefore) {
        await stateRepository.save(state);
        visibleStateChanged = true;
      }
      return {
        ddnsSourceChanged,
        deliveryAccepted,
        desiredChanged: finalizedDeletion,
        visibleStateChanged,
      };
    });
    if (result.desiredChanged) this.requestDesiredPublish();
    return {
      ddnsSourceChanged: result.ddnsSourceChanged,
      deliveryAccepted: result.deliveryAccepted,
      visibleStateChanged: result.visibleStateChanged,
    };
  }

  /**
   * 按字段约束判定v2已报告的通道冲突。
   * @param mapping - 用于按字段约束判定v2已报告的通道冲突的领域对象，包含 `groupId`、`protocol`、`desiredPresence` 字段。
   * @param desired - 用于按字段约束判定v2已报告的通道冲突的领域对象，包含 `channelDesiredDigest`、`channelDesiredRevision`、`protocol`、`natmapDesiredEnabled` 字段。
   * @param reported - 用于按字段约束判定v2已报告的通道冲突的领域对象，包含 `appliedDesiredDigest`、`appliedDesiredRevision`、`groupId`、`protocol` 字段。
   * @returns 包含 `code`、`message` 字段的按字段约束判定v2已报告的通道冲突；无法解析或未命中时为 `null`。
   */
  private v2ReportedChannelConflict(
    mapping: NetworkPortForward,
    desired: NetworkDesiredChannelV2,
    reported: NetworkReportedChannelV2,
  ): { code: string; message: string } | null {
    if (reported.appliedDesiredDigest !== desired.channelDesiredDigest) {
      return {
        code: 'desired_digest_conflict',
        message: 'V2 reported channel desired digest does not match',
      };
    }
    if (
      reported.appliedDesiredRevision !== desired.channelDesiredRevision ||
      reported.groupId !== mapping.groupId ||
      reported.protocol !== mapping.protocol ||
      reported.desiredPresence !== mapping.desiredPresence
    ) {
      return {
        code: 'reported_channel_identity_conflict',
        message: 'V2 reported channel identity does not match desired state',
      };
    }
    if (
      reported.protocol === 'tcp' &&
      (desired.protocol !== 'tcp' ||
        reported.natmapDesiredEnabled !== desired.natmapDesiredEnabled)
    ) {
      return {
        code: 'reported_channel_intent_conflict',
        message: 'V2 reported channel intent does not match desired state',
      };
    }
    if (
      reported.protocol === 'udp' &&
      (desired.protocol !== 'udp' ||
        reported.keeperDesiredEnabled !== desired.keeperDesiredEnabled)
    ) {
      return {
        code: 'reported_channel_intent_conflict',
        message: 'V2 reported channel intent does not match desired state',
      };
    }
    return null;
  }

  /**
   * 根据`mapping`、`reported`、`reportedAt`更新v2已报告的冲突。
   * @param mapping - 用于v2已报告的冲突的领域对象，包含 `reportedRevision`、`syncStatus`、`lastErrorCode`、`lastErrorMessage` 字段。
   * @param reported - 用于v2已报告的冲突的领域对象，包含 `appliedDesiredRevision` 字段。
   * @param reportedAt - 用于过期、排序或租约判定的时间基准。
   * @param code - 决定v2已报告的冲突内容、边界或目标的 `code` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   */
  private applyV2ReportedConflict(
    mapping: NetworkPortForward,
    reported: NetworkReportedChannelV2 | undefined,
    reportedAt: string,
    code: string,
    message: string,
  ): void {
    if (reported) {
      mapping.reportedRevision = String(reported.appliedDesiredRevision);
    }
    mapping.syncStatus = 'conflict';
    mapping.lastErrorCode = code;
    mapping.lastErrorMessage = message;
    this.applyV2CurrentEndpoint(mapping, undefined, reportedAt);
  }

  /**
   * 根据`mapping`、`endpoint`、`reportedAt`更新v2候选项端点；当 `!endpoint` 成立时直接结束且不产生返回值。
   * @param mapping - 用于v2候选项端点的领域对象，包含 `candidateValidatedAtWire`、`candidateValidatedAt`、`candidatePublicIpv4`、`candidatePublicPort` 字段。
   * @param endpoint - 用于v2候选项端点的领域对象，包含 `validatedAt`、`publicIpv4`、`publicPort`、`observedAt` 字段。
   * @param reportedAt - 用于过期、排序或租约判定的时间基准。
   */
  private applyV2CandidateEndpoint(
    mapping: NetworkPortForward,
    endpoint: NetworkEndpointLeaseV2 | undefined,
    reportedAt: string,
  ): void {
    if (!endpoint) {
      const candidateEvidenceTime =
        mapping.candidateValidatedAtWire ||
        (() => {
          if (mapping.candidateValidatedAt) {
            return new Date(mapping.candidateValidatedAt).toISOString();
          }
          return null;
        })();
      if (
        candidateEvidenceTime &&
        compareNetworkV2Timestamps(reportedAt, candidateEvidenceTime) < 0
      ) {
        return;
      }
      mapping.candidatePublicIpv4 = null;
      mapping.candidatePublicPort = null;
      mapping.candidateObservedAt = null;
      mapping.candidateValidatedAt = null;
      mapping.candidateValidatedAtWire = null;
      return;
    }
    if (
      (mapping.candidateValidatedAtWire || mapping.candidateValidatedAt) &&
      compareNetworkV2Timestamps(
        endpoint.validatedAt,
        mapping.candidateValidatedAtWire ||
          new Date(mapping.candidateValidatedAt as KtDateTime).toISOString(),
      ) < 0
    ) {
      return;
    }
    const sameTuple =
      mapping.candidatePublicIpv4 === endpoint.publicIpv4 &&
      mapping.candidatePublicPort === endpoint.publicPort;
    mapping.candidatePublicIpv4 = endpoint.publicIpv4;
    mapping.candidatePublicPort = endpoint.publicPort;
    if (!sameTuple || !mapping.candidateObservedAt) {
      mapping.candidateObservedAt = new KtDateTime(endpoint.observedAt);
    }
    mapping.candidateValidatedAt = new KtDateTime(endpoint.validatedAt);
    mapping.candidateValidatedAtWire = endpoint.validatedAt;
  }

  /**
   * 根据`mapping`、`endpoint`更新v2上次已观测的端点；当 `(mapping.lastObservedValidatedAtWire || mapping.lastObservedV…` 成立时直接结束且不产生返回值。
   * @param mapping - 用于v2上次已观测的端点的领域对象，包含 `lastObservedValidatedAtWire`、`lastObservedValidatedAt`、`lastObservedIpv4`、`lastObservedPort` 字段。
   * @param endpoint - 用于v2上次已观测的端点的领域对象，包含 `validatedAt`、`publicIpv4`、`publicPort`、`observedAt` 字段。
   */
  private applyV2LastObservedEndpoint(
    mapping: NetworkPortForward,
    endpoint: NetworkEndpointLeaseV2 | undefined,
  ): void {
    if (!endpoint) return;
    if (
      (mapping.lastObservedValidatedAtWire ||
        mapping.lastObservedValidatedAt) &&
      compareNetworkV2Timestamps(
        endpoint.validatedAt,
        mapping.lastObservedValidatedAtWire ||
          new Date(mapping.lastObservedValidatedAt as KtDateTime).toISOString(),
      ) < 0
    ) {
      return;
    }
    const sameTuple =
      mapping.lastObservedIpv4 === endpoint.publicIpv4 &&
      mapping.lastObservedPort === endpoint.publicPort;
    mapping.lastObservedIpv4 = endpoint.publicIpv4;
    mapping.lastObservedPort = endpoint.publicPort;
    if (!sameTuple || !mapping.lastObservedAt) {
      mapping.lastObservedAt = new KtDateTime(endpoint.observedAt);
    }
    mapping.lastObservedValidatedAt = new KtDateTime(endpoint.validatedAt);
    mapping.lastObservedValidatedAtWire = endpoint.validatedAt;
  }

  /**
   * 根据`mapping`、`endpoint`、`reportedAt`更新v2当前端点；当 `!endpoint` 成立时直接结束且不产生返回值。
   * @param mapping - 用于v2当前端点的领域对象，包含 `currentValidatedAtWire`、`currentValidatedAt`、`currentPublicIpv4`、`currentPublicPort` 字段。
   * @param endpoint - 用于v2当前端点的领域对象，包含 `validatedAt`、`publicIpv4`、`publicPort`、`observedAt` 字段。
   * @param reportedAt - 用于过期、排序或租约判定的时间基准。
   */
  private applyV2CurrentEndpoint(
    mapping: NetworkPortForward,
    endpoint: NetworkEndpointLeaseV2 | undefined,
    reportedAt: string,
  ): void {
    if (!endpoint) {
      const currentEvidenceAt =
        mapping.currentValidatedAtWire ||
        (() => {
          if (mapping.currentValidatedAt) {
            return new Date(mapping.currentValidatedAt).toISOString();
          }
          return null;
        })();
      if (
        !currentEvidenceAt ||
        compareNetworkV2Timestamps(reportedAt, currentEvidenceAt) >= 0
      ) {
        this.withdrawV2CurrentEndpoint(mapping);
      }
      return;
    }
    if (
      (mapping.currentValidatedAtWire || mapping.currentValidatedAt) &&
      compareNetworkV2Timestamps(
        endpoint.validatedAt,
        mapping.currentValidatedAtWire ||
          new Date(mapping.currentValidatedAt as KtDateTime).toISOString(),
      ) < 0
    ) {
      return;
    }
    const sameTuple =
      mapping.currentPublicIpv4 === endpoint.publicIpv4 &&
      mapping.currentPublicPort === endpoint.publicPort;
    mapping.currentPublicIpv4 = endpoint.publicIpv4;
    mapping.currentPublicPort = endpoint.publicPort;
    if (!sameTuple || !mapping.currentObservedAt) {
      mapping.currentObservedAt = new KtDateTime(endpoint.observedAt);
    }
    mapping.currentValidatedAt = new KtDateTime(endpoint.validatedAt);
    mapping.currentValidatedAtWire = endpoint.validatedAt;
    mapping.currentValidUntil = new KtDateTime(endpoint.validUntil);
    mapping.currentEndpointIdentity = endpointLeaseIdentityV2(endpoint);
  }

  /**
   * 根据`mapping`处理撤回v2当前端点。
   * @param mapping - 用于撤回v2当前端点的领域对象，包含 `currentPublicIpv4`、`currentPublicPort`、`currentObservedAt`、`currentValidatedAt` 字段。
   */
  private withdrawV2CurrentEndpoint(mapping: NetworkPortForward): void {
    mapping.currentPublicIpv4 = null;
    mapping.currentPublicPort = null;
    mapping.currentObservedAt = null;
    mapping.currentValidatedAt = null;
    mapping.currentValidatedAtWire = null;
    mapping.currentValidUntil = null;
    mapping.currentEndpointIdentity = null;
  }

  /**
   * 更新上次已发布的基线，并会更新 `mapping.lastPublishedPublicIpv4`、`mapping.lastPublishedPublicPort`、`mapping.lastPublishedAt`，在 `mapping.lastPublishedPublicIpv4 === mapping.currentPublicIpv4 && mapping.lastPubl…` 成立时直接结束。
   * @param mapping - 用于LastPublishedBaseline的领域对象，包含 `currentPublicIpv4`、`currentPublicPort`、`lastPublishedPublicIpv4`、`lastPublishedPublicPort` 字段。
   */
  private updateLastPublishedBaseline(mapping: NetworkPortForward): void {
    if (!mapping.currentPublicIpv4 || !mapping.currentPublicPort) return;
    if (
      mapping.lastPublishedPublicIpv4 === mapping.currentPublicIpv4 &&
      mapping.lastPublishedPublicPort === mapping.currentPublicPort
    ) {
      return;
    }
    mapping.lastPublishedPublicIpv4 = mapping.currentPublicIpv4;
    mapping.lastPublishedPublicPort = mapping.currentPublicPort;
    if (mapping.currentValidatedAt) {
      mapping.lastPublishedAt = new KtDateTime(mapping.currentValidatedAt);
    } else {
      mapping.lastPublishedAt = new KtDateTime();
    }
  }

  /**
   * 根据`desired`、`reported`、`reportedAt`与当前约束判定v2当前可发布的；当 `reported.syncStatus !== 'synced' || !reported.routerPresent` 成立时返回 `false`。
   * @param desired - 用于v2当前可发布的的领域对象，包含 `desiredPresence`、`protocol`、`natmapDesiredEnabled`、`keeperDesiredEnabled` 字段。
   * @param reported - 用于v2当前可发布的的领域对象，包含 `currentEndpoint`、`lastObservedEndpoint`、`syncStatus`、`routerPresent` 字段。
   * @param reportedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 满足v2当前可发布的约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isV2CurrentPublishable(
    desired: NetworkDesiredChannelV2,
    reported: NetworkReportedChannelV2,
    reportedAt: string,
  ): reported is NetworkReportedChannelV2 & {
    currentEndpoint: NetworkEndpointLeaseV2;
  } {
    const current = reported.currentEndpoint;
    const lastObserved = reported.lastObservedEndpoint;
    if (desired.desiredPresence !== 'present') return false;
    if (reported.syncStatus !== 'synced' || !reported.routerPresent) {
      return false;
    }
    if (!current || !lastObserved) return false;
    if (!this.sameV2EndpointTuple(current, lastObserved)) return false;
    if (!this.isV2EndpointLeaseFresh(current, reportedAt)) return false;
    if (!this.isV2EndpointLeaseFresh(lastObserved, reportedAt)) return false;
    if (reported.protocol === 'tcp') {
      const dataPlaneReady =
        (reported.dnatPresent && reported.routePresent !== true) ||
        (!reported.dnatPresent && reported.routePresent === true);
      return (
        desired.protocol === 'tcp' &&
        desired.natmapDesiredEnabled &&
        reported.natmapDesiredEnabled &&
        dataPlaneReady &&
        reported.natmapStatus === 'active' &&
        !!reported.instanceGeneration?.trim() &&
        !!reported.candidateEndpoint &&
        this.sameV2EndpointTuple(current, reported.candidateEndpoint) &&
        this.isV2EndpointLeaseFresh(reported.candidateEndpoint, reportedAt)
      );
    }
    return (
      desired.protocol === 'udp' &&
      desired.keeperDesiredEnabled &&
      reported.keeperDesiredEnabled &&
      reported.routePresent &&
      reported.keeperStatus === 'active'
    );
  }

  /**
   * 根据`endpoint`、`reportedAt`与当前约束判定v2端点租约新鲜的；从 `getTime` 读取v2端点租约新鲜的。
   * @param endpoint - 用于v2端点租约新鲜的的领域对象，包含 `validatedAt`、`validUntil` 字段。
   * @param reportedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 满足v2端点租约新鲜的约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isV2EndpointLeaseFresh(
    endpoint: NetworkEndpointLeaseV2,
    reportedAt: string,
  ): boolean {
    return (
      compareNetworkV2Timestamps(endpoint.validatedAt, reportedAt) <= 0 &&
      compareNetworkV2Timestamps(endpoint.validUntil, endpoint.validatedAt) >
        0 &&
      compareNetworkV2Timestamps(endpoint.validUntil, reportedAt) > 0 &&
      new Date(endpoint.validUntil).getTime() > Date.now()
    );
  }

  /**
   * 逐字段判定相同的v2端点元组。
   * @param left - 用于逐字段判定相同的v2端点元组的领域对象，包含 `mechanism`、`publicIpv4`、`publicPort` 字段。
   * @param right - 用于逐字段判定相同的v2端点元组的领域对象，包含 `mechanism`、`publicIpv4`、`publicPort` 字段。
   * @returns 逐字段判定相同的v2端点元组。
   */
  private sameV2EndpointTuple(
    left: NetworkEndpointLeaseV2,
    right: NetworkEndpointLeaseV2,
  ): boolean {
    return (
      left.mechanism === right.mechanism &&
      left.publicIpv4 === right.publicIpv4 &&
      left.publicPort === right.publicPort
    );
  }

  /**
   * 根据`mapping`处理当前端点元组；当 `mapping.currentPublicIpv4 && mapping.currentPublicPort` 成立时返回 ``${mapping.currentPublicIpv4}:${mapping.cur…`。
   * @param mapping - 用于当前端点元组的领域对象，包含 `currentPublicIpv4`、`currentPublicPort` 字段。
   * @returns 当前状态对应的当前端点元组，取值为 `''`。
   */
  private currentEndpointTuple(mapping: NetworkPortForward): string {
    if (mapping.currentPublicIpv4 && mapping.currentPublicPort) {
      return `${mapping.currentPublicIpv4}:${mapping.currentPublicPort}`;
    }
    return '';
  }

  /**
   * 根据`reported`与当前约束判定v2缺失已确认的；当 `reported.desiredPresence !== 'absent' || reported.syncStatus…` 成立时返回 `false`。
   * @param reported - 用于v2缺失已确认的的领域对象，包含 `desiredPresence`、`syncStatus`、`routerPresent`、`currentEndpoint` 字段。
   * @returns 满足v2缺失已确认的约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isV2AbsenceConfirmed(reported: NetworkReportedChannelV2): boolean {
    if (
      reported.desiredPresence !== 'absent' ||
      reported.syncStatus !== 'synced' ||
      reported.routerPresent ||
      reported.currentEndpoint
    ) {
      return false;
    }
    if (reported.protocol === 'tcp') {
      return (
        !reported.dnatPresent &&
        reported.routePresent !== true &&
        !reported.natmapDesiredEnabled &&
        reported.natmapStatus === 'disabled' &&
        !reported.candidateEndpoint
      );
    }
    return (
      !reported.routePresent &&
      !reported.keeperDesiredEnabled &&
      reported.keeperStatus === 'disabled'
    );
  }

  /**
   * 把匹配的v2UDP历史写入对应领域状态。
   * @param manager - 保证把匹配的v2UDP历史写入对应领域状态读写处于同一事务中的实体管理器。
   * @param mapping - 用于把匹配的v2UDP历史写入对应领域状态的领域对象，包含 `id` 字段。
   * @returns 满足把匹配的v2UDP历史写入对应领域状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async stageMatchingV2UdpHistory(
    manager: EntityManager,
    mapping: NetworkPortForward,
  ): Promise<boolean> {
    const repository = manager.getRepository(NetworkEndpointHistory);
    let histories = await repository.find({
      order: { occurredAt: 'DESC', id: 'DESC' },
      take: 2,
      where: { mappingId: mapping.id, mechanism: 'udp_stun' },
    });
    if (histories[0]?.eventType === 'restored') {
      if (histories[1]?.eventType !== 'withdrawn') return false;
      histories = await repository.find({
        order: { occurredAt: 'DESC', id: 'DESC' },
        take: 2,
        where: {
          eventType: Not('withdrawn'),
          mappingId: mapping.id,
          mechanism: 'udp_stun',
        },
      });
    }
    return await this.stageV2UdpPortChange(
      manager,
      mapping,
      histories[0],
      histories[1],
    );
  }

  /**
   * 把匹配的v2TCP历史写入对应领域状态。
   * @param manager - 保证把匹配的v2TCP历史写入对应领域状态读写处于同一事务中的实体管理器。
   * @param mapping - 用于把匹配的v2TCP历史写入对应领域状态的领域对象，包含 `id` 字段。
   * @param expectedEventId - 用于精确定位expected事件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足把匹配的v2TCP历史写入对应领域状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async stageMatchingV2TcpHistory(
    manager: EntityManager,
    mapping: NetworkPortForward,
    expectedEventId?: string,
  ): Promise<boolean> {
    const repository = manager.getRepository(NetworkEndpointHistory);
    let histories = await repository.find({
      order: { occurredAt: 'DESC', id: 'DESC' },
      take: 2,
      where: { mappingId: mapping.id, mechanism: 'tcp_natmap' },
    });
    if (expectedEventId && histories[0]?.eventId !== expectedEventId) {
      return false;
    }
    if (histories[0]?.eventType === 'restored') {
      if (histories[1]?.eventType !== 'withdrawn') return false;
      histories = await repository.find({
        order: { occurredAt: 'DESC', id: 'DESC' },
        take: 2,
        where: {
          eventType: Not('withdrawn'),
          mappingId: mapping.id,
          mechanism: 'tcp_natmap',
        },
      });
    }
    return await this.stageV2TcpEndpointChange(
      manager,
      mapping,
      histories[0],
      histories[1],
    );
  }

  /**
   * 把v2UDP端口变更写入对应领域状态。
   * @param manager - 保证把v2UDP端口变更写入对应领域状态读写处于同一事务中的实体管理器。
   * @param mapping - 用于把v2UDP端口变更写入对应领域状态的领域对象，包含 `id` 字段。
   * @param currentHistory - 用于把v2UDP端口变更写入对应领域状态的领域对象，包含 `eventType`、`publicPort`、`eventId`、`occurredAt` 字段。
   * @param previousHistory - 用于把v2UDP端口变更写入对应领域状态的领域对象，包含 `publicPort` 字段。
   * @returns 满足把v2UDP端口变更写入对应领域状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async stageV2UdpPortChange(
    manager: EntityManager,
    mapping: NetworkPortForward,
    currentHistory: NetworkEndpointHistory | undefined,
    previousHistory: NetworkEndpointHistory | undefined,
  ): Promise<boolean> {
    if (!currentHistory) return false;
    if (
      currentHistory.eventType !== 'changed' &&
      currentHistory.eventType !== 'restored'
    ) {
      return false;
    }
    if (!this.isV2HistoryMatchingCurrent(mapping, currentHistory)) return false;
    if (!previousHistory) return false;
    if (!this.isValidPort(previousHistory.publicPort)) return false;
    if (!this.isValidPort(currentHistory.publicPort)) return false;
    if (previousHistory.publicPort === currentHistory.publicPort) return false;
    return (
      (await this.eventStager.stage(manager, {
        eventId: currentHistory.eventId,
        occurredAt: new Date(currentHistory.occurredAt).toISOString(),
        payload: {
          changedAt: new Date(currentHistory.occurredAt).toISOString(),
          currentPort: currentHistory.publicPort,
          portForwardId: mapping.id,
          previousPort: previousHistory.publicPort,
          publicIpv4: currentHistory.publicIpv4,
        },
        resourceKey: mapping.id,
        sourceKey: 'network.stun.mapping-port-changed',
      })) === 'accepted'
    );
  }

  /**
   * 把v2TCP端点变更写入对应领域状态。
   * @param manager - 保证把v2TCP端点变更写入对应领域状态读写处于同一事务中的实体管理器。
   * @param mapping - 用于把v2TCP端点变更写入对应领域状态的领域对象，包含 `id` 字段。
   * @param currentHistory - 用于把v2TCP端点变更写入对应领域状态的领域对象，包含 `eventType`、`publicIpv4`、`publicPort`、`eventId` 字段。
   * @param previousHistory - 用于把v2TCP端点变更写入对应领域状态的领域对象，包含 `eventType`、`publicIpv4`、`publicPort` 字段。
   * @returns 满足把v2TCP端点变更写入对应领域状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async stageV2TcpEndpointChange(
    manager: EntityManager,
    mapping: NetworkPortForward,
    currentHistory: NetworkEndpointHistory | undefined,
    previousHistory: NetworkEndpointHistory | undefined,
  ): Promise<boolean> {
    if (!currentHistory || !previousHistory) return false;
    if (
      currentHistory.eventType !== 'changed' &&
      currentHistory.eventType !== 'restored'
    ) {
      return false;
    }
    if (previousHistory.eventType === 'withdrawn') return false;
    if (!this.isV2HistoryMatchingCurrent(mapping, currentHistory)) return false;
    if (isIP(previousHistory.publicIpv4 || '') !== 4) return false;
    if (isIP(currentHistory.publicIpv4 || '') !== 4) return false;
    if (!this.isValidPort(previousHistory.publicPort)) return false;
    if (!this.isValidPort(currentHistory.publicPort)) return false;
    if (
      previousHistory.publicIpv4 === currentHistory.publicIpv4 &&
      previousHistory.publicPort === currentHistory.publicPort
    ) {
      return false;
    }
    return (
      (await this.eventStager.stage(manager, {
        eventId: currentHistory.eventId,
        occurredAt: new Date(currentHistory.occurredAt).toISOString(),
        payload: {
          previousPublicIpv4: previousHistory.publicIpv4 as string,
          previousPublicPort: previousHistory.publicPort,
          publicIpv4: currentHistory.publicIpv4 as string,
          publicPort: currentHistory.publicPort,
          tcpChannelId: mapping.id,
        },
        resourceKey: mapping.id,
        sourceKey: 'network.tcp.natmap-endpoint-changed',
      })) === 'accepted'
    );
  }

  /**
   * 根据`mapping`、`history`与当前约束判定v2历史匹配的当前。
   * @param mapping - 用于v2历史匹配的当前的领域对象，包含 `reportedRevision`、`currentPublicIpv4`、`currentPublicPort`、`currentEndpointIdentity` 字段。
   * @param history - 用于v2历史匹配的当前的领域对象，包含 `sourceRevision`、`publicIpv4`、`publicPort`、`endpointIdentity` 字段。
   * @returns 满足v2历史匹配的当前约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isV2HistoryMatchingCurrent(
    mapping: NetworkPortForward,
    history: NetworkEndpointHistory,
  ): boolean {
    return (
      history.sourceRevision === mapping.reportedRevision &&
      history.publicIpv4 === mapping.currentPublicIpv4 &&
      history.publicPort === mapping.currentPublicPort &&
      !!history.endpointIdentity &&
      history.endpointIdentity === mapping.currentEndpointIdentity
    );
  }

  /**
   * 根据`mapping`、`endpoint`、`lastObserved`更新已报告的端点；从 `getTime` 读取已报告的端点。
   * @param mapping - 用于已报告的端点的领域对象，包含 `currentObservedAt`、`currentPublicIpv4`、`currentPublicPort`、`currentValidUntil` 字段。
   * @param endpoint - 用于已报告的端点的领域对象，包含 `observedAt`、`publicIpv4`、`publicPort`、`validUntil` 字段。
   * @param lastObserved - 用于已报告的端点的领域对象，包含 `observedAt`、`publicIpv4`、`publicPort` 字段。
   * @param reportedAt - 用于过期、排序或租约判定的时间基准。
   */
  private applyReportedEndpoints(
    mapping: NetworkPortForward,
    endpoint: NetworkReportedSnapshot['mappings'][number]['currentEndpoint'],
    lastObserved: NetworkReportedSnapshot['mappings'][number]['lastObservedEndpoint'],
    reportedAt: string,
  ): void {
    if (!endpoint) {
      const withdrawalTime = new Date(reportedAt).getTime();
      if (
        !mapping.currentObservedAt ||
        withdrawalTime >= new Date(mapping.currentObservedAt).getTime()
      ) {
        mapping.currentPublicIpv4 = null;
        mapping.currentPublicPort = null;
        mapping.currentObservedAt = null;
        mapping.currentValidUntil = null;
      }
    } else {
      const observedAt = new Date(endpoint.observedAt);
      if (
        !mapping.currentObservedAt ||
        observedAt.getTime() >= new Date(mapping.currentObservedAt).getTime()
      ) {
        mapping.currentPublicIpv4 = endpoint.publicIpv4;
        mapping.currentPublicPort = endpoint.publicPort;
        mapping.currentObservedAt = new KtDateTime(observedAt);
        mapping.currentValidUntil = new KtDateTime(endpoint.validUntil);
      }
    }
    if (lastObserved) {
      const observedAt = new Date(lastObserved.observedAt);
      if (
        !mapping.lastObservedAt ||
        observedAt.getTime() >= new Date(mapping.lastObservedAt).getTime()
      ) {
        mapping.lastObservedIpv4 = lastObserved.publicIpv4;
        mapping.lastObservedPort = lastObserved.publicPort;
        mapping.lastObservedAt = new KtDateTime(observedAt);
      }
    }
  }

  /**
   * 根据`status`更新状态；先通过 `assertAgentId` 校验输入边界。
   * @param status - 用于状态的领域对象，包含 `agentId` 字段。
   * @returns 状态。
   */
  private async applyStatus(status: NetworkStatusSnapshot): Promise<{
    ddnsSourceChanged: boolean;
    visibleStateChanged: boolean;
  }> {
    this.assertAgentId(status.agentId);
    return await this.applyStatusSnapshot(status, true);
  }

  /**
   * 根据`status`更新v2状态；先通过 `assertAgentId` 校验输入边界。
   * @param status - 用于v2状态的领域对象，包含 `agentId`、`tcpNatmapCapable` 字段。
   * @returns v2状态。
   */
  private async applyV2Status(status: NetworkStatusSnapshotV2): Promise<{
    ddnsSourceChanged: boolean;
    visibleStateChanged: boolean;
  }> {
    this.assertAgentId(status.agentId);
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NetworkAgentState);
      const state = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: status.agentId },
      });
      if (!state) {
        throw new NetworkMessageValidationError('Unknown network Agent');
      }
      if (
        state.maxSupportedSchemaVersion !== 2 ||
        state.tcpNatmapCapable !== status.tcpNatmapCapable
      ) {
        state.maxSupportedSchemaVersion = 2;
        state.tcpNatmapCapable = status.tcpNatmapCapable;
        await repository.save(state);
      }
    });
    const result = await this.applyStatusSnapshot(status, false);
    if (await this.activateV2DesiredSchema()) this.requestDesiredPublish();
    return result;
  }

  /**
   * 根据`status`、`ignoreAfterV2Capability`更新状态快照。
   * @param status - 用于状态快照的领域对象，包含 `agentId`、`observedAt`、`startedAt`、`online` 字段。
   * @param ignoreAfterV2Capability - 决定是否启用“ignoreAfterV2Capability”分支的布尔选项。
   * @returns 状态快照。
   */
  private async applyStatusSnapshot(
    status: Pick<
      NetworkStatusSnapshot,
      | 'agentId'
      | 'errorCode'
      | 'errorMessage'
      | 'observedAt'
      | 'online'
      | 'publicIpv6'
      | 'startedAt'
      | 'version'
    >,
    ignoreAfterV2Capability: boolean,
  ): Promise<{
    ddnsSourceChanged: boolean;
    visibleStateChanged: boolean;
  }> {
    return await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NetworkAgentState);
      const state = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: status.agentId },
      });
      if (!state) {
        throw new NetworkMessageValidationError('Unknown network Agent');
      }
      if (ignoreAfterV2Capability && state.maxSupportedSchemaVersion >= 2) {
        return { ddnsSourceChanged: false, visibleStateChanged: false };
      }
      const observedAt = new Date(status.observedAt);
      const incomingStartedAt = (() => {
        if (status.startedAt) {
          return new Date(status.startedAt);
        }
        return null;
      })();
      const currentStartedAt = (() => {
        if (state.startedAt) {
          return new Date(state.startedAt);
        }
        return null;
      })();
      if (
        incomingStartedAt &&
        currentStartedAt &&
        incomingStartedAt.getTime() < currentStartedAt.getTime()
      ) {
        return { ddnsSourceChanged: false, visibleStateChanged: false };
      }
      const isSameSessionWill =
        status.online === false &&
        !!incomingStartedAt &&
        !!currentStartedAt &&
        incomingStartedAt.getTime() === currentStartedAt.getTime();
      if (
        state.lastHeartbeatAt &&
        observedAt.getTime() < new Date(state.lastHeartbeatAt).getTime() &&
        !isSameSessionWill
      ) {
        return { ddnsSourceChanged: false, visibleStateChanged: false };
      }
      const persistedStateBefore = this.statusPersistedStateFingerprint(state);
      const refreshStateBefore = this.statusRefreshStateFingerprint(state);
      const publicIpv6Before = state.currentPublicIpv6 || null;
      state.online = status.online;
      state.version = status.version || null;
      if (incomingStartedAt) {
        state.startedAt = new KtDateTime(incomingStartedAt);
      } else {
        state.startedAt = null;
      }
      if (!isSameSessionWill) {
        state.lastHeartbeatAt = new KtDateTime(observedAt);
      }
      state.lastMqttErrorCode = status.errorCode || null;
      state.lastMqttErrorMessage = status.errorMessage || null;
      if (status.online && status.publicIpv6) {
        state.currentPublicIpv6 = status.publicIpv6;
      } else {
        state.currentPublicIpv6 = null;
      }
      if (status.online && status.publicIpv6) {
        state.currentIpv6ObservedAt = new KtDateTime(observedAt);
      } else {
        state.currentIpv6ObservedAt = null;
      }
      if (
        this.statusPersistedStateFingerprint(state) !== persistedStateBefore
      ) {
        await repository.save(state);
      }
      return {
        ddnsSourceChanged:
          (state.currentPublicIpv6 || null) !== publicIpv6Before,
        visibleStateChanged:
          this.statusRefreshStateFingerprint(state) !== refreshStateBefore,
      };
    });
  }

  /**
   * 请求v2降级；等待 `Promise.resolve` 返回后继续处理v2降级。
   * @returns 返回v2降级；等待 `Promise.resolve` 返回后继续处理v2降级。
   */
  requestV2Downgrade(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * 根据`event`更新端点事件；先通过 `assertAgentId` 校验输入边界。
   * @param event - 触发端点事件的领域事件，包含 `agentId`、`revision`、`mappingId`、`eventId` 字段。
   * @returns 端点事件。
   */
  private async appendEndpointEvent(
    event: NetworkEndpointEvent,
  ): Promise<{ changed: boolean; deliveryAccepted: boolean }> {
    this.assertAgentId(event.agentId);
    return await this.dataSource.transaction(async (manager) => {
      const state = await manager.getRepository(NetworkAgentState).findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: event.agentId },
      });
      if (!state || BigInt(event.revision) > BigInt(state.desiredRevision)) {
        throw new NetworkMessageValidationError('Invalid event revision');
      }
      if (state.desiredSchemaVersion >= 2 || state.appliedSchemaVersion >= 2) {
        return { changed: false, deliveryAccepted: false };
      }
      const mapping = await manager.getRepository(NetworkPortForward).findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: event.mappingId },
      });
      if (!mapping) {
        throw new NetworkMessageValidationError('Unknown event mapping');
      }
      const repository = manager.getRepository(NetworkEndpointHistory);
      if (await repository.findOne({ where: { eventId: event.eventId } })) {
        return { changed: false, deliveryAccepted: false };
      }
      const previousHistory = await repository.findOne({
        lock: { mode: 'pessimistic_read' },
        order: { occurredAt: 'DESC', id: 'DESC' },
        where: { mappingId: event.mappingId },
      });
      const history = repository.create({
        eventId: event.eventId,
        eventType: event.type,
        firstObservedAt: new KtDateTime(event.endpoint.observedAt),
        lastObservedAt: new KtDateTime(event.endpoint.observedAt),
        mappingId: event.mappingId,
        mechanism: 'udp_stun',
        occurredAt: new KtDateTime(event.occurredAt),
        publicIpv4: event.endpoint.publicIpv4,
        publicPort: event.endpoint.publicPort,
        reason: event.reason || null,
      });
      try {
        await repository.save(history);
        let deliveryAccepted = false;
        if (this.shouldStagePortChange(event, previousHistory)) {
          deliveryAccepted =
            (await this.eventStager.stage(manager, {
              eventId: event.eventId,
              occurredAt: event.occurredAt,
              payload: {
                changedAt: event.occurredAt,
                currentPort: event.endpoint.publicPort,
                portForwardId: event.mappingId,
                previousPort: previousHistory.publicPort,
                publicIpv4: event.endpoint.publicIpv4,
              },
              resourceKey: event.mappingId,
              sourceKey: 'network.stun.mapping-port-changed',
            })) === 'accepted';
        }
        return { changed: true, deliveryAccepted };
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) throw error;
        return { changed: false, deliveryAccepted: false };
      }
    });
  }

  /**
   * 根据`event`更新端点事件v2；先通过 `assertAgentId` 校验输入边界。
   * @param event - 触发端点事件v2的领域事件，包含 `agentId`、`channelId`、`groupId`、`protocol` 字段。
   * @returns 端点事件v2。
   */
  private async appendEndpointEventV2(
    event: NetworkEndpointEventV2,
  ): Promise<{ changed: boolean; deliveryAccepted: boolean }> {
    this.assertAgentId(event.agentId);
    return await this.dataSource.transaction(async (manager) => {
      const state = await manager.getRepository(NetworkAgentState).findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: event.agentId },
      });
      if (!state) {
        throw new NetworkMessageValidationError('Unknown network Agent');
      }
      if (state.desiredSchemaVersion !== 2) {
        return { changed: false, deliveryAccepted: false };
      }
      const mapping = await manager.getRepository(NetworkPortForward).findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: event.channelId },
      });
      if (
        !mapping ||
        mapping.groupId !== event.groupId ||
        mapping.protocol !== event.protocol
      ) {
        throw new NetworkMessageValidationError(
          'V2 endpoint event channel identity does not match',
        );
      }
      if (BigInt(event.revision) > BigInt(mapping.desiredRevision)) {
        throw new NetworkMessageValidationError(
          'Invalid v2 endpoint event revision',
        );
      }
      const repository = manager.getRepository(NetworkEndpointHistory);
      if (await repository.findOne({ where: { eventId: event.eventId } })) {
        return { changed: false, deliveryAccepted: false };
      }
      const isTcpRestored =
        event.protocol === 'tcp' && event.type === 'restored';
      const immediatePreviousHistory = await (async () => {
        if (isTcpRestored) {
          return null;
        }
        return await repository.findOne({
          lock: { mode: 'pessimistic_read' },
          order: { occurredAt: 'DESC', id: 'DESC' },
          where: {
            mappingId: event.channelId,
            mechanism: event.mechanism,
          },
        });
      })();
      const previousHistory = await (async () => {
        if (event.type === 'restored' && !isTcpRestored) {
          if (immediatePreviousHistory?.eventType === 'withdrawn') {
            return await repository.findOne({
              lock: { mode: 'pessimistic_read' },
              order: { occurredAt: 'DESC', id: 'DESC' },
              where: {
                eventType: Not('withdrawn'),
                mappingId: event.channelId,
                mechanism: event.mechanism,
              },
            });
          }
          return null;
        }
        return immediatePreviousHistory;
      })();
      const observedAt = event.endpoint?.observedAt || event.occurredAt;
      const history = repository.create({
        endpointValidatedAt: (() => {
          if (event.endpoint) {
            return new KtDateTime(event.endpoint.validatedAt);
          }
          return null;
        })(),
        endpointValidUntil: (() => {
          if (event.endpoint) {
            return new KtDateTime(event.endpoint.validUntil);
          }
          return null;
        })(),
        endpointIdentity: (() => {
          if (event.endpoint) {
            return endpointLeaseIdentityV2(event.endpoint);
          }
          return null;
        })(),
        eventId: event.eventId,
        eventType: event.type,
        firstObservedAt: new KtDateTime(observedAt),
        lastObservedAt: new KtDateTime(observedAt),
        mappingId: event.channelId,
        mechanism: event.mechanism,
        occurredAt: new KtDateTime(event.occurredAt),
        publicIpv4: event.endpoint?.publicIpv4 || null,
        publicPort: event.endpoint?.publicPort || null,
        reason: event.reason || null,
        sourceRevision: String(event.revision),
      });
      try {
        await repository.save(history);
        const deliveryAccepted = await (async () => {
          if (this.canStageV2EventAgainstCurrent(mapping, event)) {
            if (event.protocol === 'tcp') {
              if (event.type === 'restored') {
                return await this.stageMatchingV2TcpHistory(
                  manager,
                  mapping,
                  event.eventId,
                );
              }
              return await this.stageV2TcpEndpointChange(
                manager,
                mapping,
                history,
                previousHistory || undefined,
              );
            }
            return await this.stageV2UdpPortChange(
              manager,
              mapping,
              history,
              previousHistory || undefined,
            );
          }
          return false;
        })();
        return { changed: true, deliveryAccepted };
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) throw error;
        return { changed: false, deliveryAccepted: false };
      }
    });
  }

  /**
   * 仅允许机制、版本、当前端点和租约均与映射一致的 V2 端点事件进入历史暂存。
   * @param mapping - 用于仅允许机制、版本、当前端点和租约均与映射一致的 V2 端点事件进入历史暂存的领域对象，包含 `reportedRevision`、`currentPublicIpv4`、`currentPublicPort`、`currentEndpointIdentity` 字段。
   * @param event - 触发仅允许机制、版本、当前端点和租约均与映射一致的 V2 端点事件进入历史暂存的领域事件，包含 `protocol`、`mechanism`、`type`、`endpoint` 字段。
   * @returns 满足阶段V2事件Against约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private canStageV2EventAgainstCurrent(
    mapping: NetworkPortForward,
    event: NetworkEndpointEventV2,
  ): boolean {
    const expectedMechanism = (() => {
      if (event.protocol === 'tcp') {
        return 'tcp_natmap';
      }
      return 'udp_stun';
    })();
    return (
      event.mechanism === expectedMechanism &&
      (event.type === 'changed' || event.type === 'restored') &&
      !!event.endpoint &&
      mapping.reportedRevision === String(event.revision) &&
      mapping.currentPublicIpv4 === event.endpoint.publicIpv4 &&
      mapping.currentPublicPort === event.endpoint.publicPort &&
      mapping.currentEndpointIdentity ===
        endpointLeaseIdentityV2(event.endpoint) &&
      this.isV2EndpointLeaseFresh(event.endpoint, event.occurredAt) &&
      new Date(mapping.currentValidUntil).getTime() > Date.now()
    );
  }

  /**
   * 仅在端点变更事件携带合法端口，且上一条历史不是同端口有效记录时暂存端口变化。
   * @param event - 触发仅在端点变更事件携带合法端口，且上一条历史不是同端口有效记录时暂存端口变化的领域事件，包含 `endpoint`、`type` 字段。
   * @param previousHistory - 用于仅在端点变更事件携带合法端口，且上一条历史不是同端口有效记录时暂存端口变化的领域对象，包含 `publicPort`、`eventType` 字段。
   * @returns 满足阶段端口Change约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldStagePortChange(
    event: NetworkEndpointEvent,
    previousHistory: NetworkEndpointHistory | null,
  ): boolean {
    const previousPort = previousHistory?.publicPort;
    const currentPort = event.endpoint.publicPort;
    return (
      event.type === 'changed' &&
      previousHistory?.eventType !== 'withdrawn' &&
      this.isValidPort(previousPort) &&
      this.isValidPort(currentPort) &&
      previousPort !== currentPort
    );
  }

  /**
   * 根据`value`与当前约束判定有效端口。
   * @param value - 待判定是否满足有效端口约束的候选值。
   * @returns 满足有效端口约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isValidPort(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 65_535
    );
  }

  /**
   * 根据`mapping`处理v2已报告的已持久化的映射指纹。
   * @param mapping - 用于v2已报告的已持久化的映射指纹的领域对象，包含 `activeGroupProtocolKey`、`activeKey`、`candidateObservedAt`、`candidatePublicIpv4` 字段。
   * @returns v2已报告的已持久化的映射指纹。
   */
  private v2ReportedPersistedMappingFingerprint(
    mapping: NetworkPortForward,
  ): string {
    return JSON.stringify([
      mapping.activeGroupProtocolKey,
      mapping.activeKey,
      mapping.candidateObservedAt,
      mapping.candidatePublicIpv4,
      mapping.candidatePublicPort,
      mapping.candidateValidatedAt,
      mapping.candidateValidatedAtWire,
      mapping.currentEndpointIdentity,
      mapping.currentObservedAt,
      mapping.currentPublicIpv4,
      mapping.currentPublicPort,
      mapping.currentValidatedAt,
      mapping.currentValidatedAtWire,
      mapping.currentValidUntil,
      mapping.isDeleted,
      mapping.keeperLastErrorCode,
      mapping.keeperLastErrorMessage,
      mapping.keeperStatus,
      mapping.lastErrorCode,
      mapping.lastErrorMessage,
      mapping.lastObservedAt,
      mapping.lastObservedIpv4,
      mapping.lastObservedPort,
      mapping.lastObservedValidatedAt,
      mapping.lastObservedValidatedAtWire,
      mapping.lastPublishedAt,
      mapping.lastPublishedPublicIpv4,
      mapping.lastPublishedPublicPort,
      mapping.lastReportedAt,
      mapping.lastReportedAtWire,
      mapping.natmapLastErrorCode,
      mapping.natmapLastErrorMessage,
      mapping.natmapStatus,
      mapping.reportedRevision,
      mapping.syncStatus,
    ]);
  }

  /**
   * 根据`mapping`处理v2已报告的刷新映射指纹。
   * @param mapping - 用于v2已报告的刷新映射指纹的领域对象，包含 `activeGroupProtocolKey`、`activeKey`、`candidatePublicIpv4`、`candidatePublicPort` 字段。
   * @returns v2已报告的刷新映射指纹。
   */
  private v2ReportedRefreshMappingFingerprint(
    mapping: NetworkPortForward,
  ): string {
    return JSON.stringify([
      mapping.activeGroupProtocolKey,
      mapping.activeKey,
      mapping.candidatePublicIpv4,
      mapping.candidatePublicPort,
      mapping.currentPublicIpv4,
      mapping.currentPublicPort,
      mapping.isDeleted,
      mapping.keeperLastErrorCode,
      mapping.keeperLastErrorMessage,
      mapping.keeperStatus,
      mapping.lastErrorCode,
      mapping.lastErrorMessage,
      mapping.lastObservedIpv4,
      mapping.lastObservedPort,
      mapping.natmapLastErrorCode,
      mapping.natmapLastErrorMessage,
      mapping.natmapStatus,
      mapping.reportedRevision,
      mapping.syncStatus,
    ]);
  }

  /**
   * 根据`mapping`处理已报告的已持久化的映射状态指纹。
   * @param mapping - 用于已报告的已持久化的映射状态指纹的领域对象，包含 `activeKey`、`currentObservedAt`、`currentPublicIpv4`、`currentPublicPort` 字段。
   * @returns 已报告的已持久化的映射状态指纹。
   */
  private reportedPersistedMappingStateFingerprint(
    mapping: NetworkPortForward,
  ): string {
    return JSON.stringify([
      mapping.activeKey,
      mapping.currentObservedAt,
      mapping.currentPublicIpv4,
      mapping.currentPublicPort,
      mapping.currentValidUntil,
      mapping.isDeleted,
      mapping.keeperStatus,
      mapping.lastErrorCode,
      mapping.lastErrorMessage,
      mapping.lastObservedAt,
      mapping.lastObservedIpv4,
      mapping.lastObservedPort,
      mapping.reportedRevision,
      mapping.syncStatus,
    ]);
  }

  /**
   * 根据`mapping`处理已报告的刷新映射状态指纹。
   * @param mapping - 用于已报告的刷新映射状态指纹的领域对象，包含 `activeKey`、`currentPublicIpv4`、`currentPublicPort`、`isDeleted` 字段。
   * @returns 已报告的刷新映射状态指纹。
   */
  private reportedRefreshMappingStateFingerprint(
    mapping: NetworkPortForward,
  ): string {
    return JSON.stringify([
      mapping.activeKey,
      mapping.currentPublicIpv4,
      mapping.currentPublicPort,
      mapping.isDeleted,
      mapping.keeperStatus,
      mapping.lastErrorCode,
      mapping.lastErrorMessage,
      mapping.lastObservedIpv4,
      mapping.lastObservedPort,
      mapping.reportedRevision,
      mapping.syncStatus,
    ]);
  }

  /**
   * 根据`state`处理已报告的Agent状态指纹。
   * @param state - 用于已报告的Agent状态指纹的领域对象，包含 `appliedRevision`、`appliedSchemaVersion`、`desiredIssuedAt`、`desiredRevision` 字段。
   * @returns 已报告的Agent状态指纹。
   */
  private reportedAgentStateFingerprint(state: NetworkAgentState): string {
    return JSON.stringify([
      state.appliedRevision,
      state.appliedSchemaVersion,
      state.desiredIssuedAt,
      state.desiredRevision,
      state.lastReconcileErrorCode,
      state.lastReconcileErrorMessage,
    ]);
  }

  /**
   * 根据`state`处理状态已持久化的状态指纹。
   * @param state - 用于状态已持久化的状态指纹的领域对象，包含 `lastHeartbeatAt`、`currentIpv6ObservedAt`、`currentPublicIpv6`、`lastMqttErrorCode` 字段。
   * @returns 状态已持久化的状态指纹。
   */
  private statusPersistedStateFingerprint(state: NetworkAgentState): string {
    return JSON.stringify([
      state.lastHeartbeatAt,
      state.currentIpv6ObservedAt,
      state.currentPublicIpv6,
      state.lastMqttErrorCode,
      state.lastMqttErrorMessage,
      state.online,
      state.startedAt,
      state.version,
    ]);
  }

  /**
   * 根据`state`处理状态刷新状态指纹。
   * @param state - 用于状态刷新状态指纹的领域对象，包含 `lastMqttErrorCode`、`lastMqttErrorMessage`、`currentPublicIpv6`、`online` 字段。
   * @returns 状态刷新状态指纹。
   */
  private statusRefreshStateFingerprint(state: NetworkAgentState): string {
    return JSON.stringify([
      state.lastMqttErrorCode,
      state.lastMqttErrorMessage,
      state.currentPublicIpv6,
      state.online,
      state.startedAt,
      state.version,
    ]);
  }

  /**
   * 校验`agentId`是否满足Agent标识约束，并拒绝不合法输入。
   * @param agentId - 用于精确定位Agent的标识。
   * @throws 当 `agentId !== this.agentId()` 成立时拒绝当前输入并抛出 `NetworkMessageValidationError`。
   */
  private assertAgentId(agentId: string): void {
    if (agentId !== this.agentId()) {
      throw new NetworkMessageValidationError('Unexpected network Agent ID');
    }
  }

  /**
   * 从运行时配置读取网络 Agent 的稳定标识；缺失或非法配置按调用处约束拒绝。
   * @returns 返回 `this.configService.get<string>('NETWORK_AGENT_ID')` 的可用值；为空时回退到 `DEFAULT_AGENT_ID`。
   */
  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }

  /**
   * 按当前运行态启动激活v2期望的Schema。
   * @returns 满足激活v2期望的Schema约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async activateV2DesiredSchema(): Promise<boolean> {
    if (!this.tcpReleasePolicy().mayAutomaticallyActivateV2()) return false;
    return await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NetworkAgentState);
      const state = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: this.agentId() },
      });
      if (
        !state ||
        state.desiredSchemaVersion === 2 ||
        state.maxSupportedSchemaVersion < 2 ||
        !state.tcpNatmapCapable
      ) {
        return false;
      }
      state.desiredSchemaVersion = 2;
      await repository.save(state);
      return true;
    });
  }

  /**
   * 惰性创建并复用TCP发布策略。
   * @returns 规范化后的惰性创建并复用TCP发布策略；主值为空时采用 `new NetworkTcpReleasePolicyService(this.configServi…` 兜底。
   */
  private tcpReleasePolicy(): NetworkTcpReleasePolicyService {
    return (
      this.releasePolicy ||
      new NetworkTcpReleasePolicyService(this.configService)
    );
  }

  /**
   * 把协议版本、当前 Agent 标识和消息类别编码为统一的网络管理 MQTT 主题。
   * @param schemaVersion - 写入主题版本段的协议版本，仅允许版本 1 或 2。
   * @param kind - 写入主题末段的消息类别，用于区分期望态、事件、上报态与状态。
   * @returns 当前 Agent 在指定协议版本和消息类别下的完整 MQTT 主题。
   */
  private topic(
    schemaVersion: 1 | 2,
    kind: 'desired' | 'events' | 'reported' | 'status',
  ): string {
    return `kt/network/v${schemaVersion}/agents/${this.agentId()}/${kind}`;
  }

  /**
   * 根据当前运行态处理毫秒；当 `Number.isFinite(configured) && configured >= 1000` 成立时返回 `Math.min(configured, 60_000)`。
   * @returns 毫秒。
   */
  private retryMs(): number {
    const configured = Number(
      this.configService.get<string>('NETWORK_AGENT_MQTT_RETRY_MS'),
    );
    if (Number.isFinite(configured) && configured >= 1000) {
      return Math.min(configured, 60_000);
    }
    return DEFAULT_RETRY_MS;
  }

  /**
   * 根据当前运行态处理客户端。
   */
  private recoverClient(): void {
    const client = this.client;
    if (this.shuttingDown || this.recoveryInProgress || !client) return;
    this.recoveryInProgress = true;
    client.end(true, {}, () => {
      if (this.shuttingDown || this.client !== client) {
        this.recoveryInProgress = false;
        return;
      }
      client.reconnect();
    });
  }

  /**
   * 根据`error`处理客户端错误。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   */
  private handleClientError(error: Error): void {
    if (this.shuttingDown) return;
    this.logger.warn(`Network Agent MQTT client error (${error.name})`);
    this.recoverClient();
  }

  /**
   * 仅把 MySQL `ER_DUP_ENTRY` 或错误号 1062 识别为唯一键冲突，其他错误一律返回 `false`。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足Duplicate键错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
