import { Song } from '@/modules/plugins/bangdream/src/domain/song/song.model';
import {
  match,
  FuzzySearchResult,
} from '@/modules/plugins/bangdream/src/domain/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { drawDataBlockHorizontal } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { drawSongInList } from '@/modules/plugins/bangdream/src/domain/song/song-list.renderer';
import { drawDottedLine } from '@/modules/plugins/bangdream/src/theme/canvas-dotted-line';
import { stackImage } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { drawSongDetail } from '@/modules/plugins/bangdream/src/domain/song/song-detail.renderer';
import { createBangDreamEntityMatcher } from '@/modules/plugins/bangdream/src/domain/search/entity-list-matcher';
import { songRepository } from '@/modules/plugins/bangdream/src/domain/song/song.repository';
import {
  createHorizontalSeparatorSpec,
  createVerticalSeparatorSpec,
} from '@/modules/plugins/bangdream/src/theme/layout';

// 紧凑化虚线分割
const line = drawDottedLine(createHorizontalSeparatorSpec({ height: 10 }));

//表格用默认竖向虚线
const line2: Canvas = drawDottedLine(createVerticalSeparatorSpec(6000));

/**
 * 通过 `matchSongList` 执行模式匹配。
 * @param matches - 决定歌曲内容、边界或目标的 `matches` 值。
 * @param displayedServerList - 决定歌曲内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @param compress - 决定歌曲内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的歌曲列表；没有匹配项时为空数组。
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
  createEntity: (songId) => songRepository.create(songId),
  isReleased: (song, displayedServerList) =>
    displayedServerList.some((server) => song.publishedAt[server] != null),
  isMatched: (matches, song) => match(matches, song, []),
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
 * @param songs - 决定歌曲条目集合Sequentially内容、边界或目标的 `songs` 值。
 * @param displayedServerList - 决定歌曲条目集合Sequentially内容、边界或目标的 `displayedServerList` 值。
 * @param renderItem - 负责完成歌曲条目集合Sequentially外部交互的受控能力；省略时默认采用 `drawSongInList`。
 * @returns 按输入顺序得到的歌曲条目集合Sequentially列表；没有匹配项时为空数组。
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
