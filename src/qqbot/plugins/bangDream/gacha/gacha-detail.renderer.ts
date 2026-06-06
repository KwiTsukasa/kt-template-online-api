import { getPresentEvent } from '@/qqbot/plugins/bangDream/event/event.model';
import {
  drawList,
  line,
  drawListByServerList,
  drawListMerge,
} from '@/qqbot/plugins/bangDream/shared/list-frame.renderer';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/shared/data-block.renderer';
import { Image, Canvas } from 'skia-canvas';
import { drawBannerImageCanvas } from '@/qqbot/plugins/bangDream/shared/data-block.renderer';
import { drawTimeInList } from '@/qqbot/plugins/bangDream/event/event-time.renderer';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/catalog/server.model';
import { drawTitle } from '@/qqbot/plugins/bangDream/shared/title.renderer';
import { createOutputFinalImages } from '@/qqbot/plugins/bangDream/theme/canvas-output';
import { drawEventDataBlock } from '@/qqbot/plugins/bangDream/shared/detail-block.renderer';
import { drawGashaPaymentMethodInList } from '@/qqbot/plugins/bangDream/gacha/gacha-payment-method.renderer';
import { drawGachaRateInList } from '@/qqbot/plugins/bangDream/gacha/gacha-rate.renderer';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/config/runtime-config';
import { drawGachaPickupInList } from '@/qqbot/plugins/bangDream/gacha/gacha-pick-up.renderer';
import { gachaRepository } from '@/qqbot/plugins/bangDream/gacha/gacha.repository';

/**
 * 在QQBot 图片视图层中绘制卡池详情。
 *
 * @param gachaId - 卡池 ID。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param useEasyBG - use简易背景参数。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawGachaDetail(
  gachaId: number,
  displayedServerList: Server[] = globalDefaultServer,
  useEasyBG: boolean,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const gacha = gachaRepository.create(gachaId);
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
