import { Song } from '@/qqbot/plugins/bangDream/tsugu/models/song';
import {
  match,
  FuzzySearchResult,
} from '@/qqbot/plugins/bangDream/tsugu/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/title';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/canvas/output';
import { drawDataBlockHorizontal } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/data-block';
import { drawSongInList } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-song';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/tsugu/canvas/dotted-line';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { drawSongDetail } from './song-detail';
import { createTsuguEntityMatcher } from '@/qqbot/plugins/bangDream/tsugu/search/entity-list-matcher';
import { songRepository } from '@/qqbot/plugins/bangDream/tsugu/models/song-repository';

// 紧凑化虚线分割
const line = drawDottedLine({
  width: 800,
  height: 10,
  startX: 5,
  startY: 5,
  endX: 795,
  endY: 5,
  radius: 2,
  gap: 10,
  color: '#a8a8a8',
});

//表格用默认竖向虚线
const line2: Canvas = drawDottedLine({
  width: 30,
  height: 6000,
  startX: 10,
  startY: 0,
  endX: 15,
  endY: 5990,
  radius: 2,
  gap: 10,
  color: '#a8a8a8',
});

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
  const songPromises: Promise<Canvas>[] = [];

  for (let i = 0; i < tempSongList.length; i++) {
    songPromises.push(
      drawSongInList(
        tempSongList[i],
        undefined,
        undefined,
        displayedServerList,
      ),
    );
  }

  const songImages = await Promise.all(songPromises);

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
export const matchSongList = createTsuguEntityMatcher<Song>({
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
