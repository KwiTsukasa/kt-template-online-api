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
 * @param matches - BangDream列表；驱动 `matchSongList()` 的 BangDream步骤。
 * @param displayedServerList - displayedServerList 输入；驱动 `matchSongList()`、`drawSongDetail()`、`renderSongListItemsSequentially()` 的 BangDream步骤。
 * @param compress - BangDream列表；驱动 `drawSongDetail()` 的 BangDream步骤。
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
  /**
   * 执行 BangDream回调。
   */
  source: () => songRepository.getSource(),
  /**
   * 创建 BangDream 插件对象或配置。
   *
   * @param songId - 歌曲 ID；定位本次读取、更新、删除或关联的歌曲。
   */
  createEntity: (songId) => songRepository.create(songId),
  /**
   * 判断 BangDream 插件条件。
   *
   * @param song - song 输入；使用 `publishedAt` 字段计算判断结果。
   * @param displayedServerList - displayedServerList 输入；计算 BangDream布尔判断。
   */
  isReleased: (song, displayedServerList) =>
    displayedServerList.some((server) => song.publishedAt[server] != null),
  /**
   * 判断 BangDream 插件条件。
   *
   * @param matches - BangDream列表；驱动 `match()` 的 BangDream步骤。
   * @param song - song 输入；驱动 `match()` 的 BangDream步骤。
   */
  isMatched: (matches, song) => match(matches, song, []),
  /**
   * 在QQBot 图片视图层中处理关系表达式值。
   *
   * @param song - song 输入；使用 `songId` 字段生成结果。
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
 * @param songs - 歌曲列表；驱动 `for()` 的 BangDream步骤。
 * @param displayedServerList - displayedServerList 输入；驱动 `songImages.push()` 的 BangDream步骤。
 * @param renderItem - renderItem 输入；驱动 `songImages.push()` 的 BangDream步骤。
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
