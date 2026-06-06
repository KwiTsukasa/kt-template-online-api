import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';
import { drawTitle } from '@/qqbot/plugins/bangDream/shared/title.renderer';
import { createOutputFinalImages } from '@/qqbot/plugins/bangDream/theme/canvas-output';
import { Song } from '@/qqbot/plugins/bangDream/song/song.model';
import { drawSongDataBlock } from '@/qqbot/plugins/bangDream/shared/detail-block.renderer';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/config/runtime-config';
import { matchSongList } from '@/qqbot/plugins/bangDream/song/song-search.renderer';
import { FuzzySearchResult } from '@/qqbot/plugins/bangDream/search/fuzzy-search';

/**
 * 在QQBot 图片视图层中绘制歌曲Random。
 *
 * @param matches - 模糊搜索命中结果。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param useEasyBG - use简易背景参数。
 * @param compress - compress参数。
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
 * 在QQBot 图片视图层中获取RandomInt。
 *
 * @param max - max参数。
 * @returns 计算后的数值。
 */
function getRandomInt(max: number): number {
  return Math.floor(Math.random() * Math.floor(max));
}
