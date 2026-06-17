import { Image, loadImage } from 'skia-canvas';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { bangdreamCatalogRepository } from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';
import { stringToNumberArray } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import {
  BANGDREAM_DIFFICULTY_COLORS,
  BANGDREAM_DIFFICULTY_NAME_BY_ID,
  BANGDREAM_DIFFICULTY_NAMES,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import { BANGDREAM_SONG_TAG_NAME } from '@/modules/qqbot/plugins/bangdream/src/config/dictionary/default-dictionary';
import { songResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-resource.repository';
import type { BestdoriNote } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-chart-preview.layout';

export const difficultyName: Record<number, string> =
  BANGDREAM_DIFFICULTY_NAME_BY_ID;

export const tagNameList: Record<string, string> = BANGDREAM_SONG_TAG_NAME;

export const difficultyColorList = [...BANGDREAM_DIFFICULTY_COLORS];
export const difficultyNameList: string[] = [...BANGDREAM_DIFFICULTY_NAMES];

export class Song {
  songId: number;
  isExist = false;
  data: object;
  tag: string;
  bandId: number;
  jacketImage: Array<string>;
  musicTitle: Array<string | null>;
  publishedAt: Array<number | null>;
  closedAt: Array<number | null>;
  difficulty: {
    [difficultyId: number]: {
      playLevel: number;
      multiLiveScoreMap?: object;
      notesQuantity?: number;
      scoreC?: number;
      scoreB?: number;
      scoreA?: number;
      scoreS?: number;
      scoreSS?: number;
      publishedAt?: Array<number | null>;
    };
  };
  length: number;
  notes: {
    [difficultyId: number]: number;
  };
  bpm: {
    [difficultyId: number]: Array<{
      bpm: number;
      start: number;
      end: number;
    }>;
  };

  //other
  bgmId: string;
  bgmFile: string;
  seq: number;
  achievements: Array<{
    musicId: number;
    achievementType: string;
    rewardType: string;
    quantity: number;
  }>;
  detail: {
    lyricist: string[];
    composer: string[];
    arranger: string[];
  };
  howToGet: Array<string | null>;
  //用于模糊搜索
  songLevels: number[] = [];
  nickname: string | null = null;

  //meta数据
  hasMeta = false;
  private readonly songJacketImageCache = new Map<string, Promise<Image>>();

  meta: {
    [difficultyId: number]: {
      [skillDuration: number]: [
        withoutFeverWithoutSkill: number,
        withoutFeverWithSkill: number,
        withFeverWithoutSkill: number,
        withFeverWithSkill: number,
      ];
    };
  };

  isInitfull = false;

  /**
   * 构造 Song 实例，并初始化该模型的本地基础字段。
   *
   * @param songId - 歌曲 ID；定位本次读取、更新、删除或关联的歌曲。
   */
  constructor(songId: number) {
    this.songId = songId;
    const songData = bangdreamCatalogRepository.getEntity<Record<string, any>>(
      'songs',
      songId,
    );
    if (songData == undefined) {
      this.isExist = false;
      return;
    }

    this.isExist = true;
    this.data = songData;
    this.tag = songData['tag'];
    this.bandId = songData['bandId'];
    this.jacketImage = songData['jacketImage'];
    this.musicTitle = songData['musicTitle'];
    this.publishedAt = songData['publishedAt']
      ? stringToNumberArray(songData['publishedAt'])
      : [];
    this.closedAt = songData['closedAt']
      ? stringToNumberArray(songData['closedAt'])
      : [];
    this.difficulty = songData['difficulty'];
    this.length = songData['length'];
    this.notes = songData['notes'];
    this.bpm = songData['bpm'];
    this.nickname = songData['nickname'];
    for (const i in this.difficulty) {
      const playLevel = this.difficulty[i].playLevel;
      this.songLevels.push(playLevel !== undefined ? playLevel : 0);
    }

    //meta数据
    const metaData = bangdreamCatalogRepository.getEntity<Record<string, any>>(
      'meta',
      songId,
    );
    if (metaData == undefined) {
      return;
    }
    this.hasMeta = true;
    this.meta = metaData;
  }
  /**
   * 在 Song 模型中加载远端完整详情并标记初始化状态。
   */
  async initFull() {
    if (this.isInitfull) {
      return;
    }
    if (this.isExist == false) {
      return;
    }
    const songData = await this.getData();

    this.data = songData;

    this.tag = songData['tag'];
    this.bandId = songData['bandId'];
    this.jacketImage = songData['jacketImage'];
    this.musicTitle = songData['musicTitle'];
    this.publishedAt = songData['publishedAt']
      ? stringToNumberArray(songData['publishedAt'])
      : [];
    this.closedAt = songData['closedAt']
      ? stringToNumberArray(songData['closedAt'])
      : [];
    this.difficulty = songData['difficulty'];
    this.length = songData['length'];
    this.notes = songData['notes'];
    this.bpm = songData['bpm'];

    //other
    this.bgmId = songData['bgmId'];
    this.bgmFile = songData['bgmFile'];
    this.achievements = songData['achievements'];
    this.seq = songData['seq'];
    this.detail = {
      lyricist: songData['lyricist'],
      composer: songData['composer'],
      arranger: songData['arranger'],
    };
    this.howToGet = songData['howToGet'];

    this.isInitfull = true;
  }
  /**
   * 在 Song 模型中请求当前模型的远端详情数据。
   */
  async getData() {
    return await songResourceRepository.getDetail(this.songId);
  }
  /**
   * 在 Song 模型中获取歌曲资源批次。
   *
   * @returns 计算后的数值。
   */
  getSongRip(): number {
    return songResourceRepository.getSongRip(this.songId);
  }
  /**
   * 在 Song 模型中获取歌曲封面图片。
   *
   * @param displayedServerList - displayedServerList 输入；生成规范化文本。
   * @returns 异步处理结果。
   */
  async getSongJacketImage(
    displayedServerList: Server[] = [Server.jp, Server.cn],
  ): Promise<Image> {
    const cacheKey = displayedServerList.join(',');
    let jacketImage = this.songJacketImageCache.get(cacheKey);
    if (!jacketImage) {
      jacketImage = this.loadSongJacketImage(displayedServerList);
      this.songJacketImageCache.set(cacheKey, jacketImage);
    }
    return await jacketImage;
  }

  /**
   * 加载Song Jacket Image。
   * @param displayedServerList - displayedServerList 输入；驱动 `songResourceRepository.getJacketImageBuffer()` 的 BangDream步骤。
   * @returns 异步完成后的 BangDream 插件结果。
   */
  private async loadSongJacketImage(
    displayedServerList: Server[],
  ): Promise<Image> {
    const jacketImageBuffer = await songResourceRepository.getJacketImageBuffer(
      this,
      displayedServerList,
    );
    return await loadImage(jacketImageBuffer);
  }
  /**
   * 在 Song 模型中获取歌曲封面图片URL。
   *
   * @param displayedServerList - displayedServerList 输入；驱动 `songResourceRepository.resolveJacketImageUrl()` 的 BangDream步骤。
   * @returns 格式化后的文本。
   */
  getSongJacketImageURL(displayedServerList?: Server[]): string {
    return songResourceRepository.resolveJacketImageUrl(
      this,
      displayedServerList,
    );
  }
  /**
   * 在 Song 模型中获取歌曲封面图片资源路径。
   *
   * @param displayedServerList - displayedServerList 输入；驱动 `songResourceRepository.getJacketImagePath()` 的 BangDream步骤。
   * @returns 格式化后的资源路径。
   */
  getSongJacketImagePath(displayedServerList?: Server[]): string {
    return songResourceRepository.getJacketImagePath(this, displayedServerList);
  }
  /**
   * 查询 BangDream 插件数据。
   *
   * @returns 格式化后的文本。
   */
  getTagName(): string {
    if (this.tag == undefined) {
      return this.tag;
    }
    return tagNameList[this.tag];
  }
  /**
   * 在 Song 模型中获取歌曲谱面。
   *
   * @param difficultyId - BangDream ID；定位本次读取、更新、删除或关联的BangDream。
   * @returns 异步处理结果。
   */
  async getSongChart(difficultyId: number): Promise<BestdoriNote[]> {
    return await songResourceRepository.getChart(this.songId, difficultyId);
  }

  /*
    第一个键是歌曲ID，第二个键是难度ID，第三个键是技能时长
    取到的数组是[ 非fever非技能占比, 非fever技能占比, fever非技能占比, fever技能占比 ]
    天下EX，7秒技能的话就取meta[125][3][7]
    返回[ 1.7464, 2.1164, 2.0527, 2.789 ]
    协力带fever，只看2.0527, 2.789
    如果技能是115%的话总百分比为2.0527 + 215% * 2.789

    上面那个算出来之后，最后再乘准确度加成1.1 * P% + 0.8 * (1 - P%)
    得到的就和站上meta的数字一样了
    然后乘上队伍综合力就行
    */

  /**
   * 在 Song 模型中计算Meta。
   *
   * @param withFever - withFever 输入；决定 BangDream条件分支。
   * @param difficultyId - BangDream ID；定位本次读取、更新、删除或关联的BangDream。
   * @param scoreUpMaxValue - scoreUpMaxValue 输入；影响 calcMeta 的返回值。
   * @param skillDuration - skillDuration 输入；影响 calcMeta 的返回值。
   * @param accuracy - accuracy 输入；影响 calcMeta 的返回值。
   * @returns 计算后的数值。
   */
  calcMeta(
    withFever: boolean,
    difficultyId: number,
    scoreUpMaxValue: number = 100,
    skillDuration: number = 7,
    accuracy: number = 100,
  ): number {
    if (this.hasMeta == false) {
      return 0;
    }
    let skillParameter: number;
    if (withFever) {
      skillParameter =
        this.meta[difficultyId][skillDuration][2] +
        ((100 + scoreUpMaxValue) / 100) *
          this.meta[difficultyId][skillDuration][3];
    } else {
      skillParameter =
        this.meta[difficultyId][skillDuration][0] +
        ((100 + scoreUpMaxValue) / 100) *
          this.meta[difficultyId][skillDuration][1];
    }
    const scoreParameter =
      skillParameter * ((1.1 * accuracy) / 100 + 0.8 * (1 - accuracy / 100));
    return scoreParameter;
  }
}

//获取时间范围内指定服务器推出的新歌
/**
 * 查询 BangDream 插件数据。
 *
 * @param mainServer - mainServer 输入；决定 BangDream条件分支。
 * @param start - start 输入；决定 BangDream条件分支。
 * @param end - end 输入；决定 BangDream条件分支。
 * @returns 处理后的列表。
 */
export function getPresentSongList(
  mainServer: Server,
  start: number = Date.now(),
  end: number = Date.now(),
): Song[] {
  const songList: Array<Song> = [];
  const songListMain = bangdreamCatalogRepository.getCollection('songs');

  for (const songId in songListMain) {
    if (Object.prototype.hasOwnProperty.call(songListMain, songId)) {
      const song = new Song(parseInt(songId));
      // 检查活动的发布时间和结束时间是否在指定范围内
      if (song.publishedAt[mainServer] == null) {
        continue;
      }
      if (
        song.publishedAt[mainServer] <= end &&
        song.publishedAt[mainServer] >= start
      ) {
        songList.push(song);
      }
      for (const i in song.difficulty) {
        if (song.difficulty[i].publishedAt != undefined) {
          if (
            song.difficulty[i].publishedAt[mainServer] <= end &&
            song.difficulty[i].publishedAt[mainServer] >= start
          ) {
            songList.push(song);
          }
        }
      }
    }
  }

  return songList;
}
export interface SongInRank {
  songId: number;
  difficulty: number;
  meta: number;
  rank: number;
}

export interface SongMetaRankSummary {
  entries: Array<{
    difficulty: number;
    meta: number;
    rank: number;
  }>;
  maxMeta: number;
}

/**
 * 查询 BangDream 插件数据。
 *
 * @param withFever - withFever 输入；驱动 `song.calcMeta()` 的 BangDream步骤。
 * @param mainServer - mainServer 输入；决定 BangDream条件分支。
 * @returns 处理后的列表。
 */
export function getMetaRanking(
  withFever: boolean,
  mainServer: Server,
): SongInRank[] {
  const songIdList = bangdreamCatalogRepository.getNumericIds('meta');
  const songRankList: SongInRank[] = [];
  for (let i = 0; i < songIdList.length; i++) {
    const songId = songIdList[i];
    const song = new Song(songId);
    //如果在所选服务器都没有发布，或者难度信息缺失，则跳过
    if (
      song.publishedAt[mainServer] == null ||
      Object.keys(song.notes).length == 0
    ) {
      continue;
    }
    //如果没有meta数据，则跳过
    if (song.hasMeta == false) {
      continue;
    }
    //有一些song没有4 difficulty
    for (const j in song.difficulty) {
      const difficulty = parseInt(j);
      const meta = song.calcMeta(withFever, difficulty);
      songRankList.push({
        songId: song.songId,
        difficulty: difficulty,
        meta: meta,
        rank: 0,
      });
    }
  }
  songRankList.sort((a, b) => {
    return b.meta - a.meta;
  });
  for (let i = 0; i < songRankList.length; i++) {
    songRankList[i].rank = i;
  }
  return songRankList;
}

/**
 * 在BangDream 领域模型层中获取指定歌曲的Meta排名摘要。
 *
 * @param targetSong - targetSong 输入；使用 `songId` 字段生成结果。
 * @param withFever - withFever 输入；驱动 `song.calcMeta()` 的 BangDream步骤。
 * @param mainServer - mainServer 输入；决定 BangDream条件分支。
 * @returns 目标歌曲的排名条目与全局最大Meta。
 */
export function getSongMetaRankSummary(
  targetSong: Song,
  withFever: boolean,
  mainServer: Server,
): SongMetaRankSummary {
  const songIdList = bangdreamCatalogRepository.getNumericIds('meta');
  const rowMetas: number[] = [];
  const targetEntries: Array<{
    difficulty: number;
    meta: number;
    order: number;
  }> = [];
  let maxMeta = 0;

  for (let i = 0; i < songIdList.length; i++) {
    const songId = songIdList[i];
    const song = songId === targetSong.songId ? targetSong : new Song(songId);
    if (!isSongMetaRankCandidate(song, mainServer)) {
      continue;
    }
    for (const j in song.difficulty) {
      const difficulty = parseInt(j);
      const meta = song.calcMeta(withFever, difficulty);
      const order = rowMetas.length;
      rowMetas.push(meta);
      if (meta > maxMeta) {
        maxMeta = meta;
      }
      if (song.songId === targetSong.songId) {
        targetEntries.push({
          difficulty,
          meta,
          order,
        });
      }
    }
  }

  targetEntries.sort((a, b) => {
    const metaDiff = b.meta - a.meta;
    return metaDiff === 0 ? a.order - b.order : metaDiff;
  });

  return {
    entries: targetEntries.map((entry) => ({
      difficulty: entry.difficulty,
      meta: entry.meta,
      rank: countStableMetaRank(rowMetas, entry.meta, entry.order),
    })),
    maxMeta,
  };
}

/**
 * 判断 BangDream 插件条件。
 * @param song - song 输入；使用 `publishedAt`、`notes`、`hasMeta` 字段计算判断结果。
 * @param mainServer - mainServer 输入；计算 BangDream判断结果。
 * @returns 布尔值，表示 BangDream 插件条件是否满足。
 */
function isSongMetaRankCandidate(song: Song, mainServer: Server): boolean {
  return (
    song.publishedAt[mainServer] != null &&
    Object.keys(song.notes).length > 0 &&
    song.hasMeta
  );
}

/**
 * 执行 BangDream 插件流程。
 * @param rowMetas - BangDream列表；使用 `length` 字段生成结果。
 * @param targetMeta - targetMeta 输入；决定 BangDream条件分支。
 * @param targetOrder - targetOrder 输入；决定 BangDream条件分支。
 */
function countStableMetaRank(
  rowMetas: number[],
  targetMeta: number,
  targetOrder: number,
) {
  let rank = 0;
  for (let i = 0; i < rowMetas.length; i++) {
    const meta = rowMetas[i];
    if (meta > targetMeta || (meta === targetMeta && i < targetOrder)) {
      rank++;
    }
  }
  return rank;
}
