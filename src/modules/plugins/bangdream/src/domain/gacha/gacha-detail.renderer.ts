import { getPresentEvent } from '@/modules/plugins/bangdream/src/domain/event/event.model';
import {
  drawList,
  line,
  drawListByServerList,
  drawListMerge,
} from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { drawDataBlock } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { Image, Canvas } from 'skia-canvas';
import { drawBannerImageCanvas } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { drawTimeInList } from '@/modules/plugins/bangdream/src/domain/event/event-time.renderer';
import {
  Server,
  getServerByPriority,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { createOutputFinalImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { drawEventDataBlock } from '@/modules/plugins/bangdream/src/theme/detail-block.renderer';
import { drawGashaPaymentMethodInList } from '@/modules/plugins/bangdream/src/domain/gacha/gacha-payment-method.renderer';
import { drawGachaRateInList } from '@/modules/plugins/bangdream/src/domain/gacha/gacha-rate.renderer';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/modules/plugins/bangdream/src/config/runtime-config';
import { drawGachaPickupInList } from '@/modules/plugins/bangdream/src/domain/gacha/gacha-pick-up.renderer';
import { gachaRepository } from '@/modules/plugins/bangdream/src/domain/gacha/gacha.repository';

/**
 * 根据`gachaId`、`displayedServerList`、`useEasyBG`绘制或格式化卡池详情；当 `!gacha.isExist` 成立时返回 `['错误: 卡池不存在']`。
 * @param gachaId - 用于精确定位卡池的标识。
 * @param displayedServerList - 用于卡池详情的领域对象，包含 `length`、`k` 字段；省略时默认采用 `globalDefaultServer`。
 * @param useEasyBG - 决定是否启用“useEasyBG”分支的布尔选项。
 * @param compress - 决定卡池详情内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的卡池详情列表；没有匹配项时为空数组。
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
