import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { createOutputFinalImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { Song } from '@/modules/plugins/bangdream/src/domain/song/song.model';
import { drawSongDataBlock } from '@/modules/plugins/bangdream/src/theme/detail-block.renderer';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { matchSongList } from '@/modules/plugins/bangdream/src/domain/song/song-search.renderer';
import { FuzzySearchResult } from '@/modules/plugins/bangdream/src/domain/search/fuzzy-search';

/**
 * 根据`matches`、`displayedServerList`、`useEasyBG`绘制或格式化歌曲Random；当 `tempSongList.length == 0` 成立时返回 `['没有搜索到符合条件的歌曲']`。
 * @param matches - 决定歌曲Random内容、边界或目标的 `matches` 值。
 * @param displayedServerList - 决定歌曲Random内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @param useEasyBG - 决定是否启用“useEasyBG”分支的布尔选项。
 * @param compress - 决定歌曲Random内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的歌曲Random列表；没有匹配项时为空数组。
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
 * 返回从 `0` 到小于向下取整上限的随机整数。
 * @param max - 决定从 `0` 到小于向下取整上限的随机整数内容、边界或目标的 `max` 值。
 * @returns 从 `0` 到小于向下取整上限的随机整数。
 */
function getRandomInt(max: number): number {
  return Math.floor(Math.random() * Math.floor(max));
}
