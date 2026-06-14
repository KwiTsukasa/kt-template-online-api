import { Song } from '@/modules/qqbot/plugins/bangDream/song/song.model';
import {
  match,
  FuzzySearchResult,
} from '@/modules/qqbot/plugins/bangDream/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawTitle } from '@/modules/qqbot/plugins/bangDream/shared/title.renderer';
import { outputEasyImages } from '@/modules/qqbot/plugins/bangDream/theme/canvas-output';
import { drawDataBlockHorizontal } from '@/modules/qqbot/plugins/bangDream/shared/data-block.renderer';
import { drawSongInList } from '@/modules/qqbot/plugins/bangDream/song/song-list.renderer';
import { drawDottedLine } from '@/modules/qqbot/plugins/bangDream/theme/canvas-dotted-line';
import { stackImage } from '@/modules/qqbot/plugins/bangDream/shared/image-stack';
import { Server } from '@/modules/qqbot/plugins/bangDream/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangDream/config/runtime-config';
import { drawSongDetail } from '@/modules/qqbot/plugins/bangDream/song/song-detail.renderer';
import { createTsuguEntityMatcher } from '@/modules/qqbot/plugins/bangDream/search/entity-list-matcher';
import { songRepository } from '@/modules/qqbot/plugins/bangDream/song/song.repository';
import {
  createHorizontalSeparatorSpec,
  createVerticalSeparatorSpec,
} from '@/modules/qqbot/plugins/bangDream/theme/layout';

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
