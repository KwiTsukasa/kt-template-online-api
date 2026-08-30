import type { KtDateTime } from '@/common';
import type { EnvironmentDashboardResponse } from '../../environment-dashboard/domain/environment-dashboard.types';

export interface MobileHomeNoticeItem {
  content: string;
  createTime?: KtDateTime;
  eventType: string;
  id: string;
  isTop: boolean;
  lastSeenAt?: KtDateTime;
  occurrenceCount: number;
  severity: string;
  source: string;
  status: number;
  summary?: string;
  title: string;
}

export interface MobileHomeNoticeSnapshot {
  items: MobileHomeNoticeItem[];
  total: number;
  unreadCount: number;
}

export interface MobileHomeBootstrapResponse {
  environment: EnvironmentDashboardResponse;
  notices: MobileHomeNoticeSnapshot;
}

export interface MobileHomeEntityAttributeSnapshot {
  key: string;
  value: boolean | number | string | null | number[];
}

export interface MobileHomeEntitySnapshot {
  areaId?: string;
  attributes: MobileHomeEntityAttributeSnapshot[];
  deviceId?: string;
  domain: string;
  entityId: string;
  name: string;
  state: string;
  updatedAt?: string;
}

export interface MobileHomeAreaSnapshot {
  entityCount: number;
  floorId?: string;
  id: string;
  name: string;
}

export interface MobileHomeSceneSnapshot {
  domain: 'automation' | 'scene' | 'script';
  enabled: boolean;
  entityId: string;
  lastChanged?: string;
  name: string;
}

export interface MobileHomeActivitySnapshot {
  entityId?: string;
  id: string;
  observedAt: string;
  severity: 'info' | 'success' | 'warning';
  summary: string;
}

export interface MobileHomeEnergyPoint {
  observedAt: string;
  value: number;
}

export interface MobileHomeEnergyEntitySnapshot {
  entityId: string;
  name: string;
  points: MobileHomeEnergyPoint[];
  state: number;
  unit: string;
}

export interface MobileHomeHomeSnapshotResponse {
  activities: MobileHomeActivitySnapshot[];
  areas: MobileHomeAreaSnapshot[];
  connected: boolean;
  energy: MobileHomeEnergyEntitySnapshot[];
  entities: MobileHomeEntitySnapshot[];
  generatedAt: string;
  scenes: MobileHomeSceneSnapshot[];
}

export interface MobileHomeServiceCallRequest {
  data?: Record<string, unknown>;
  domain: string;
  entityId: string;
  requestId: string;
  service: string;
}

export interface MobileHomeServiceCallResponse {
  entity?: MobileHomeEntitySnapshot;
  requestId: string;
}

export interface MobileHomeAssistRequest {
  conversationId?: string;
  language?: string;
  text: string;
}

export interface MobileHomeAssistResponse {
  continueConversation: boolean;
  conversationId?: string;
  responseType: string;
  speech: string;
}

export interface MobileGameAppSnapshot {
  id: string;
  imagePath?: string;
  name: string;
}

export interface MobileGameSnapshotResponse {
  apps: MobileGameAppSnapshot[];
  generatedAt: string;
  host: string;
  httpsPort: number;
  managementReady: boolean;
  streamPort: number;
  virtualGamepadReady: boolean;
}

export interface MobileGamePinRequest {
  name: string;
  pin: string;
}

export interface MobileGamePinResponse {
  accepted: boolean;
}
