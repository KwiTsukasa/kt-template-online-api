import {
  Song,
  getMetaRanking,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { Canvas } from 'skia-canvas';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { drawSongInList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-list.renderer';
import { drawDottedLine } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-dotted-line';
import { stackImageHorizontal } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { serverNameFullList } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { drawDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';

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
 * 在QQBot 图片视图层中绘制歌曲Meta列表。
 *
 * @param mainServer - 主数据服务器参数。
 * @param compress - compress参数。
 * @returns 异步处理结果。
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
 * 在QQBot 图片视图层中绘制MetaRank列表数据块。
 *
 * @param withFever - withFever参数。
 * @param mainServer - 主数据服务器参数。
 * @returns 异步处理结果。
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
  const topLeftText = withFever ? '有Fever' : '无Fever';
  return drawDataBlock({ list, topLeftText });
}
