import type { QqbotBangDreamOperationKey } from '@/qqbot/plugins/bangDream/registry/operation-registry';

export type { QqbotBangDreamOperationKey } from '@/qqbot/plugins/bangDream/registry/operation-registry';

export type QqbotBangDreamCommandInput = {
  args?: string[];
  cardId?: number | string;
  compress?: boolean | string;
  difficulty?: number | string;
  difficultyText?: string;
  displayedServerList?: Array<number | string> | string;
  eventId?: number | string;
  gachaId?: number | string;
  mainServer?: number | string;
  meta?: boolean | string;
  playerId?: number | string;
  query?: string;
  raw?: string;
  server?: number | string;
  serverName?: number | string;
  songId?: number | string;
  text?: string;
  tier?: number | string;
  times?: number | string;
  useEasyBG?: boolean | string;
};

export type QqbotBangDreamCommandOutput = {
  imageCount: number;
  operationKey: QqbotBangDreamOperationKey;
  query: string;
  replyText: string;
  source: string;
};

export type QqbotBangDreamSongSearchInput = {
  query?: string;
  raw?: string;
  text?: string;
};

export type QqbotBangDreamSongSummary = QqbotBangDreamCommandOutput;
