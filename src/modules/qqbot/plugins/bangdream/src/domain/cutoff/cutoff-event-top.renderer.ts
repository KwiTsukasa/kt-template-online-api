import { Image, Canvas } from 'skia-canvas';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { serverNameFullList } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { CutoffEventTop } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-event-top.model';
import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawEventDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.renderer';
import { drawDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { outputEasyImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { drawPlayerRankingInList } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-ranking.renderer';
import { drawCutoffEventTopChart } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-chart.renderer';

/**
 * 在QQBot 图片视图层中绘制档线活动排名。
 *
 * @param eventId - 活动 ID。
 * @param mainServer - 主数据服务器参数。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawCutoffEventTop(
  eventId: number,
  mainServer: Server,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const cutoffEventTop = new CutoffEventTop(eventId, mainServer);
  await cutoffEventTop.initFull();
  if (!cutoffEventTop.isExist) {
    return [`错误: ${serverNameFullList[mainServer]} 活动不存在或数据不足`];
  }
  const all = [];
  all.push(drawTitle('档线', `${serverNameFullList[mainServer]} 10档线`));
  const list: Array<Image | Canvas> = [];
  const event = new Event(eventId);
  all.push(await drawEventDataBlock(event, [mainServer]));

  //前十名片
  const userInRankings = cutoffEventTop.getLatestRanking();
  for (let i = 0; i < userInRankings.length; i++) {
    const color = i % 2 == 0 ? 'white' : '#f1f1f1';
    const user = cutoffEventTop.getUserByUid(userInRankings[i].uid);
    const playerRankingImage = await drawPlayerRankingInList(
      user,
      color,
      mainServer,
    );
    if (playerRankingImage != undefined) {
      list.push(playerRankingImage);
    }
  }

  list.push(new Canvas(800, 50));

  //折线图
  list.push(await drawCutoffEventTopChart(cutoffEventTop, false));

  const listImage = drawDataBlock({ list });
  all.push(listImage);

  return await outputEasyImages(all, { compress });
}
