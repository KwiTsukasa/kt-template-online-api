import {
  Song,
  getMetaRanking,
} from '@/modules/plugins/bangdream/src/domain/song/song.model';
import { Canvas } from 'skia-canvas';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { drawSongInList } from '@/modules/plugins/bangdream/src/domain/song/song-list.renderer';
import { drawDottedLine } from '@/modules/plugins/bangdream/src/theme/canvas-dotted-line';
import { stackImageHorizontal } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { serverNameFullList } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { drawDataBlock } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';

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

/**
 * 根据`mainServer`、`compress`绘制或格式化歌曲Meta；把图片、文本或图形按布局规格绘制到画布。
 * @param mainServer - 决定歌曲Meta内容、边界或目标的 `mainServer` 值。
 * @param compress - 决定歌曲Meta内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的歌曲Meta列表；没有匹配项时为空数组。
 */
export async function drawSongMetaList(
  mainServer: Server,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const feverMode = [true, false];
  const imageList = [];
  for (let i = 0; i < feverMode.length; i++) {
    const element = feverMode[i];
    imageList.push(await drawMetaRankListDataBlock(element, mainServer));
  }
  const all = [];
  all.push(drawTitle('查询', `${serverNameFullList[mainServer]} 分数排行榜`));
  all.push(stackImageHorizontal(imageList));
  return await outputEasyImages(all, { compress });
}

/**
 * 根据`withFever`、`mainServer`绘制或格式化Meta排名数据Block；从 `getMetaRanking` 读取Meta排名数据Block。
 * @param withFever - 决定Meta排名数据Block内容、边界或目标的 `withFever` 值。
 * @param mainServer - 决定Meta排名数据Block内容、边界或目标的 `mainServer` 值。
 * @returns Meta排名数据Block。
 */
async function drawMetaRankListDataBlock(
  withFever: boolean,
  mainServer: Server,
): Promise<Canvas> {
  const metaRanking = getMetaRanking(withFever, mainServer);
  const maxMeta = metaRanking[0].meta;
  const list: Array<Canvas> = [];
  for (let i = 0; i < 50; i++) {
    const song = new Song(metaRanking[i].songId);
    const difficultyId = metaRanking[i].difficulty;
    let percent = (metaRanking[i].meta / maxMeta) * 100;
    percent = Math.round(percent * 100) / 100;
    list.push(
      await drawSongInList(
        song,
        difficultyId,
        `相对分数: ${percent}% #${metaRanking[i].rank + 1}`,
      ),
    );
    list.push(line);
  }
  list.pop();
  const topLeftText = (() => {
    if (withFever) {
      return '有Fever';
    }
    return '无Fever';
  })();
  return drawDataBlock({ list, topLeftText });
}
