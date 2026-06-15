import { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import {
  match,
  FuzzySearchResult,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { drawDataBlockHorizontal } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { drawSongInList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-list.renderer';
import { drawDottedLine } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-dotted-line';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { drawSongDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-detail.renderer';
import { createBangDreamEntityMatcher } from '@/modules/qqbot/plugins/bangdream/src/domain/search/entity-list-matcher';
import { songRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.repository';
import {
  createHorizontalSeparatorSpec,
  createVerticalSeparatorSpec,
} from '@/modules/qqbot/plugins/bangdream/src/theme/layout';

// 紧凑化虚线分割
const line = drawDottedLine(createHorizontalSeparatorSpec({ height: 10 }));

//表格用默认竖向虚线
const line2: Canvas = drawDottedLine(createVerticalSeparatorSpec(6000));

/**
 * 在QQBot 图片视图层中绘制歌曲列表。
 *
 * @param matches - 模糊搜索命中结果。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawSongList(
  matches: FuzzySearchResult,
  displayedServerList: Server[] = globalDefaultServer,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  // 计算歌曲模糊搜索结果
  const tempSongList = matchSongList(matches, displayedServerList);

  if (tempSongList.length == 0) {
    return ['没有搜索到符合条件的歌曲'];
  }
  if (tempSongList.length == 1) {
    return await drawSongDetail(tempSongList[0], displayedServerList, compress);
  }

  const maxHeight = 6000;

  let tempSongImageList: Canvas[] = [];
  const songImageListHorizontal: Canvas[] = [];
  let tempH = 0;
  const songImages = await renderSongListItemsSequentially(
    tempSongList,
    displayedServerList,
  );

  for (let i = 0; i < songImages.length; i++) {
    const tempImage = songImages[i];
    tempH += tempImage.height;
    if (tempH > maxHeight) {
      tempSongImageList.pop();
      songImageListHorizontal.push(stackImage(tempSongImageList));
      songImageListHorizontal.push(line2);
      tempSongImageList = [];
      tempH = tempImage.height;
    }
    tempSongImageList.push(tempImage);
    tempSongImageList.push(line);
    if (i == tempSongList.length - 1) {
      tempSongImageList.pop();
      songImageListHorizontal.push(stackImage(tempSongImageList));
      songImageListHorizontal.push(line2);
    }
  }

  songImageListHorizontal.pop();

  const songListImage = drawDataBlockHorizontal({
    list: songImageListHorizontal,
  });

  const all = [];
  all.push(drawTitle('查询', '歌曲列表'));
  all.push(songListImage);
  return await outputEasyImages(all, { compress });
}

// 计算歌曲模糊搜索结果
export const matchSongList = createBangDreamEntityMatcher<Song>({
  source: () => songRepository.getSource(),
  /**
   * 在QQBot 图片视图层中创建Entity。
   *
   * @param songId - 歌曲 ID。
   */
  createEntity: (songId) => songRepository.create(songId),
  /**
   * 在QQBot 图片视图层中判断Released。
   *
   * @param song - 歌曲参数。
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
   */
  isReleased: (song, displayedServerList) =>
    displayedServerList.some((server) => song.publishedAt[server] != null),
  /**
   * 在QQBot 图片视图层中判断Matched。
   *
   * @param matches - 模糊搜索命中结果。
   * @param song - 歌曲参数。
   */
  isMatched: (matches, song) => match(matches, song, []),
  /**
   * 在QQBot 图片视图层中处理关系表达式值。
   *
   * @param song - 歌曲参数。
   */
  relationValue: (song) => song.songId,
});

export type SongListItemRenderer = (
  song: Song,
  difficulty: number | undefined,
  text: string | undefined,
  displayedServerList: Server[],
) => Promise<Canvas>;

/**
 * 在歌曲列表中顺序渲染单项，避免并发 Skia 图片解码导致 native 内存峰值过高。
 *
 * @param songs - 待绘制歌曲列表。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
 * @param renderItem - 单项渲染函数，未传入时使用默认歌曲列表渲染器。
 */
export async function renderSongListItemsSequentially(
  songs: Song[],
  displayedServerList: Server[],
  renderItem: SongListItemRenderer = drawSongInList,
): Promise<Canvas[]> {
  const songImages: Canvas[] = [];
  for (const song of songs) {
    songImages.push(
      await renderItem(song, undefined, undefined, displayedServerList),
    );
  }
  return songImages;
}
