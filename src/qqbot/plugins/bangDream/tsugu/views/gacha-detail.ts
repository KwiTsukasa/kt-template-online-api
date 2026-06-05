import { getPresentEvent } from '@/qqbot/plugins/bangDream/tsugu/domain/event';
import {
  drawList,
  line,
  drawListByServerList,
  drawListMerge,
} from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { Image, Canvas } from 'skia-canvas';
import { drawBannerImageCanvas } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { drawTimeInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/time';
import { Gacha } from '@/qqbot/plugins/bangDream/tsugu/domain/gacha';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { createOutputFinalImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { drawEventDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import { drawGashaPaymentMethodInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/gacha-payment-method';
import { drawGachaRateInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/gacha-rate';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { drawGachaPickupInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/gacha-pick-up';

export async function drawGachaDetail(
  gachaId: number,
  displayedServerList: Server[] = globalDefaultServer,
  useEasyBG: boolean,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const gacha = new Gacha(gachaId);
  if (!gacha.isExist) {
    return ['错误: 卡池不存在'];
  }
  await gacha.initFull();
  const list: Array<Image | Canvas> = [];
  //bannner
  const gachaBannerImage = await gacha.getBannerImage();
  const gachaBannerImageCanvas = drawBannerImageCanvas(gachaBannerImage);
  list.push(gachaBannerImageCanvas);
  list.push(new Canvas(800, 30));

  //标题
  list.push(
    await drawListByServerList(
      gacha.gachaName,
      '卡池名称',
      displayedServerList,
    ),
  );
  list.push(line);

  //类型
  const typeImage = drawList({
    key: '类型',
    text: gacha.getTypeName(),
  });

  //卡池ID
  const idImage = drawList({
    key: 'ID',
    text: gacha.gachaId.toString(),
  });

  list.push(drawListMerge([typeImage, idImage]));
  list.push(line);

  //开始时间
  list.push(
    await drawTimeInList({
      key: '开始时间',
      content: gacha.publishedAt,
    }),
  );
  list.push(line);

  //结束时间
  list.push(
    await drawTimeInList({
      key: '结束时间',
      content: gacha.closedAt,
    }),
  );
  list.push(line);

  //描述
  list.push(
    await drawListByServerList(gacha.description, '描述', displayedServerList),
  );
  list.push(line);

  const server = getServerByPriority(gacha.publishedAt, displayedServerList);

  //支付方法
  list.push(await drawGashaPaymentMethodInList(gacha));
  list.push(line);

  //概率分布
  list.push(await drawGachaRateInList(gacha, server));
  list.push(line);

  //卡池pickUp
  try {
    list.push(await drawGachaPickupInList(gacha, server));
  } catch {}

  const listImage = drawDataBlock({ list });
  const all = [];
  all.push(drawTitle('查询', '卡池'));
  all.push(listImage);

  //相关活动
  const tempEventIdList = []; //用于防止重复
  const eventImageList: Array<Canvas | Image> = [];

  for (let k = 0; k < displayedServerList.length; k++) {
    const server = displayedServerList[k];
    if (gacha.publishedAt[server] == null) {
      continue;
    }
    const relatedEvent = getPresentEvent(server, gacha.publishedAt[server]);
    if (
      relatedEvent != null &&
      !tempEventIdList.includes(relatedEvent.eventId)
    ) {
      tempEventIdList.push(relatedEvent.eventId);
      eventImageList.push(
        await drawEventDataBlock(
          relatedEvent,
          displayedServerList,
          `${serverNameFullList[server]}相关活动`,
        ),
      );
    }
  }

  for (let i = 0; i < eventImageList.length; i++) {
    all.push(eventImageList[i]);
  }
  const gachaBGImage = await gacha.getGachaBGImage();
  return await createOutputFinalImages({
    useEasyBG,
    BGimage: gachaBGImage,
    text: 'Gacha',
    compress,
  })(all);
}
