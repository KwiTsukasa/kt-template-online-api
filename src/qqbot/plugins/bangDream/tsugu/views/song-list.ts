import { Song } from '@/qqbot/plugins/bangDream/tsugu/domain/song';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import {
  match,
  checkRelationList,
  FuzzySearchResult,
} from '@/qqbot/plugins/bangDream/tsugu/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { drawDataBlockHorizontal } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { drawSongInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/song';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/tsugu/graphics/dotted-line';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { drawSongDetail } from './song-detail';

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
export function matchSongList(
  matches: FuzzySearchResult,
  displayedServerList: Server[],
) {
  const tempSongList: Array<Song> = [];
  const songIdList: Array<number> = Object.keys(mainAPI['songs']).map(Number);
  for (let i = 0; i < songIdList.length; i++) {
    const tempSong = new Song(songIdList[i]);
    let isMatch = match(matches, tempSong, []);
    //如果在所有所选服务器列表中都不存在，则不输出
    let numberOfNotReleasedServer = 0;
    for (let j = 0; j < displayedServerList.length; j++) {
      const server = displayedServerList[j];
      if (tempSong.publishedAt[server] == null) {
        numberOfNotReleasedServer++;
      }
    }
    if (numberOfNotReleasedServer == displayedServerList.length) {
      isMatch = false;
    }

    //如果有数字关系词，则判断关系词
    if (matches._relationStr != undefined) {
      //如果之后范围的话则直接判断
      if (isMatch || Object.keys(matches).length == 1) {
        isMatch = checkRelationList(
          tempSong.songId,
          matches._relationStr as string[],
        );
      }
    }

    if (isMatch) {
      tempSongList.push(tempSong);
    }
  }
  return tempSongList;
}
