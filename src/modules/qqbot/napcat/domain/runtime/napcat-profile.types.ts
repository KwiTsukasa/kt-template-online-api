export type NapcatRuntimeProfileSnapshot = {
  accountId: string;
  containerId?: string;
  dataDir: string;
  desktopProfileVersion: string;
  deviceIdentityId?: string;
  imageRef: string;
  locale: 'zh_CN.UTF-8';
  persistCache: true;
  persistLocalShare: true;
  persistLogs: true;
  runtimeGid: number;
  runtimeUid: number;
  shmSize: string;
  timezone: 'Asia/Shanghai';
  xdgCacheHome: '/app/.cache';
  xdgConfigHome: '/app/.config';
  xdgDataHome: '/app/.local/share';
};

export type NapcatProtocolProfileSnapshot = {
  o3HookGrayEnabled: boolean;
  o3HookMode: 0 | 1;
  onebotConfigHash: string;
  packetBackend: 'auto';
  packetServer: '';
};

export type NapcatConfigFile = {
  content: string;
  path: string;
};
