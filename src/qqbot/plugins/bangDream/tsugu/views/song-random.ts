import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { createOutputFinalImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { Song } from '@/qqbot/plugins/bangDream/tsugu/domain/song';
import { drawSongDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { matchSongList } from '@/qqbot/plugins/bangDream/tsugu/views/song-list';
import { FuzzySearchResult } from '@/qqbot/plugins/bangDream/tsugu/fuzzy-search';

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
function getRandomInt(max: number): number {
  return Math.floor(Math.random() * Math.floor(max));
}
