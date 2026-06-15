export type QqbotBangDreamOperationKey =
  | 'bangdream.card.illustration'
  | 'bangdream.card.search'
  | 'bangdream.character.search'
  | 'bangdream.cutoff.all'
  | 'bangdream.cutoff.detail'
  | 'bangdream.cutoff.recent'
  | 'bangdream.event.search'
  | 'bangdream.event.stage'
  | 'bangdream.gacha.search'
  | 'bangdream.gacha.simulate'
  | 'bangdream.player.search'
  | 'bangdream.song.chart'
  | 'bangdream.song.meta'
  | 'bangdream.song.random'
  | 'bangdream.song.search';

export type QqbotBangDreamOperationHandlerName =
  | 'getCardIllustration'
  | 'getCutoffAll'
  | 'getCutoffDetail'
  | 'getCutoffRecent'
  | 'getEventStage'
  | 'getSongChart'
  | 'getSongMeta'
  | 'randomSong'
  | 'searchCard'
  | 'searchCharacter'
  | 'searchEvent'
  | 'searchGacha'
  | 'searchPlayer'
  | 'searchSong'
  | 'simulateGacha';

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
