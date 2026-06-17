import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { createOutputFinalImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { drawSongDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.renderer';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { matchSongList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-search.renderer';
import { FuzzySearchResult } from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search';

/**
 * 在QQBot 图片视图层中绘制歌曲Random。
 *
 * @param matches - BangDream列表；驱动 `matchSongList()` 的 BangDream步骤。
 * @param displayedServerList - displayedServerList 输入；驱动 `matchSongList()` 的 BangDream步骤。
 * @param useEasyBG - useEasyBG 输入；影响 drawSongRandom 的返回值。
 * @param compress - BangDream列表；影响 drawSongRandom 的返回值。
 * @returns 异步处理结果。
 */
export async function drawSongRandom(
  matches: FuzzySearchResult,
  displayedServerList: Server[] = globalDefaultServer,
  useEasyBG: boolean,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  // 计算歌曲模糊搜索结果
  const tempSongList: Array<Song> = matchSongList(matches, displayedServerList);

  if (tempSongList.length == 0) {
    return ['没有搜索到符合条件的歌曲'];
  }

  //在搜索结果中随机选择一首歌曲
  const randomIndex = getRandomInt(tempSongList.length);
  const song = tempSongList[randomIndex];

  const all = [];
  all.push(drawTitle('查询', '随机歌曲'));

  //顶部歌曲信息框
  const songDataBlockImage = await drawSongDataBlock(song);
  all.push(songDataBlockImage);

  const songJacket = await song.getSongJacketImage();

  return await createOutputFinalImages({
    useEasyBG,
    BGimage: songJacket,
    text: 'Random Song',
    compress,
  })(all);
}

//输入max数字，返回一个0-max的随机整数
/**
 * 查询 BangDream 插件数据。
 *
 * @param max - max 输入；驱动 `Math.floor()` 的 BangDream步骤。
 * @returns 计算后的数值。
 */
function getRandomInt(max: number): number {
  return Math.floor(Math.random() * Math.floor(max));
}
