import { MODULE_METADATA } from '@nestjs/common/constants';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import {
  ADMIN_PLATFORM_CONFIG_PROVIDERS,
  AdminPlatformConfigModule,
} from '../../../src/modules/admin/platform-config/admin-platform-config.module';
import { NetworkAgentMqttService } from '../../../src/modules/admin/platform-config/network-management/network-agent-mqtt.service';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/network-agent-state.entity';
import { NetworkDdnsRecord } from '../../../src/modules/admin/platform-config/network-management/network-ddns.entity';
import { NetworkDdnsService } from '../../../src/modules/admin/platform-config/network-management/network-ddns.service';
import { NetworkDnsPodClient } from '../../../src/modules/admin/platform-config/network-management/network-dnspod.client';
import { NetworkEndpointHistory } from '../../../src/modules/admin/platform-config/network-management/network-endpoint-history.entity';
import { NetworkPortForwardGroup } from '../../../src/modules/admin/platform-config/network-management/network-port-forward-group.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';
import { NetworkManagementService } from '../../../src/modules/admin/platform-config/network-management/network-management.service';

describe('network management persistence module', () => {
  it('registers the five exact database entity tables', () => {
    const tables = getMetadataArgsStorage().tables.filter((table) =>
      [
        NetworkPortForward,
        NetworkAgentState,
        NetworkEndpointHistory,
        NetworkDdnsRecord,
        NetworkPortForwardGroup,
      ].includes(table.target as never),
    );
    expect(tables.map((table) => table.name).sort()).toEqual([
      'network_agent_state',
      'network_ddns_record',
      'network_endpoint_history',
      'network_port_forward',
      'network_port_forward_group',
    ]);
  });

  it('keeps v2 group/channel metadata and datetime decorators in TypeORM storage', () => {
    const storage = getMetadataArgsStorage();
    const groupColumns = storage.columns.filter(
      (column) => column.target === NetworkPortForwardGroup,
    );
    const channelColumns = storage.columns.filter(
      (column) => column.target === NetworkPortForward,
    );
    const agentColumns = storage.columns.filter(
      (column) => column.target === NetworkAgentState,
    );
    const historyColumns = storage.columns.filter(
      (column) => column.target === NetworkEndpointHistory,
    );
    const featureProviders = (
      Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        AdminPlatformConfigModule,
      ) as {
        module?: unknown;
        providers?: { provide?: unknown }[];
      }[]
    ).flatMap((imported) => imported.providers ?? []);

    expect(groupColumns.map((column) => column.options.name)).toEqual(
      expect.arrayContaining([
        'create_time',
        'external_port',
        'internal_port',
        'protocol_mode',
        'target_ipv4',
        'update_time',
      ]),
    );
    expect(
      groupColumns.find((column) => column.propertyName === 'createTime')?.mode,
    ).toBe('createDate');
    expect(
      groupColumns.find((column) => column.propertyName === 'updateTime')?.mode,
    ).toBe('updateDate');
    expect(channelColumns.map((column) => column.options.name)).toEqual(
      expect.arrayContaining([
        'active_group_protocol_key',
        'candidate_observed_at',
        'candidate_validated_at',
        'candidate_validated_at_wire',
        'current_endpoint_identity',
        'current_validated_at',
        'current_validated_at_wire',
        'group_id',
        'last_observed_validated_at',
        'last_observed_validated_at_wire',
        'last_published_at',
        'last_reported_at',
        'last_reported_at_wire',
        'natmap_desired_enabled',
      ]),
    );
    expect(
      channelColumns.find((column) => column.propertyName === 'groupId')
        ?.options.type,
    ).toBe('bigint');
    expect(
      channelColumns.find(
        (column) => column.propertyName === 'candidateObservedAt',
      )?.options.type,
    ).toBe('datetime');
    expect(
      channelColumns.find((column) => column.propertyName === 'lastReportedAt')
        ?.options,
    ).toEqual(
      expect.objectContaining({
        name: 'last_reported_at',
        nullable: true,
        precision: 6,
        type: 'datetime',
      }),
    );
    expect(
      channelColumns.find(
        (column) => column.propertyName === 'lastReportedAtWire',
      )?.options,
    ).toEqual(
      expect.objectContaining({
        length: 64,
        name: 'last_reported_at_wire',
        nullable: true,
      }),
    );
    expect(agentColumns.map((column) => column.options.name)).toEqual(
      expect.arrayContaining([
        'applied_schema_version',
        'desired_schema_version',
        'published_schema_version',
        'max_supported_schema_version',
        'tcp_natmap_capable',
      ]),
    );
    expect(
      agentColumns.find((column) => column.propertyName === 'version')?.options
        .length,
    ).toBe(128);
    for (const propertyName of [
      'lastMqttErrorMessage',
      'lastReconcileErrorMessage',
    ]) {
      expect(
        agentColumns.find((column) => column.propertyName === propertyName)
          ?.options.length,
      ).toBe(512);
    }
    expect(
      historyColumns.find((column) => column.propertyName === 'mechanism')
        ?.options.name,
    ).toBe('mechanism');
    expect(
      historyColumns.find((column) => column.propertyName === 'sourceRevision')
        ?.options,
    ).toEqual(
      expect.objectContaining({
        name: 'source_revision',
        nullable: true,
        type: 'bigint',
      }),
    );
    expect(
      historyColumns.find(
        (column) => column.propertyName === 'endpointIdentity',
      )?.options,
    ).toEqual(
      expect.objectContaining({
        length: 64,
        name: 'endpoint_identity',
        nullable: true,
      }),
    );
    expect(
      Reflect.getMetadata(
        'design:type',
        NetworkEndpointHistory.prototype,
        'sourceRevision',
      ),
    ).toBe(String);
    for (const [propertyName, columnName] of [
      ['endpointValidatedAt', 'endpoint_validated_at'],
      ['endpointValidUntil', 'endpoint_valid_until'],
    ]) {
      expect(
        historyColumns.find((column) => column.propertyName === propertyName)
          ?.options,
      ).toEqual(
        expect.objectContaining({
          name: columnName,
          nullable: true,
          precision: 6,
          type: 'datetime',
        }),
      );
    }
    expect(featureProviders.map((provider) => provider.provide)).toContain(
      getRepositoryToken(NetworkPortForwardGroup),
    );
    expect(
      storage.indices.some(
        (index) =>
          index.target === NetworkPortForward &&
          index.name === 'uk_network_port_forward_active_group_protocol_key' &&
          index.unique === true,
      ),
    ).toBe(true);
    expect(
      storage.relations.filter((relation) =>
        [NetworkPortForward, NetworkPortForwardGroup].includes(
          relation.target as never,
        ),
      ),
    ).toHaveLength(0);
  });

  it('registers the persisted service and dedicated MQTT bridge without router-specific clients', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AdminPlatformConfigModule,
    );
    expect(ADMIN_PLATFORM_CONFIG_PROVIDERS).toEqual(
      expect.arrayContaining([
        NetworkManagementService,
        NetworkDdnsService,
        NetworkDnsPodClient,
        NetworkAgentMqttService,
      ]),
    );
    expect(providers).toEqual(
      expect.arrayContaining([
        NetworkManagementService,
        NetworkDdnsService,
        NetworkDnsPodClient,
        NetworkAgentMqttService,
      ]),
    );
  });
});
