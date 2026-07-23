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
import { NetworkAgentState } from './network-agent-state.entity';
import { NetworkEndpointHistory } from './network-endpoint-history.entity';
import { NetworkManagementEventStreamService } from './network-management-event-stream.service';
import { NetworkPortForward } from './network-management.entity';
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

  /**
   * Creates the dedicated network Agent MQTT bridge.
   * @param configService - Runtime broker, Agent, and client identity settings.
   * @param dataSource - Transaction boundary for publish acknowledgements and inbound state.
   * @param eventStream - SSE fan-out notified only after accepted inbound commits.
   * @param clientFactory - Optional deterministic MQTT client factory used by tests.
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly eventStream: NetworkManagementEventStreamService,
    @Optional()
    @Inject(NETWORK_MQTT_CLIENT_FACTORY)
    private readonly clientFactory?: NetworkMqttClientFactory,
  ) {}

  /** Opens a persistent MQTT 5 session and schedules convergence publication. */
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

  /** Prevents new recovery work, then closes timers and the persistent MQTT connection. */
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
   * Schedules publication after a committed desired-state mutation.
   * Broker unavailability never rejects the already accepted HTTP operation.
   */
  requestDesiredPublish(): void {
    this.publishRequested = true;
    this.startPublishDrain();
  }

  /**
   * Publishes the latest complete desired snapshot and waits for QoS 1 PUBACK.
   * @param force - Republish once even when published and desired revisions match.
   * @returns True when a snapshot reached PUBACK, otherwise false.
   */
  async publishLatestDesired(force = false): Promise<boolean> {
    if (!this.client?.connected) return false;
    const snapshot = await this.dataSource.transaction(async (manager) => {
      const state = await manager.getRepository(NetworkAgentState).findOne({
        where: { agentId: this.agentId() },
      });
      if (!state || BigInt(state.desiredRevision) === 0n) return null;
      if (
        !force &&
        BigInt(state.publishedRevision) >= BigInt(state.desiredRevision)
      ) {
        return null;
      }
      const mappings = await manager.getRepository(NetworkPortForward).find({
        where: { isDeleted: false },
      });
      return buildDesiredSnapshot(state, mappings);
    });
    if (!snapshot) return false;
    await this.publishWithPuback(
      this.topic('desired'),
      desiredSnapshotBytes(snapshot),
    );
    await this.markRevisionPublished(String(snapshot.revision));
    return true;
  }

  /**
   * Consumes one exact inbound Agent topic after parsing bounded JSON.
   * @param topic - Exact reported, status, or events topic.
   * @param payload - Untrusted MQTT payload.
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
    let source: NetworkStateChangeSource;
    if (topic === this.topic('reported')) {
      source = 'reported';
      changed = await this.applyReported(parseReportedSnapshot(parsed));
    } else if (topic === this.topic('status')) {
      source = 'status';
      changed = await this.applyStatus(parseStatusSnapshot(parsed));
    } else if (topic === this.topic('events')) {
      source = 'events';
      changed = await this.appendEndpointEvent(parseEndpointEvent(parsed));
    } else {
      throw new NetworkMessageValidationError('Unexpected network MQTT topic');
    }
    if (changed) this.eventStream.publishCommitted(source);
  }

  /** Restores exact subscriptions and one retained desired republish after each connection. */
  private handleConnect(): void {
    const client = this.client;
    if (this.shuttingDown || !client) return;
    this.recoveryInProgress = false;
    client.subscribe(
      {
        [this.topic('reported')]: { qos: 1 },
        [this.topic('status')]: { qos: 1 },
        [this.topic('events')]: { qos: 1 },
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
   * Delays MQTT QoS 1 acknowledgement until protocol validation and DB commit finish.
   * Permanent malformed messages are acknowledged and dropped; transient DB errors are not.
   * @param topic - Inbound exact topic.
   * @param payload - Raw MQTT bytes.
   * @param callback - MQTT.js protocol acknowledgement callback.
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
      if (error instanceof NetworkMessageValidationError) {
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

  /** Starts one serialized publisher drain without overlapping retained sends. */
  private startPublishDrain(): void {
    if (this.publishPromise) return;
    this.publishPromise = this.drainPublishRequests().finally(() => {
      this.publishPromise = null;
      if (this.publishRequested) this.startPublishDrain();
    });
  }

  /** Drains the current publication request and preserves retry state on failure. */
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
   * Resolves only after MQTT.js receives PUBACK for a retained QoS 1 publication.
   * @param topic - Fixed Agent desired topic.
   * @param payload - Stable snapshot bytes.
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
   * Advances published revision only after PUBACK and never beyond current desired state.
   * @param revision - PUBACK-confirmed desired revision.
   */
  private async markRevisionPublished(revision: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NetworkAgentState);
      const state = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: this.agentId() },
      });
      if (!state) return;
      const confirmed = BigInt(revision);
      if (
        confirmed > BigInt(state.publishedRevision) &&
        confirmed <= BigInt(state.desiredRevision)
      ) {
        state.publishedRevision = revision;
        await repository.save(state);
      }
    });
  }

  /**
   * Applies a full reported snapshot transactionally without creating desired rows.
   * @param report - Strict Agent report parsed from the retained topic.
   * @returns True only when persisted Admin-visible state changed.
   */
  private async applyReported(
    report: NetworkReportedSnapshot,
  ): Promise<boolean> {
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
        return { desiredChanged: false, visibleStateChanged: false };
      }
      const stateBefore = this.reportedAgentStateFingerprint(state);
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
        desiredChanged: finalizedDeletion,
        visibleStateChanged,
      };
    });
    if (result.desiredChanged) this.requestDesiredPublish();
    return result.visibleStateChanged;
  }

  /**
   * Refreshes or withdraws the current lease while retaining the last observation.
   * @param mapping - Persisted desired mapping being updated.
   * @param endpoint - Full current endpoint or explicit null withdrawal.
   * @param lastObserved - Most recent successful endpoint evidence, when available.
   * @param reportedAt - Snapshot time used to reject an out-of-order withdrawal.
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
   * Applies retained Agent online status without changing mapping sync semantics.
   * @param status - Strict retained status or LWT snapshot.
   * @returns True only when semantic Admin status changed; heartbeat time is still persisted.
   */
  private async applyStatus(status: NetworkStatusSnapshot): Promise<boolean> {
    this.assertAgentId(status.agentId);
    return await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NetworkAgentState);
      const state = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { agentId: status.agentId },
      });
      if (!state) {
        throw new NetworkMessageValidationError('Unknown network Agent');
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
        return false;
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
        return false;
      }
      const persistedStateBefore = this.statusPersistedStateFingerprint(state);
      const refreshStateBefore = this.statusRefreshStateFingerprint(state);
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
      if (
        this.statusPersistedStateFingerprint(state) !== persistedStateBefore
      ) {
        await repository.save(state);
      }
      return this.statusRefreshStateFingerprint(state) !== refreshStateBefore;
    });
  }

  /**
   * Appends one endpoint change event exactly once by event ID.
   * @param event - Strict endpoint transition parsed from the events topic.
   * @returns True only when a new history row committed.
   */
  private async appendEndpointEvent(
    event: NetworkEndpointEvent,
  ): Promise<boolean> {
    this.assertAgentId(event.agentId);
    return await this.dataSource.transaction(async (manager) => {
      const state = await manager.getRepository(NetworkAgentState).findOne({
        where: { agentId: event.agentId },
      });
      if (!state || BigInt(event.revision) > BigInt(state.desiredRevision)) {
        throw new NetworkMessageValidationError('Invalid event revision');
      }
      const mapping = await manager.getRepository(NetworkPortForward).findOne({
        where: { id: event.mappingId },
      });
      if (!mapping) {
        throw new NetworkMessageValidationError('Unknown event mapping');
      }
      const repository = manager.getRepository(NetworkEndpointHistory);
      if (await repository.findOne({ where: { eventId: event.eventId } })) {
        return false;
      }
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
        return true;
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) throw error;
        return false;
      }
    });
  }

  /**
   * Serializes every report-owned mapping field that must be persisted.
   * @param mapping - Current persisted mapping before or after one report application.
   * @returns Stable comparison including lease timestamps for database writes.
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
   * Serializes only semantic mapping changes that justify reloading the Admin page.
   * @param mapping - Current persisted mapping before or after one report application.
   * @returns Stable comparison excluding lease-renewal timestamps.
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
   * Serializes report-owned Agent fields shown by the network page.
   * @param state - Agent singleton before or after one reported snapshot.
   * @returns Stable comparison string for committed report changes.
   */
  private reportedAgentStateFingerprint(state: NetworkAgentState): string {
    return JSON.stringify([
      state.appliedRevision,
      state.desiredIssuedAt,
      state.desiredRevision,
      state.lastReconcileErrorCode,
      state.lastReconcileErrorMessage,
    ]);
  }

  /**
   * Serializes every status-topic field that must be persisted.
   * @param state - Agent singleton before or after one status snapshot.
   * @returns Stable comparison including heartbeat time for database writes.
   */
  private statusPersistedStateFingerprint(state: NetworkAgentState): string {
    return JSON.stringify([
      state.lastHeartbeatAt,
      state.lastMqttErrorCode,
      state.lastMqttErrorMessage,
      state.online,
      state.startedAt,
      state.version,
    ]);
  }

  /**
   * Serializes semantic Agent status without the continuously advancing heartbeat.
   * @param state - Agent singleton before or after one status snapshot.
   * @returns Stable comparison used to suppress heartbeat-only browser reloads.
   */
  private statusRefreshStateFingerprint(state: NetworkAgentState): string {
    return JSON.stringify([
      state.lastMqttErrorCode,
      state.lastMqttErrorMessage,
      state.online,
      state.startedAt,
      state.version,
    ]);
  }

  /** Validates that an inbound message belongs to the one configured Agent. */
  private assertAgentId(agentId: string): void {
    if (agentId !== this.agentId()) {
      throw new NetworkMessageValidationError('Unexpected network Agent ID');
    }
  }

  /** Returns the fixed configured Agent identifier. */
  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }

  /** Builds one exact topic under the fixed Agent namespace. */
  private topic(kind: 'desired' | 'events' | 'reported' | 'status'): string {
    return `kt/network/v1/agents/${this.agentId()}/${kind}`;
  }

  /** Returns the bounded publisher retry interval. */
  private retryMs(): number {
    const configured = Number(
      this.configService.get<string>('NETWORK_AGENT_MQTT_RETRY_MS'),
    );
    return Number.isFinite(configured) && configured >= 1000
      ? Math.min(configured, 60_000)
      : DEFAULT_RETRY_MS;
  }

  /**
   * Closes a stuck MQTT packet pipeline once, then reconnects the same persistent client.
   * A successful connect clears the single-flight guard; shutdown permanently suppresses recovery.
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
   * Logs a safe broker error classification and recovers a potentially stuck pipeline.
   * @param error - MQTT client error whose type is safe to expose in service logs.
   */
  private handleClientError(error: Error): void {
    if (this.shuttingDown) return;
    this.logger.warn(`Network Agent MQTT client error (${error.name})`);
    this.recoverClient();
  }

  /** Detects MySQL duplicate-key failures for QoS 1 event redelivery races. */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
