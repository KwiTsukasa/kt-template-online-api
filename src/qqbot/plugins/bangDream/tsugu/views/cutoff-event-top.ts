import { Image, Canvas } from 'skia-canvas';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { serverNameFullList } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { CutoffEventTop } from '@/qqbot/plugins/bangDream/tsugu/domain/cutoff-event-top';
import { Event } from '@/qqbot/plugins/bangDream/tsugu/domain/event';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawEventDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { drawPlayerRankingInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/player-ranking';
import { drawCutoffEventTopChart } from '@/qqbot/plugins/bangDream/tsugu/layout/cutoff-chart';

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
