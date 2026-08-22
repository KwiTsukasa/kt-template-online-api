import { Image, loadImage } from 'skia-canvas';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { bangdreamCatalogRepository } from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';
import { stringToNumberArray } from '@/modules/plugins/bangdream/src/domain/common/model-utils';
import {
  BANGDREAM_DIFFICULTY_COLORS,
  BANGDREAM_DIFFICULTY_NAME_BY_ID,
  BANGDREAM_DIFFICULTY_NAMES,
} from '@/modules/plugins/bangdream/src/domain/common/bangdream-protocol';
import { BANGDREAM_SONG_TAG_NAME } from '@/modules/plugins/bangdream/src/config/dictionary/default-dictionary';
import { songResourceRepository } from '@/modules/plugins/bangdream/src/domain/song/song-resource.repository';
import type { BestdoriNote } from '@/modules/plugins/bangdream/src/domain/song/song-chart-preview.layout';

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
    if (songData['publishedAt']) {
      this.publishedAt = stringToNumberArray(songData['publishedAt']);
    } else {
      this.publishedAt = [];
    }
    if (songData['closedAt']) {
      this.closedAt = stringToNumberArray(songData['closedAt']);
    } else {
      this.closedAt = [];
    }
    this.difficulty = songData['difficulty'];
    this.length = songData['length'];
    this.notes = songData['notes'];
    this.bpm = songData['bpm'];
    this.nickname = songData['nickname'];
    for (const i in this.difficulty) {
      const playLevel = this.difficulty[i].playLevel;
      this.songLevels.push((() => {
        if (playLevel !== undefined) {
          return playLevel;
        }
        return 0;
      })());
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
   * 根据当前运行态处理initFull；当 `this.isInitfull` 成立时直接结束且不产生返回值。
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
    if (songData['publishedAt']) {
      this.publishedAt = stringToNumberArray(songData['publishedAt']);
    } else {
      this.publishedAt = [];
    }
    if (songData['closedAt']) {
      this.closedAt = stringToNumberArray(songData['closedAt']);
    } else {
      this.closedAt = [];
    }
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
   * @returns 返回在 Song 模型中请求当前模型的远端详情数据；通过 `songResourceRepository.getDetail` 查询匹配的持久化记录。
   */
  async getData() {
    return await songResourceRepository.getDetail(this.songId);
  }
  /**
   * 按当前运行态读取歌曲Rip；从 `songResourceRepository.getSongRip` 读取歌曲Rip。
   * @returns 歌曲Rip。
   */
  getSongRip(): number {
    return songResourceRepository.getSongRip(this.songId);
  }
  /**
   * 按展示服务器组合缓存歌曲封面加载任务，同一服务器序列只读取并解码一次资源。
   * @param displayedServerList - 决定封面资源版本与缓存键顺序的服务器列表；默认依次使用日服和国服。
   * @returns 对应服务器组合的歌曲封面图片；首次请求会加载资源，后续复用缓存中的异步结果。
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
   * 按`displayedServerList`读取歌曲Jacket图片；从受控资源来源加载所需数据（`loadImage`）。
   * @param displayedServerList - 决定歌曲Jacket图片内容、边界或目标的 `displayedServerList` 值。
   * @returns 歌曲Jacket图片。
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
   * 根据当前歌曲与可选展示服务器列表，解析对应的歌曲封面图片 URL。
   * @param displayedServerList - 决定根据当前歌曲与可选展示服务器列表，解析对应的歌曲封面图片 URL内容、边界或目标的 `displayedServerList` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 根据当前歌曲与可选展示服务器列表，解析对应的歌曲封面图片 URL。
   */
  getSongJacketImageURL(displayedServerList?: Server[]): string {
    return songResourceRepository.resolveJacketImageUrl(
      this,
      displayedServerList,
    );
  }
  /**
   * 按`displayedServerList`读取歌曲Jacket图片路径；从 `songResourceRepository.getJacketImagePath` 读取歌曲Jacket图片路径。
   * @param displayedServerList - 决定歌曲Jacket图片路径内容、边界或目标的 `displayedServerList` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 歌曲Jacket图片路径。
   */
  getSongJacketImagePath(displayedServerList?: Server[]): string {
    return songResourceRepository.getJacketImagePath(this, displayedServerList);
  }
  /**
   * 按当前运行态读取标签名称；当 `this.tag == undefined` 成立时返回 `this.tag`。
   * @returns 标签名称。
   */
  getTagName(): string {
    if (this.tag == undefined) {
      return this.tag;
    }
    return tagNameList[this.tag];
  }
  /**
   * 按`difficultyId`读取歌曲Chart；从 `songResourceRepository.getChart` 读取歌曲Chart。
   * @param difficultyId - 用于精确定位难度的标识。
   * @returns 按输入顺序得到的歌曲Chart列表；没有匹配项时为空数组。
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
   * 根据`withFever`、`difficultyId`、`scoreUpMaxValue`处理calcMeta；当 `this.hasMeta == false` 成立时返回 `0`。
   * @param withFever - 决定calcMeta内容、边界或目标的 `withFever` 值。
   * @param difficultyId - 用于精确定位难度的标识。
   * @param scoreUpMaxValue - 决定calcMeta内容、边界或目标的 `scoreUpMaxValue` 值；省略时默认采用 `100`。
   * @param skillDuration - 决定calcMeta内容、边界或目标的 `skillDuration` 值；省略时默认采用 `7`。
   * @param accuracy - 决定calcMeta内容、边界或目标的 `accuracy` 值；省略时默认采用 `100`。
   * @returns 当前状态对应的calcMeta，取值为 `0`。
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
 * 按`mainServer`、`start`、`end`读取Present歌曲；从 `bangdreamCatalogRepository.getCollection` 读取Present歌曲。
 * @param mainServer - 决定Present歌曲内容、边界或目标的 `mainServer` 值。
 * @param start - 决定Present歌曲内容、边界或目标的 `start` 值；省略时默认采用 `Date.now()`。
 * @param end - 决定Present歌曲内容、边界或目标的 `end` 值；省略时默认采用 `Date.now()`。
 * @returns 按输入顺序得到的Present歌曲列表；没有匹配项时为空数组。
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
 * 按`withFever`、`mainServer`读取Meta排名数据；从 `bangdreamCatalogRepository.getNumericIds` 读取Meta排名数据。
 * @param withFever - 决定Meta排名数据内容、边界或目标的 `withFever` 值。
 * @param mainServer - 决定Meta排名数据内容、边界或目标的 `mainServer` 值。
 * @returns 按输入顺序得到的Meta排名数据列表；没有匹配项时为空数组。
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
 * 按`targetSong`、`withFever`、`mainServer`读取歌曲Meta排名摘要；从 `bangdreamCatalogRepository.getNumericIds` 读取歌曲Meta排名摘要。
 * @param targetSong - 用于歌曲Meta排名摘要的领域对象，包含 `songId` 字段。
 * @param withFever - 决定歌曲Meta排名摘要内容、边界或目标的 `withFever` 值。
 * @param mainServer - 决定歌曲Meta排名摘要内容、边界或目标的 `mainServer` 值。
 * @returns 包含 `entries`、`maxMeta` 字段的歌曲Meta排名摘要。
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
    const song = (() => {
      if (songId === targetSong.songId) {
        return targetSong;
      }
      return new Song(songId);
    })();
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
    if (metaDiff === 0) {
      return a.order - b.order;
    }
    return metaDiff;
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
 * 根据 `song.publishedAt[mainServer] != null && Object.keys(song.notes).length > 0 && song.hasM…` 判定输入是否满足条件。
 * @param song - 用于歌曲Meta排名Candidate的领域对象，包含 `publishedAt`、`notes`、`hasMeta` 字段。
 * @param mainServer - 决定歌曲Meta排名Candidate内容、边界或目标的 `mainServer` 值。
 * @returns 满足歌曲Meta排名Candidate约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
 */
function isSongMetaRankCandidate(song: Song, mainServer: Server): boolean {
  return (
    song.publishedAt[mainServer] != null &&
    Object.keys(song.notes).length > 0 &&
    song.hasMeta
  );
}

/**
 * 根据`rowMetas`、`targetMeta`、`targetOrder`处理数量稳定Meta排名。
 * @param rowMetas - 用于数量稳定Meta排名的领域对象，包含 `length`、`i` 字段。
 * @param targetMeta - 决定数量稳定Meta排名内容、边界或目标的 `targetMeta` 值。
 * @param targetOrder - 决定数量稳定Meta排名内容、边界或目标的 `targetOrder` 值。
 * @returns 数量稳定Meta排名。
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
