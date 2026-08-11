import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import { KtDateTime } from '../../../src/common';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/network-agent-state.entity';
import { NetworkDdnsRecord } from '../../../src/modules/admin/platform-config/network-management/network-ddns.entity';
import {
  NETWORK_OPEN_REDIRECT_TARGETS,
  NetworkOpenRedirectService,
} from '../../../src/modules/admin/platform-config/network-management/network-open-redirect.service';
import { NetworkPortForwardGroup } from '../../../src/modules/admin/platform-config/network-management/network-port-forward-group.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';

type ReadyState = {
  agent: NetworkAgentState | null;
  ddns: NetworkDdnsRecord | null;
  group: NetworkPortForwardGroup | null;
  mapping: NetworkPortForward | null;
};

type Harness = {
  dataSource: { transaction: jest.Mock };
  findAgent: jest.Mock;
  findDdns: jest.Mock;
  findGroup: jest.Mock;
  findMapping: jest.Mock;
  service: NetworkOpenRedirectService;
};

function readyState(): ReadyState {
  const mapping = Object.assign(new NetworkPortForward(), {
    activeKey: 'tcp:10443',
    currentEndpointIdentity: 'a'.repeat(64),
    currentPublicIpv4: '112.32.125.92',
    currentPublicPort: 52418,
    currentValidUntil: new KtDateTime(Date.now() + 60_000),
    desiredPresence: 'present',
    desiredRevision: '42',
    externalPort: 10443,
    groupId: '200',
    id: '100',
    internalPort: 10443,
    isDeleted: false,
    natmapDesiredEnabled: true,
    natmapStatus: 'active',
    protocol: 'tcp',
    reportedRevision: '42',
    syncStatus: 'synced',
    targetIpv4: '192.168.31.224',
  });
  return {
    mapping,
    group: Object.assign(new NetworkPortForwardGroup(), {
      externalPort: 10443,
      id: '200',
      internalPort: 10443,
      isDeleted: false,
      protocolMode: 'tcp',
      targetIpv4: '192.168.31.224',
    }),
    ddns: Object.assign(new NetworkDdnsRecord(), {
      activeKey: 'a:nas4.kwitsukasa.top',
      appliedAddress: '112.32.125.92',
      enabled: true,
      id: '300',
      isDeleted: false,
      portForwardId: '100',
      recordType: 'A',
      sourceAddress: '112.32.125.92',
      sourceType: 'port_forward_ipv4',
      syncStatus: 'synced',
    }),
    agent: Object.assign(new NetworkAgentState(), {
      agentId: 'nas-main',
      online: true,
      targetIpv4: '192.168.31.224',
    }),
  };
}

function createHarness(state = readyState()): Harness {
  const findMapping = jest.fn(async () => state.mapping);
  const findGroup = jest.fn(async () => state.group);
  const findDdns = jest.fn(async () => state.ddns);
  const findAgent = jest.fn(async () => state.agent);
  const repositories = new Map<unknown, { findOne: jest.Mock }>([
    [NetworkPortForward, { findOne: findMapping }],
    [NetworkPortForwardGroup, { findOne: findGroup }],
    [NetworkDdnsRecord, { findOne: findDdns }],
    [NetworkAgentState, { findOne: findAgent }],
  ]);
  const manager = {
    getRepository: jest.fn((entity) => repositories.get(entity)),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(
      async (
        _isolation: string,
        work: (transaction: EntityManager) => Promise<unknown>,
      ) => work(manager),
    ),
  };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'NETWORK_AGENT_ID' ? 'nas-main' : undefined,
    ),
  } as unknown as ConfigService;

  return {
    dataSource,
    findAgent,
    findDdns,
    findGroup,
    findMapping,
    service: new NetworkOpenRedirectService(
      dataSource as unknown as DataSource,
      configService,
    ),
  };
}

describe('NetworkOpenRedirectService', () => {
  it.each(Object.entries(NETWORK_OPEN_REDIRECT_TARGETS))(
    'resolves fixed service %s without accepting any target input',
    async (serviceKey, target) => {
      const harness = createHarness();

      await expect(harness.service.resolve(serviceKey)).resolves.toEqual({
        endpointGeneration: 'a'.repeat(64),
        endpointIpv4: '112.32.125.92',
        endpointValidUntil: expect.any(String),
        location: `https://${target.host}:52418${target.path}`,
        status: 'found',
      });

      expect(harness.dataSource.transaction).toHaveBeenCalledWith(
        'REPEATABLE READ',
        expect.any(Function),
      );
      expect(harness.findMapping).toHaveBeenCalledWith({
        where: { activeKey: 'tcp:10443' },
      });
      expect(harness.findGroup).toHaveBeenCalledWith({
        where: { id: '200' },
      });
      expect(harness.findDdns).toHaveBeenCalledWith({
        where: { activeKey: 'a:nas4.kwitsukasa.top' },
      });
      expect(harness.findAgent).toHaveBeenCalledWith({
        where: { agentId: 'nas-main' },
      });
    },
  );

  it.each([
    'ADMIN',
    'admin/extra',
    'https://evil.example',
    '//evil.example',
    'admin\\evil',
    'mcs',
    '',
  ])(
    'rejects unknown or injectable service key %j before database access',
    async (key) => {
      const harness = createHarness();

      await expect(harness.service.resolve(key)).resolves.toEqual({
        status: 'not_found',
      });
      expect(harness.dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  const unavailableCases: [string, (state: ReadyState) => void][] = [
    ['missing mapping', (state) => (state.mapping = null)],
    ['deleted mapping', (state) => (state.mapping!.isDeleted = true)],
    [
      'absent desired state',
      (state) => (state.mapping!.desiredPresence = 'absent'),
    ],
    [
      'disabled NATMap intent',
      (state) => (state.mapping!.natmapDesiredEnabled = false),
    ],
    ['non-TCP channel', (state) => (state.mapping!.protocol = 'udp')],
    ['pending sync', (state) => (state.mapping!.syncStatus = 'pending')],
    ['inactive NATMap', (state) => (state.mapping!.natmapStatus = 'failed')],
    [
      'reported revision lag',
      (state) => (state.mapping!.reportedRevision = '41'),
    ],
    [
      'invalid desired revision',
      (state) => (state.mapping!.desiredRevision = 'not-a-revision'),
    ],
    [
      'missing endpoint identity',
      (state) => (state.mapping!.currentEndpointIdentity = ''),
    ],
    [
      'invalid endpoint identity',
      (state) => (state.mapping!.currentEndpointIdentity = 'not-a-digest'),
    ],
    [
      'expired endpoint lease',
      (state) =>
        (state.mapping!.currentValidUntil = new KtDateTime(Date.now())),
    ],
    [
      'invalid endpoint IPv4',
      (state) => (state.mapping!.currentPublicIpv4 = '2001:db8::1'),
    ],
    [
      'private endpoint IPv4',
      (state) => (state.mapping!.currentPublicIpv4 = '192.168.31.224'),
    ],
    [
      'carrier NAT endpoint IPv4',
      (state) => (state.mapping!.currentPublicIpv4 = '100.64.0.1'),
    ],
    [
      'invalid endpoint port',
      (state) => (state.mapping!.currentPublicPort = 0),
    ],
    ['missing group', (state) => (state.group = null)],
    ['deleted group', (state) => (state.group!.isDeleted = true)],
    ['mismatched group port', (state) => (state.group!.externalPort = 10444)],
    ['group without TCP', (state) => (state.group!.protocolMode = 'udp')],
    [
      'mismatched group target',
      (state) => (state.group!.targetIpv4 = '192.168.31.225'),
    ],
    ['missing DDNS', (state) => (state.ddns = null)],
    ['disabled DDNS', (state) => (state.ddns!.enabled = false)],
    ['pending DDNS', (state) => (state.ddns!.syncStatus = 'pending')],
    [
      'DDNS bound to another channel',
      (state) => (state.ddns!.portForwardId = '101'),
    ],
    [
      'DDNS source differs from endpoint',
      (state) => (state.ddns!.sourceAddress = '112.32.125.93'),
    ],
    [
      'DDNS provider value differs from endpoint',
      (state) => (state.ddns!.appliedAddress = '112.32.125.93'),
    ],
    ['missing Agent', (state) => (state.agent = null)],
    ['offline Agent', (state) => (state.agent!.online = false)],
    [
      'Agent target differs from channel',
      (state) => (state.agent!.targetIpv4 = '192.168.31.225'),
    ],
  ];

  it.each(unavailableCases)(
    'returns unavailable for %s',
    async (_name, mutate) => {
      const state = readyState();
      mutate(state);
      const harness = createHarness(state);

      await expect(harness.service.resolve('admin')).resolves.toEqual({
        status: 'unavailable',
      });
    },
  );
});
