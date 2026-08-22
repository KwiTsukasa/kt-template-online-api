import { Card } from '@/modules/plugins/bangdream/src/domain/card/card.model';
import { Skill } from '@/modules/plugins/bangdream/src/domain/catalog/skill.model';
import {
  drawList,
  drawListByServerList,
  drawListMerge,
} from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { drawCardIllustration } from '@/modules/plugins/bangdream/src/domain/card/card-art.renderer';
import { drawSkillInList } from '@/modules/plugins/bangdream/src/domain/card/card-skill-list.renderer';
import { drawTimeInList } from '@/modules/plugins/bangdream/src/domain/event/event-time.renderer';
import { drawCardPrefixInList } from '@/modules/plugins/bangdream/src/domain/card/card-prefix.renderer';
import { drawCardStatInList } from '@/modules/plugins/bangdream/src/domain/card/card-stat.renderer';
import { drawCardListInList } from '@/modules/plugins/bangdream/src/domain/card/card-icon.renderer';
import { drawSdCharacterInList } from '@/modules/plugins/bangdream/src/domain/card/card-sd-character.renderer';
import { drawEventDataBlock } from '@/modules/plugins/bangdream/src/theme/detail-block.renderer';
import { drawGachaDataBlock } from '@/modules/plugins/bangdream/src/theme/detail-block.renderer';
import { Image, Canvas } from 'skia-canvas';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { createOutputFinalImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { Event } from '@/modules/plugins/bangdream/src/domain/event/event.model';
import { Gacha } from '@/modules/plugins/bangdream/src/domain/gacha/gacha.model';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/modules/plugins/bangdream/src/config/runtime-config';
import { DetailBlockBuilder } from '@/modules/plugins/bangdream/src/theme/detail-block.builder';

/**
 * 根据`source`、`key`与当前约束判定Own。
 * @param source - 决定Own内容、边界或目标的 `source` 值。
 * @param key - 用于读取或更新Own的稳定键。
 * @returns 满足Own约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function hasOwn(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * 根据`builder`、`card`更新卡牌Illustrations；从 `card.getTrainingStatusList` 读取卡牌Illustrations。
 * @param builder - 用于卡牌Illustrations的领域对象，包含 `add`、`addSpacer` 字段。
 * @param card - 用于卡牌Illustrations的领域对象，包含 `getTrainingStatusList` 字段。
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
 * 通过 `hasOwn` 判断输入是否满足函数约束。
 * @param card - 用于Show卡池文本的领域对象，包含 `rarity`、`type`、`releasedAt` 字段。
 * @param source - 为兼容既有调用签名保留；当前实现不会读取该参数。
 * @param displayedServerList - 决定Show卡池文本内容、边界或目标的 `displayedServerList` 值。
 * @returns 满足Show卡池文本约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 通过 `builder.addSection` 追加渲染区块。
 * @param builder - 用于卡牌BaseSections的领域对象，包含 `addSection` 字段。
 * @param card - 用于卡牌BaseSections的领域对象，包含 `getTypeName`、`cardId`、`skillId`、`prefix` 字段。
 * @param source - 为兼容既有调用签名保留；当前实现不会读取该参数。
 * @param displayedServerList - 决定卡牌BaseSections内容、边界或目标的 `displayedServerList` 值。
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
 * 根据`gachaIdList`、`server`处理sort卡池标识集合服务器。
 * @param gachaIdList - 决定sort卡池标识集合服务器内容、边界或目标的 `gachaIdList` 值。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 按输入顺序得到的sort卡池标识集合服务器列表；没有匹配项时为空数组。
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
 * 根据`eventImageList`、`eventIdSet`、`eventId`更新Related事件图片；当 `eventIdSet.has(event.eventId)` 成立时直接结束且不产生返回值。
 * @param eventImageList - 用于Related事件图片的领域对象，包含 `push` 字段。
 * @param eventIdSet - 用于Related事件图片的领域对象，包含 `has`、`add` 字段。
 * @param eventId - 用于精确定位事件的标识。
 * @param displayedServerList - 决定Related事件图片内容、边界或目标的 `displayedServerList` 值。
 * @param title - 决定Related事件图片内容、边界或目标的 `title` 值。
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
 * 按展示服务器收集卡牌首个关联活动与卡池图片，并跨服务器去除重复活动和卡池。
 * @param card - 提供各服务器发布活动与卡池标识的卡牌。
 * @param displayedServerList - 决定来源检索顺序和图片标题前缀的服务器列表。
 * @returns 已去重的关联活动图片与卡池图片集合；没有来源时对应集合为空。
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
 * 通过 `addSpacer` 追加渲染区块。
 * @param cardId - 用于精确定位卡牌的标识。
 * @param displayedServerList - 决定卡牌详情内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @param useEasyBG - 决定是否启用“useEasyBG”分支的布尔选项。
 * @param compress - 决定卡牌详情内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的卡牌详情列表；没有匹配项时为空数组。
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

  const BGimage = await (async () => {
      if (card.rarity < 3) {
        return undefined;
      }
      return await card.getCardIllustrationImage(true);
    })();

  return await createOutputFinalImages({
    useEasyBG,
    BGimage,
    text: 'Card',
    compress,
  })(all);
}

export { drawCardDetail };
