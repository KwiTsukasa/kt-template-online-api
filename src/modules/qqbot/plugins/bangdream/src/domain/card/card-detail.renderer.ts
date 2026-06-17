import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { Skill } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/skill.model';
import {
  drawList,
  drawListByServerList,
  drawListMerge,
} from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { drawCardIllustration } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.renderer';
import { drawSkillInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-skill-list.renderer';
import { drawTimeInList } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-time.renderer';
import { drawCardPrefixInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-prefix.renderer';
import { drawCardStatInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-stat.renderer';
import { drawCardListInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-icon.renderer';
import { drawSdCharacterInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-sd-character.renderer';
import { drawEventDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.renderer';
import { drawGachaDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.renderer';
import { Image, Canvas } from 'skia-canvas';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { createOutputFinalImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { Gacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { DetailBlockBuilder } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.builder';

/**
 * 在QQBot 图片视图层中判断对象是否包含指定自有属性。
 *
 * @param source - source 输入；驱动 `hasOwnProperty.call()` 的 BangDream步骤。
 * @param key - 键名；驱动 `hasOwnProperty.call()` 的 BangDream步骤。
 * @returns 判断结果。
 */
function hasOwn(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * 在QQBot 图片视图层中追加卡牌Illustrations。
 *
 * @param builder - builder 输入；写入 BangDream集合、缓存或持久化状态。
 * @param card - card 输入；执行 `card.getTrainingStatusList()` 对应的 BangDream步骤。
 */
async function appendCardIllustrations(
  builder: DetailBlockBuilder,
  card: Card,
): Promise<void> {
  for (const trainingStatus of card.getTrainingStatusList()) {
    builder.add(
      await drawCardIllustration({
        card,
        trainingStatus,
        isList: true,
      }),
    );
    builder.addSpacer(30);
  }
}

/**
 * 在QQBot 图片视图层中判断是否需要Show卡池文本。
 *
 * @param card - card 输入；使用 `rarity`、`type`、`releasedAt` 字段生成结果。
 * @param source - source 输入；决定 BangDream条件分支。
 * @param displayedServerList - displayedServerList 输入；驱动 `for()` 的 BangDream步骤。
 * @returns 判断结果。
 */
function shouldShowGachaText(
  card: Card,
  source,
  displayedServerList: Server[],
): boolean {
  if (card.rarity <= 2 || card.type == 'kirafes') {
    return false;
  }
  for (const server of displayedServerList) {
    if (card.releasedAt[server] == null) {
      continue;
    }
    if (hasOwn(source[server], 'gacha')) {
      return true;
    }
  }
  return false;
}

/**
 * 在QQBot 图片视图层中追加卡牌基础区块列表。
 *
 * @param builder - builder 输入；执行 `builder.addSection()` 对应的 BangDream步骤。
 * @param card - card 输入；使用 `cardId`、`skillId`、`prefix`、`gachaText` 字段生成结果。
 * @param source - source 输入；决定 BangDream条件分支。
 * @param displayedServerList - displayedServerList 输入；驱动 `builder.addSection()` 的 BangDream步骤。
 */
async function appendCardBaseSections(
  builder: DetailBlockBuilder,
  card: Card,
  source,
  displayedServerList: Server[],
): Promise<void> {
  //类型 / 卡牌ID
  builder.addSection(
    drawListMerge([
      drawList({ key: '类型', text: card.getTypeName() }),
      drawList({ key: 'ID', text: card.cardId.toString() }),
    ]),
  );

  //综合力
  builder.addSection(await drawCardStatInList(card));

  //技能
  const skill = new Skill(card.skillId);
  builder.addSection(
    await drawSkillInList(
      { key: '技能', card: card, content: skill },
      displayedServerList,
    ),
  );

  //标题
  builder.addSection(
    await drawListByServerList(card.prefix, '标题', displayedServerList),
  );

  //招募语
  if (shouldShowGachaText(card, source, displayedServerList)) {
    builder.addSection(
      await drawListByServerList(card.gachaText, '招募语', displayedServerList),
    );
  }

  //发售日期
  builder.addSection(
    await drawTimeInList(
      {
        key: '发布日期',
        content: card.releasedAt,
      },
      displayedServerList,
    ),
  );

  //缩略图
  builder.addSection(
    await drawCardListInList({
      key: '缩略图',
      cardList: [card],
      cardIdVisible: false,
      skillTypeVisible: false,
      cardTypeVisible: false,
    }),
  );
}

/**
 * 在QQBot 图片视图层中排序卡池ID 列表For服务器。
 *
 * @param gachaIdList - 卡池 ID 列表；限定本次批量读取、渲染或关联的卡池范围。
 * @param server - server 输入；决定 BangDream条件分支。
 * @returns 计算后的数值。
 */
function sortGachaIdsForServer(
  gachaIdList: number[],
  server: Server,
): number[] {
  return [...gachaIdList].sort((a, b) => {
    const gachaA = new Gacha(a);
    const gachaB = new Gacha(b);
    if (
      server != Server.jp &&
      gachaA.publishedAt[server] != gachaB.publishedAt[server]
    ) {
      return gachaA.publishedAt[server] - gachaB.publishedAt[server];
    }
    return gachaA.gachaId - gachaB.gachaId;
  });
}

/**
 * 在QQBot 图片视图层中追加Related活动图片。
 *
 * @param eventImageList - eventImageList 输入；写入 BangDream集合、缓存或持久化状态。
 * @param eventIdSet - eventIdSet 输入；写入 BangDream集合、缓存或持久化状态。
 * @param eventId - 活动 ID；定位本次读取、更新、删除或关联的活动。
 * @param displayedServerList - displayedServerList 输入；驱动 `eventImageList.push()` 的 BangDream步骤。
 * @param title - title 输入；驱动 `eventImageList.push()` 的 BangDream步骤。
 */
async function appendRelatedEventImage(
  eventImageList: Array<Canvas | Image>,
  eventIdSet: Set<number>,
  eventId: number,
  displayedServerList: Server[],
  title: string,
): Promise<void> {
  const event = new Event(eventId);
  if (eventIdSet.has(event.eventId)) {
    return;
  }
  eventImageList.push(
    await drawEventDataBlock(event, displayedServerList, title),
  );
  eventIdSet.add(event.eventId);
}

interface CardSourceSections {
  eventImageList: Array<Canvas | Image>;
  gachaImageList: Array<Canvas | Image>;
}

/**
 * 在QQBot 图片视图层中收集卡牌来源区块列表。
 *
 * @param card - card 输入；使用 `releaseEvent`、`releaseGacha` 字段生成结果。
 * @param displayedServerList - displayedServerList 输入；驱动 `for()`、`appendRelatedEventImage()` 的 BangDream步骤。
 * @returns 异步处理结果。
 */
async function collectCardSourceSections(
  card: Card,
  displayedServerList: Server[],
): Promise<CardSourceSections> {
  const eventIdSet = new Set<number>();
  const gachaIdSet = new Set<number>();
  const eventImageList: Array<Canvas | Image> = [];
  const gachaImageList: Array<Canvas | Image> = [];

  for (const server of displayedServerList) {
    const titlePrefix = serverNameFullList[server];
    const releaseEventList = card.releaseEvent[server];
    if (releaseEventList.length != 0) {
      await appendRelatedEventImage(
        eventImageList,
        eventIdSet,
        releaseEventList[0],
        displayedServerList,
        `${titlePrefix}相关活动`,
      );
    }

    const releaseGachaList = card.releaseGacha[server];
    if (releaseGachaList.length == 0) {
      continue;
    }

    const gacha = new Gacha(sortGachaIdsForServer(releaseGachaList, server)[0]);
    const eventId = gacha.getEventId()[server];
    if (eventId != null) {
      await appendRelatedEventImage(
        eventImageList,
        eventIdSet,
        eventId,
        displayedServerList,
        `${titlePrefix}相关活动`,
      );
    }
    if (gachaIdSet.has(gacha.gachaId)) {
      continue;
    }
    gachaImageList.push(
      await drawGachaDataBlock(gacha, `${titlePrefix}相关卡池`),
    );
    gachaIdSet.add(gacha.gachaId);
  }

  return { eventImageList, gachaImageList };
}

/**
 * 在QQBot 图片视图层中绘制卡牌详情。
 *
 * @param cardId - 卡牌 ID；定位本次读取、更新、删除或关联的卡牌。
 * @param displayedServerList - displayedServerList 输入；驱动 `add()`、`list.push()`、`collectCardSourceSections()` 的 BangDream步骤。
 * @param useEasyBG - useEasyBG 输入；影响 drawCardDetail 的返回值。
 * @param compress - BangDream列表；影响 drawCardDetail 的返回值。
 * @returns 异步处理结果。
 */
async function drawCardDetail(
  cardId: number,
  displayedServerList: Server[] = globalDefaultServer,
  useEasyBG: boolean,
  compress: boolean,
): Promise<Array<string | Buffer>> {
  const card = new Card(cardId);
  if (!card.isExist) {
    return ['错误: 卡牌不存在'];
  }
  await card.initFull();
  const source = card.source;

  const builder = new DetailBlockBuilder();

  //标题
  builder
    .add(await drawCardPrefixInList(card, displayedServerList))
    .addSpacer(30);

  //插画
  await appendCardIllustrations(builder, card);

  /*
    //乐队
    list.push(await drawBandInList({ key: '乐队', content: [new Band(card.bandId)] }))
    list.push(line)

    //角色
    let character = new Character(card.characterId)
    list.push(await drawCharacterInList({ content: [character] }))
    list.push(line)

    //属性
    let attribute = new Attribute(card.attribute)
    list.push(await drawAttributeInList({ content: [attribute] }))
    list.push(line)

    //稀有度
    list.push(await drawRarityInList({ rarity: card.rarity }))
    list.push(line)
    */
  await appendCardBaseSections(builder, card, source, displayedServerList);

  //演出缩略图
  builder.add(await drawSdCharacterInList(card));

  //创建最终输出数组
  const listImage = builder.toDataBlock();
  const all = [];
  all.push(drawTitle('查询', '卡牌'));
  all.push(listImage);
  //相关来源
  const { eventImageList, gachaImageList } = await collectCardSourceSections(
    card,
    displayedServerList,
  );
  all.push(...eventImageList, ...gachaImageList);

  const BGimage =
    card.rarity < 3 ? undefined : await card.getCardIllustrationImage(true);

  return await createOutputFinalImages({
    useEasyBG,
    BGimage,
    text: 'Card',
    compress,
  })(all);
}

export { drawCardDetail };
