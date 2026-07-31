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
      const desiredSchemaVersion = state.desiredSchemaVersion === 2 ? 2 : 1;
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
          (mapping.lastReportedAt
            ? new Date(mapping.lastReportedAt).toISOString()
            : null);
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
            const currentEndpoint = this.isV2CurrentPublishable(
              desiredChannel,
              item,
              report.reportedAt,
            )
              ? item.currentEndpoint
              : undefined;
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
              const accepted =
                item.protocol === 'tcp'
                  ? await this.stageMatchingV2TcpHistory(manager, mapping)
                  : await this.stageMatchingV2UdpHistory(manager, mapping);
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
        (persistedFailure
          ? {
              code:
                persistedFailure.lastErrorCode ||
                `sync_${persistedFailure.syncStatus}`,
              message: persistedFailure.lastErrorMessage || null,
            }
          : undefined);
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
      (reported.protocol === 'tcp' &&
        (desired.protocol !== 'tcp' ||
          reported.natmapDesiredEnabled !== desired.natmapDesiredEnabled)) ||
      (reported.protocol === 'udp' &&
        (desired.protocol !== 'udp' ||
          reported.keeperDesiredEnabled !== desired.keeperDesiredEnabled))
    ) {
      return {
        code: 'reported_channel_intent_conflict',
        message: 'V2 reported channel intent does not match desired state',
      };
    }
    return null;
  }

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

  private applyV2CandidateEndpoint(
    mapping: NetworkPortForward,
    endpoint: NetworkEndpointLeaseV2 | undefined,
    reportedAt: string,
  ): void {
    if (!endpoint) {
      const candidateEvidenceTime =
        mapping.candidateValidatedAtWire ||
        (mapping.candidateValidatedAt
          ? new Date(mapping.candidateValidatedAt).toISOString()
          : null);
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

  private applyV2CurrentEndpoint(
    mapping: NetworkPortForward,
    endpoint: NetworkEndpointLeaseV2 | undefined,
    reportedAt: string,
  ): void {
    if (!endpoint) {
      const currentEvidenceAt =
        mapping.currentValidatedAtWire ||
        (mapping.currentValidatedAt
          ? new Date(mapping.currentValidatedAt).toISOString()
          : null);
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

  private withdrawV2CurrentEndpoint(mapping: NetworkPortForward): void {
    mapping.currentPublicIpv4 = null;
    mapping.currentPublicPort = null;
    mapping.currentObservedAt = null;
    mapping.currentValidatedAt = null;
    mapping.currentValidatedAtWire = null;
    mapping.currentValidUntil = null;
    mapping.currentEndpointIdentity = null;
  }

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
    mapping.lastPublishedAt = mapping.currentValidatedAt
      ? new KtDateTime(mapping.currentValidatedAt)
      : new KtDateTime();
  }

  private isV2CurrentPublishable(
    desired: NetworkDesiredChannelV2,
    reported: NetworkReportedChannelV2,
    reportedAt: string,
  ): reported is NetworkReportedChannelV2 & {
    currentEndpoint: NetworkEndpointLeaseV2;
  } {
    const current = reported.currentEndpoint;
    const lastObserved = reported.lastObservedEndpoint;
    if (
      desired.desiredPresence !== 'present' ||
      reported.syncStatus !== 'synced' ||
      !reported.routerPresent ||
      !current ||
      !lastObserved ||
      !this.sameV2EndpointTuple(current, lastObserved) ||
      !this.isV2EndpointLeaseFresh(current, reportedAt) ||
      !this.isV2EndpointLeaseFresh(lastObserved, reportedAt)
    ) {
      return false;
    }
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

  private currentEndpointTuple(mapping: NetworkPortForward): string {
    return mapping.currentPublicIpv4 && mapping.currentPublicPort
      ? `${mapping.currentPublicIpv4}:${mapping.currentPublicPort}`
      : '';
  }

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

  private async stageV2UdpPortChange(
    manager: EntityManager,
    mapping: NetworkPortForward,
    currentHistory: NetworkEndpointHistory | undefined,
    previousHistory: NetworkEndpointHistory | undefined,
  ): Promise<boolean> {
    if (
      !currentHistory ||
      (currentHistory.eventType !== 'changed' &&
        currentHistory.eventType !== 'restored') ||
      !this.isV2HistoryMatchingCurrent(mapping, currentHistory) ||
      !this.isValidPort(previousHistory?.publicPort) ||
      !this.isValidPort(currentHistory.publicPort) ||
      previousHistory.publicPort === currentHistory.publicPort
    ) {
      return false;
    }
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

  private async stageV2TcpEndpointChange(
    manager: EntityManager,
    mapping: NetworkPortForward,
    currentHistory: NetworkEndpointHistory | undefined,
    previousHistory: NetworkEndpointHistory | undefined,
  ): Promise<boolean> {
    if (
      !currentHistory ||
      (currentHistory.eventType !== 'changed' &&
        currentHistory.eventType !== 'restored') ||
      !previousHistory ||
      previousHistory.eventType === 'withdrawn' ||
      !this.isV2HistoryMatchingCurrent(mapping, currentHistory) ||
      isIP(previousHistory.publicIpv4 || '') !== 4 ||
      isIP(currentHistory.publicIpv4 || '') !== 4 ||
      !this.isValidPort(previousHistory.publicPort) ||
      !this.isValidPort(currentHistory.publicPort) ||
      (previousHistory.publicIpv4 === currentHistory.publicIpv4 &&
        previousHistory.publicPort === currentHistory.publicPort)
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
      if (ignoreAfterV2Capability && state.maxSupportedSchemaVersion >= 2) {
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

  requestV2Downgrade(): Promise<boolean> {
    return Promise.resolve(false);
  }

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
      const immediatePreviousHistory = isTcpRestored
        ? null
        : await repository.findOne({
            lock: { mode: 'pessimistic_read' },
            order: { occurredAt: 'DESC', id: 'DESC' },
            where: {
              mappingId: event.channelId,
              mechanism: event.mechanism,
            },
          });
      const previousHistory =
        event.type === 'restored' && !isTcpRestored
          ? immediatePreviousHistory?.eventType === 'withdrawn'
            ? await repository.findOne({
                lock: { mode: 'pessimistic_read' },
                order: { occurredAt: 'DESC', id: 'DESC' },
                where: {
                  eventType: Not('withdrawn'),
                  mappingId: event.channelId,
                  mechanism: event.mechanism,
                },
              })
            : null
          : immediatePreviousHistory;
      const observedAt = event.endpoint?.observedAt || event.occurredAt;
      const history = repository.create({
        endpointValidatedAt: event.endpoint
          ? new KtDateTime(event.endpoint.validatedAt)
          : null,
        endpointValidUntil: event.endpoint
          ? new KtDateTime(event.endpoint.validUntil)
          : null,
        endpointIdentity: event.endpoint
          ? endpointLeaseIdentityV2(event.endpoint)
          : null,
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
        const deliveryAccepted = this.canStageV2EventAgainstCurrent(
          mapping,
          event,
        )
          ? event.protocol === 'tcp'
            ? event.type === 'restored'
              ? await this.stageMatchingV2TcpHistory(
                  manager,
                  mapping,
                  event.eventId,
                )
              : await this.stageV2TcpEndpointChange(
                  manager,
                  mapping,
                  history,
                  previousHistory || undefined,
                )
            : await this.stageV2UdpPortChange(
                manager,
                mapping,
                history,
                previousHistory || undefined,
              )
          : false;
        return { changed: true, deliveryAccepted };
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) throw error;
        return { changed: false, deliveryAccepted: false };
      }
    });
  }

  private canStageV2EventAgainstCurrent(
    mapping: NetworkPortForward,
    event: NetworkEndpointEventV2,
  ): boolean {
    const expectedMechanism =
      event.protocol === 'tcp' ? 'tcp_natmap' : 'udp_stun';
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
      state.appliedSchemaVersion,
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
    return (
      this.releasePolicy ||
      new NetworkTcpReleasePolicyService(this.configService)
    );
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
