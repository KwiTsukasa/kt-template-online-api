import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as mqtt from 'mqtt';
import type { IClientOptions, MqttClient } from 'mqtt';
import { KtDateTime } from '@/common';
import {
  SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
  SYSTEM_MESSAGE_EVENT_STAGER,
  type SystemMessageDeliveryCoordinator,
  type SystemMessageEventStager,
} from '@/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { NetworkAgentState } from './network-agent-state.entity';
import { NetworkEndpointHistory } from './network-endpoint-history.entity';
import { NetworkDdnsService } from './network-ddns.service';
import { NetworkManagementEventStreamService } from './network-management-event-stream.service';
import { NetworkPortForward } from './network-management.entity';
import { NetworkPortForwardGroup } from './network-port-forward-group.entity';
import { NetworkTcpReleasePolicyService } from './network-tcp-release-policy.service';
import {
  buildDesiredSnapshotV2,
  NetworkV2MessageValidationError,
  parseStatusSnapshotV2,
  type NetworkStatusSnapshotV2,
} from './network-agent-v2.types';
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
} from './network-management.types';

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

  requestDesiredPublish(): void {
    this.publishRequested = true;
    this.startPublishDrain();
  }

  async publishLatestDesired(force = false): Promise<boolean> {
    if (!this.client?.connected) return false;
    const publication = await this.dataSource.transaction(async (manager) => {
      const state = await manager.getRepository(NetworkAgentState).findOne({
        where: { agentId: this.agentId() },
      });
      if (!state || BigInt(state.desiredRevision) === 0n) return null;
      const desiredSchemaVersion: 1 | 2 =
        state.desiredSchemaVersion === 2 ? 2 : 1;
      const publishedSchemaVersion: 1 | 2 =
        state.publishedSchemaVersion === 2 ? 2 : 1;
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
    let source: NetworkStateChangeSource;
    if (topic === this.topic(1, 'reported')) {
      source = 'reported';
      const result = await this.applyReported(parseReportedSnapshot(parsed));
      changed = result.visibleStateChanged;
      ddnsSourceChanged = result.ddnsSourceChanged;
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
      if (endpointResult.deliveryAccepted) {
        try {
          this.deliveryCoordinator.requestDrain();
        } catch {
          this.logger.warn('System message delivery wake failed');
        }
      }
    } else {
      throw new NetworkMessageValidationError('Unexpected network MQTT topic');
    }
    if (changed) this.eventStream.publishCommitted(source);
    if (ddnsSourceChanged) this.ddnsService?.requestReconcile();
  }

  private handleConnect(): void {
    const client = this.client;
    if (this.shuttingDown || !client) return;
    this.recoveryInProgress = false;
    client.subscribe(
      {
        [this.topic(1, 'reported')]: { qos: 1 },
        [this.topic(1, 'status')]: { qos: 1 },
        [this.topic(1, 'events')]: { qos: 1 },
        [this.topic(2, 'status')]: { qos: 1 },
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
        error instanceof Error
          ? error
          : new Error('Network MQTT database transaction failed'),
      );
    }
  }

  private startPublishDrain(): void {
    if (this.publishPromise) return;
    this.publishPromise = this.drainPublishRequests().finally(() => {
      this.publishPromise = null;
      if (this.publishRequested) this.startPublishDrain();
    });
  }

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
      const desiredSchemaVersion =
        state.desiredSchemaVersion === 2 ? 2 : 1;
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

        if (
          mapping.desiredPresence === 'absent' &&
          item.desiredState === 'absent' &&
          item.syncStatus === 'synced' &&
          item.routerPresent === false &&
          item.routePresent === false &&
          report.helperStatus === 'confirmed' &&
          report.helperAppliedRevision === report.appliedRevision &&
          item.keeperDesiredEnabled === false &&
          item.keeperStatus === 'disabled' &&
          !item.currentEndpoint
        ) {
          mapping.activeKey = null;
          mapping.isDeleted = true;
          finalizedDeletion = true;
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

      if (BigInt(report.appliedRevision) > BigInt(state.appliedRevision)) {
        state.appliedRevision = String(report.appliedRevision);
      }
      const failedMapping = report.mappings.find(
        (item) =>
          item.syncStatus === 'conflict' || item.syncStatus === 'failed',
      );
      state.lastReconcileErrorCode = failedMapping
        ? failedMapping.errorCode || `sync_${failedMapping.syncStatus}`
        : report.helperStatus === 'failed'
          ? 'route_helper_failed'
          : null;
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

  private async applyStatus(status: NetworkStatusSnapshot): Promise<{
    ddnsSourceChanged: boolean;
    visibleStateChanged: boolean;
  }> {
    this.assertAgentId(status.agentId);
    return await this.applyStatusSnapshot(status, true);
  }

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
      if (
        ignoreAfterV2Capability &&
        state.maxSupportedSchemaVersion >= 2
      ) {
        return { ddnsSourceChanged: false, visibleStateChanged: false };
      }
      const observedAt = new Date(status.observedAt);
      const incomingStartedAt = status.startedAt
        ? new Date(status.startedAt)
        : null;
      const currentStartedAt = state.startedAt
        ? new Date(state.startedAt)
        : null;
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
      state.startedAt = incomingStartedAt
        ? new KtDateTime(incomingStartedAt)
        : null;
      if (!isSameSessionWill) {
        state.lastHeartbeatAt = new KtDateTime(observedAt);
      }
      state.lastMqttErrorCode = status.errorCode || null;
      state.lastMqttErrorMessage = status.errorMessage || null;
      state.currentPublicIpv6 =
        status.online && status.publicIpv6 ? status.publicIpv6 : null;
      state.currentIpv6ObservedAt =
        status.online && status.publicIpv6 ? new KtDateTime(observedAt) : null;
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

  async requestV2Downgrade(): Promise<boolean> {
    if (!this.tcpReleasePolicy().mayExplicitlyDowngradeToV1()) return false;
    const changed = await this.dataSource.transaction(async (manager) => {
      const stateRepository = manager.getRepository(NetworkAgentState);
      const state = await stateRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: this.agentId() },
      });
      if (
        !state ||
        state.desiredSchemaVersion !== 2 ||
        state.publishedSchemaVersion !== 2 ||
        BigInt(state.publishedRevision) !== BigInt(state.desiredRevision) ||
        BigInt(state.appliedRevision) !== BigInt(state.desiredRevision)
      ) {
        return false;
      }
      const groups = await manager.getRepository(NetworkPortForwardGroup).find({
        lock: { mode: 'pessimistic_read' },
        where: { isDeleted: false },
      });
      if (
        groups.some(
          (group) =>
            group.protocolMode === 'tcp' || group.protocolMode === 'tcp_udp',
        )
      ) {
        return false;
      }
      const tcpChannels = await manager.getRepository(NetworkPortForward).find({
        lock: { mode: 'pessimistic_read' },
        where: { protocol: 'tcp' },
      });
      if (tcpChannels.some((channel) => !channel.isDeleted)) return false;
      state.desiredSchemaVersion = 1;
      await stateRepository.save(state);
      return true;
    });
    if (changed) this.requestDesiredPublish();
    return changed;
  }

  private async appendEndpointEvent(
    event: NetworkEndpointEvent,
  ): Promise<{ changed: boolean; deliveryAccepted: boolean }> {
    this.assertAgentId(event.agentId);
    return await this.dataSource.transaction(async (manager) => {
      const state = await manager.getRepository(NetworkAgentState).findOne({
        where: { agentId: event.agentId },
      });
      if (!state || BigInt(event.revision) > BigInt(state.desiredRevision)) {
        throw new NetworkMessageValidationError('Invalid event revision');
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

  private isValidPort(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 65_535
    );
  }

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

  private reportedAgentStateFingerprint(state: NetworkAgentState): string {
    return JSON.stringify([
      state.appliedRevision,
      state.desiredIssuedAt,
      state.desiredRevision,
      state.lastReconcileErrorCode,
      state.lastReconcileErrorMessage,
    ]);
  }

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

  private assertAgentId(agentId: string): void {
    if (agentId !== this.agentId()) {
      throw new NetworkMessageValidationError('Unexpected network Agent ID');
    }
  }

  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }

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

  private tcpReleasePolicy(): NetworkTcpReleasePolicyService {
    return this.releasePolicy || new NetworkTcpReleasePolicyService(this.configService);
  }

  private topic(
    schemaVersion: 1 | 2,
    kind: 'desired' | 'events' | 'reported' | 'status',
  ): string {
    return `kt/network/v${schemaVersion}/agents/${this.agentId()}/${kind}`;
  }

  private retryMs(): number {
    const configured = Number(
      this.configService.get<string>('NETWORK_AGENT_MQTT_RETRY_MS'),
    );
    return Number.isFinite(configured) && configured >= 1000
      ? Math.min(configured, 60_000)
      : DEFAULT_RETRY_MS;
  }

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

  private handleClientError(error: Error): void {
    if (this.shuttingDown) return;
    this.logger.warn(`Network Agent MQTT client error (${error.name})`);
    this.recoverClient();
  }

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
