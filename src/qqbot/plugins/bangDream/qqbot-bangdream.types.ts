export type BestdoriLocalizedText = Array<null | string>;

export type BestdoriSongListItem = {
  musicTitle?: BestdoriLocalizedText;
};

export type BestdoriSongInfo = {
  bandId?: number;
  bpm?: Record<string, Array<{ bpm?: number }>>;
  difficulty?: Record<string, { playLevel?: number }>;
  length?: number;
  musicTitle?: BestdoriLocalizedText;
  notes?: Record<string, number>;
  publishedAt?: BestdoriLocalizedText;
  tag?: string;
};

export type BestdoriBandListItem = {
  bandName?: BestdoriLocalizedText;
};

export type QqbotBangDreamSongSearchInput = {
  query?: string;
  raw?: string;
  text?: string;
};

export type QqbotBangDreamSongSummary = {
  bandName: string;
  bpmText: string;
  difficultyText: string;
  id: number;
  lengthText: string;
  notesText: string;
  publishedText: string;
  replyText: string;
  tagText: string;
  title: string;
  url: string;
};
