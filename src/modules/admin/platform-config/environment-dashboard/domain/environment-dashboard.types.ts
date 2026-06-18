export type EnvironmentHealthStatus =
  | 'ok'
  | 'degraded'
  | 'down'
  | 'blocked'
  | 'isolated'
  | 'unknown'
  | 'unwired';

export type EnvironmentSiteStatus =
  | 'online'
  | 'degraded'
  | 'isolated'
  | 'unknown';

export type EnvironmentSignalSourceKind =
  | 'live'
  | 'cached'
  | 'derived'
  | 'configured'
  | 'external-link'
  | 'unwired';

export type EnvironmentEventSourceKind =
  | 'local'
  | 'mqtt'
  | EnvironmentSignalSourceKind;

export type EnvironmentStreamEventType =
  | 'environment-event'
  | 'environment-signal'
  | 'snapshot-required'
  | 'heartbeat'
  | 'error';

export interface EnvironmentEvidence {
  source: string;
  sourceKind: EnvironmentSignalSourceKind;
  summary: string;
  observedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentSignal {
  id: string;
  label: string;
  status: EnvironmentHealthStatus;
  sourceKind: EnvironmentSignalSourceKind;
  summary: string;
  evidence: EnvironmentEvidence[];
  observedAt?: string;
  staleAfterSeconds?: number;
}

export interface EnvironmentService {
  id: string;
  label: string;
  status: EnvironmentHealthStatus;
  signals: EnvironmentSignal[];
  summary?: string;
}

export interface EnvironmentNode {
  id: string;
  label: string;
  services: EnvironmentService[];
  status?: EnvironmentHealthStatus;
  summary?: string;
}

export interface EnvironmentSite {
  id: string;
  label: string;
  status: EnvironmentSiteStatus;
  nodes: EnvironmentNode[];
  summary?: string;
}

export interface EnvironmentDashboardSummary {
  blocked?: number;
  degraded?: number;
  down?: number;
  ok?: number;
  unknown?: number;
  unwired?: number;
  totalSignals: number;
  byStatus?: Record<EnvironmentHealthStatus, number>;
}

export interface EnvironmentTopologyNode {
  id: string;
  label: string;
  siteId: string;
  serviceId?: string;
  status: EnvironmentHealthStatus | EnvironmentSiteStatus;
}

export interface EnvironmentTopologyEdge {
  id: string;
  from?: string;
  source: string;
  to?: string;
  target: string;
  label?: string;
}

export interface EnvironmentTopology {
  nodes: EnvironmentTopologyNode[];
  edges: EnvironmentTopologyEdge[];
}

export interface EnvironmentAction {
  id: string;
  label: string;
  siteId?: string;
  serviceId?: string;
  enabled: boolean;
  kind: 'readonly' | 'write-risk';
  riskLevel?: 'high' | 'low' | 'medium';
  disabledReason?: string;
}

export interface EnvironmentEvent {
  id: string;
  type?: EnvironmentStreamEventType;
  topic: string;
  siteId: string;
  nodeId?: string;
  serviceId?: string;
  signalId?: string;
  severity: EnvironmentHealthStatus;
  sourceKind: EnvironmentEventSourceKind;
  observedAt: string;
  expiresAt?: string;
  retained?: boolean;
  summary: string;
  evidence?: EnvironmentEvidence[];
}

export interface EnvironmentEventEnvelope {
  eventId: string;
  topic: string;
  siteId: string;
  nodeId?: string;
  serviceId?: string;
  signalId?: string;
  severity: EnvironmentHealthStatus;
  sourceKind: EnvironmentEventSourceKind;
  observedAt: string;
  expiresAt?: string;
  retained?: boolean;
  summary: string;
  evidence?: EnvironmentEvidence[];
}

export interface EnvironmentDashboardResponse {
  generatedAt: string;
  refreshedAt: string;
  summary: EnvironmentDashboardSummary;
  sites: EnvironmentSite[];
  topology: EnvironmentTopology;
  actions: EnvironmentAction[];
  events: EnvironmentEvent[];
}

export interface EnvironmentStreamEvent {
  id?: string;
  type: EnvironmentStreamEventType;
  data:
    | EnvironmentEvent
    | EnvironmentSignal
    | { message: string; observedAt: string };
}
