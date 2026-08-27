export type NatmapEndpointStatus = 'current' | 'stale' | 'unavailable';

export type NatmapEndpointSnapshot = {
  label: string;
  observedAt: null | string;
  publicPort: null | number;
  status: NatmapEndpointStatus;
  validUntil: null | string;
};

export type NatmapPortQueryStatus =
  | 'ambiguous'
  | 'current'
  | 'empty'
  | 'help'
  | 'invalid'
  | 'not-found'
  | 'stale'
  | 'unavailable';

export type NatmapPortQueryResult = {
  channel: null | string;
  observedAt: null | string;
  publicPort: null | number;
  replyText: string;
  status: NatmapPortQueryStatus;
  validUntil: null | string;
};

export type NatmapPortSelector =
  | { kind: 'help' }
  | { kind: 'invalid' }
  | { kind: 'query'; value: string };

export type NatmapEndpointResolution =
  | { channelCount: number; kind: 'ambiguous' }
  | { channelCount: number; kind: 'not-found' }
  | { endpoint: NatmapEndpointSnapshot; kind: 'found' }
  | { kind: 'empty' };
