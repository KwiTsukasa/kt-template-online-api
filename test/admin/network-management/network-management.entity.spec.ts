import { MODULE_METADATA } from '@nestjs/common/constants';
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
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';
import { NetworkManagementService } from '../../../src/modules/admin/platform-config/network-management/network-management.service';

describe('network management persistence module', () => {
  it('registers the four exact database entity tables', () => {
    const tables = getMetadataArgsStorage().tables.filter((table) =>
      [
        NetworkPortForward,
        NetworkAgentState,
        NetworkEndpointHistory,
        NetworkDdnsRecord,
      ].includes(table.target as never),
    );
    expect(tables.map((table) => table.name).sort()).toEqual([
      'network_agent_state',
      'network_ddns_record',
      'network_endpoint_history',
      'network_port_forward',
    ]);
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
