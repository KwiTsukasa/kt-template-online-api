import { Image, loadImage } from 'skia-canvas';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { bangDreamMainDataRepository } from '@/qqbot/plugins/bangDream/tsugu/models/main-data-repository';
import { stringToNumberArray } from '@/qqbot/plugins/bangDream/tsugu/models/model-utils';
import {
  BANGDREAM_DIFFICULTY_COLORS,
  BANGDREAM_DIFFICULTY_NAME_BY_ID,
  BANGDREAM_DIFFICULTY_NAMES,
  BANGDREAM_SONG_TAG_NAME,
} from '@/qqbot/plugins/bangDream/tsugu/models/bangdream-constants';
import { songResourceRepository } from '@/qqbot/plugins/bangDream/tsugu/models/song-resource-repository';

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
   * @param songId - 歌曲 ID。
   */
  constructor(songId: number) {
    this.songId = songId;
    const songData = bangDreamMainDataRepository.getEntity<Record<string, any>>(
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
    const metaData = bangDreamMainDataRepository.getEntity<Record<string, any>>(
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
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
   * @returns 异步处理结果。
   */
  async getSongJacketImage(
    displayedServerList: Server[] = [Server.jp, Server.cn],
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
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
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
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
   * @returns 格式化后的资源路径。
   */
  getSongJacketImagePath(displayedServerList?: Server[]): string {
    return songResourceRepository.getJacketImagePath(this, displayedServerList);
  }
  /**
   * 在 Song 模型中获取Tag名称。
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
   * @param difficultyId - 难度ID参数。
   * @returns 异步处理结果。
   */
  async getSongChart(difficultyId: number): Promise<object> {
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
   * @param withFever - withFever参数。
   * @param difficultyId - 难度ID参数。
   * @param scoreUpMaxValue - 分数UpMax值参数，未传入时使用默认值。
   * @param skillDuration - 技能Duration参数，未传入时使用默认值。
   * @param accruacy - accruacy参数，未传入时使用默认值。
   * @returns 计算后的数值。
   */
  calcMeta(
    withFever: boolean,
    difficultyId: number,
    scoreUpMaxValue: number = 100,
    skillDuration: number = 7,
    accruacy: number = 100,
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
      skillParameter * ((1.1 * accruacy) / 100 + 0.8 * (1 - accruacy / 100));
    return scoreParameter;
  }
}

//获取时间范围内指定服务器推出的新歌
/**
 * 在BangDream 领域模型层中获取Present歌曲列表。
 *
 * @param mainServer - 主数据服务器参数。
 * @param start - start参数，未传入时使用默认值。
 * @param end - end参数，未传入时使用默认值。
 * @returns 处理后的列表。
 */
export function getPresentSongList(
  mainServer: Server,
  start: number = Date.now(),
  end: number = Date.now(),
): Song[] {
  const songList: Array<Song> = [];
  const songListMain = bangDreamMainDataRepository.getCollection('songs');

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
/**
 * 在BangDream 领域模型层中获取MetaRanking。
 *
 * @param withFever - withFever参数。
 * @param mainServer - 主数据服务器参数。
 * @returns 处理后的列表。
 */
export function getMetaRanking(
  withFever: boolean,
  mainServer: Server,
): SongInRank[] {
  const songIdList = bangDreamMainDataRepository.getNumericIds('meta');
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
