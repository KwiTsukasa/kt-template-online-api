import { Injectable } from '@nestjs/common';
import type {
  BestdoriBandListItem,
  BestdoriLocalizedText,
  BestdoriSongInfo,
  BestdoriSongListItem,
  QqbotBangDreamSongSearchInput,
  QqbotBangDreamSongSummary,
} from './qqbot-bangdream.types';

type BangDreamSongIndexItem = {
  id: number;
  keys: string[];
  title: string;
  titles: string[];
};

const BESTDORI_API_BASE_URL = 'https://bestdori.com/api';
const BESTDORI_WEB_BASE_URL = 'https://bestdori.com';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const TEXT_INDEX_PRIORITY = [3, 1, 2, 0, 4];
const DIFFICULTY_LABELS: Record<string, string> = {
  '0': 'EASY',
  '1': 'NORMAL',
  '2': 'HARD',
  '3': 'EXPERT',
  '4': 'SPECIAL',
};
const TAG_LABELS: Record<string, string> = {
  normal: '原创',
  cover: '翻唱',
  tie_up: '联动',
};

@Injectable()
export class QqbotBangDreamClientService {
  private bandCache?: {
    expiresAt: number;
    map: Map<number, string>;
  };
  private songIndexCache?: {
    entries: BangDreamSongIndexItem[];
    expiresAt: number;
  };

  async checkHealth() {
    await this.getSongIndex();
    return true;
  }

  async searchSong(
    params: QqbotBangDreamSongSearchInput,
  ): Promise<QqbotBangDreamSongSummary> {
    const query = this.pickQuery(params);
    if (!query) throw new Error('请提供 BangDream 歌曲名或歌曲 ID');

    const matched = await this.findSong(query);
    if (!matched) throw new Error(`未找到 BangDream 歌曲：${query}`);

    const [song, bands] = await Promise.all([
      this.requestJson<BestdoriSongInfo>(`/songs/${matched.id}.json`),
      this.getBandMap(),
    ]);
    return this.buildSongSummary(matched.id, song, bands);
  }

  private async findSong(query: string) {
    const songId = Number(query);
    const entries = await this.getSongIndex();
    if (Number.isInteger(songId) && songId > 0) {
      return entries.find((item) => item.id === songId) || null;
    }

    const key = this.normalizeLookupKey(query);
    const exact = entries.find((item) => item.keys.includes(key));
    if (exact) return exact;

    return (
      entries.find((item) => item.keys.some((itemKey) => itemKey.includes(key))) ||
      null
    );
  }

  private async getSongIndex() {
    if (this.songIndexCache && Date.now() < this.songIndexCache.expiresAt) {
      return this.songIndexCache.entries;
    }

    const data =
      await this.requestJson<Record<string, BestdoriSongListItem | null>>(
        '/songs/all.1.json',
      );
    const entries = Object.entries(data)
      .map(([id, item]) => this.toSongIndexItem(Number(id), item))
      .filter(Boolean) as BangDreamSongIndexItem[];
    this.songIndexCache = {
      entries,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return entries;
  }

  private toSongIndexItem(id: number, item?: BestdoriSongListItem | null) {
    if (!Number.isInteger(id) || !item?.musicTitle) return null;
    const titles = this.pickAllTexts(item.musicTitle);
    if (!titles.length) return null;
    return {
      id,
      keys: [...new Set(titles.map((title) => this.normalizeLookupKey(title)))],
      title: this.pickLocalizedText(item.musicTitle),
      titles,
    } satisfies BangDreamSongIndexItem;
  }

  private async getBandMap() {
    if (this.bandCache && Date.now() < this.bandCache.expiresAt) {
      return this.bandCache.map;
    }

    const data =
      await this.requestJson<Record<string, BestdoriBandListItem | null>>(
        '/bands/all.1.json',
      );
    const map = new Map<number, string>();
    for (const [id, item] of Object.entries(data)) {
      const bandId = Number(id);
      const bandName = this.pickLocalizedText(item?.bandName);
      if (Number.isInteger(bandId) && bandName) map.set(bandId, bandName);
    }
    this.bandCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      map,
    };
    return map;
  }

  private buildSongSummary(
    id: number,
    song: BestdoriSongInfo,
    bands: Map<number, string>,
  ): QqbotBangDreamSongSummary {
    const title = this.pickLocalizedText(song.musicTitle) || `歌曲 ${id}`;
    const bandName = bands.get(Number(song.bandId)) || '未知乐队';
    const result = {
      bandName,
      bpmText: this.formatBpm(song.bpm),
      difficultyText: this.formatDifficulty(song.difficulty),
      id,
      lengthText: this.formatLength(song.length),
      notesText: this.formatNotes(song.notes),
      publishedText: this.formatPublishedAt(song.publishedAt),
      tagText: TAG_LABELS[song.tag || ''] || song.tag || '未知类型',
      title,
      url: `${BESTDORI_WEB_BASE_URL}/info/songs/${id}`,
    } as QqbotBangDreamSongSummary;
    result.replyText = this.buildReplyText(result);
    return result;
  }

  private buildReplyText(result: Omit<QqbotBangDreamSongSummary, 'replyText'>) {
    return [
      `BangDream 歌曲：${result.title}`,
      `ID：${result.id}｜乐队：${result.bandName}｜类型：${result.tagText}`,
      `时长：${result.lengthText}｜BPM：${result.bpmText}`,
      `难度：${result.difficultyText}`,
      `物量：${result.notesText}`,
      result.publishedText ? `国服上线：${result.publishedText}` : '',
      result.url,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private pickQuery(params: QqbotBangDreamSongSearchInput) {
    return `${params.query || params.text || params.raw || ''}`.trim();
  }

  private pickLocalizedText(values?: BestdoriLocalizedText) {
    if (!Array.isArray(values)) return '';
    for (const index of TEXT_INDEX_PRIORITY) {
      const value = values[index];
      if (value) return value;
    }
    return values.find((value) => !!value) || '';
  }

  private pickAllTexts(values: BestdoriLocalizedText) {
    return [
      ...new Set(
        values.map((value) => `${value || ''}`.trim()).filter(Boolean),
      ),
    ];
  }

  private formatDifficulty(value?: BestdoriSongInfo['difficulty']) {
    const parts = Object.entries(value || {}).map(([key, item]) => {
      const label = DIFFICULTY_LABELS[key] || key;
      return `${label}${item?.playLevel ?? '-'}`;
    });
    return parts.length ? parts.join(' / ') : '暂无';
  }

  private formatNotes(value?: BestdoriSongInfo['notes']) {
    const parts = Object.entries(value || {}).map(([key, notes]) => {
      const label = DIFFICULTY_LABELS[key] || key;
      return `${label}${notes ?? '-'}`;
    });
    return parts.length ? parts.join(' / ') : '暂无';
  }

  private formatBpm(value?: BestdoriSongInfo['bpm']) {
    const bpms = Object.values(value || {})
      .flat()
      .map((item) => Number(item?.bpm))
      .filter((item) => Number.isFinite(item));
    if (!bpms.length) return '暂无';
    const unique = [...new Set(bpms)].sort((left, right) => left - right);
    if (unique.length === 1) return `${unique[0]}`;
    return `${unique[0]}-${unique[unique.length - 1]}`;
  }

  private formatLength(value?: number) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '暂无';
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return `${minutes}:${`${rest}`.padStart(2, '0')}`;
  }

  private formatPublishedAt(values?: BestdoriLocalizedText) {
    const value = values?.[3];
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return '';
    return new Date(time).toLocaleDateString('zh-CN', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    });
  }

  private normalizeLookupKey(value: string) {
    return `${value || ''}`
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  private async requestJson<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${BESTDORI_API_BASE_URL}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'kt-template-online-api/qqbot',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Bestdori 接口失败：${response.status}`);
      }
      return (await response.json()) as T;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new Error('Bestdori 接口请求超时');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
