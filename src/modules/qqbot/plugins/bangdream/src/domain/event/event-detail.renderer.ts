import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import {
  drawList,
  drawListByServerList,
  drawListMerge,
} from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { drawDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { drawGachaDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.renderer';
import { Image, Canvas } from 'skia-canvas';
import { drawBannerImageCanvas } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { drawTimeInList } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-time.renderer';
import { drawAttributeInList } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/attribute-list.renderer';
import { drawCharacterInList } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character-list.renderer';
import { statConfig } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-stat.renderer';
import { drawCardListInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-icon.renderer';
import {
  getPresentGachaList,
  Gacha,
} from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { createOutputFinalImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { drawDegreeListOfEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/degree-list.renderer';
import {
  Song,
  getPresentSongList,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { isBirthdayGachaType } from '@/modules/qqbot/plugins/bangdream/src/domain/policy/gacha.policy';
import {
  drawSongInList,
  drawSongListInList,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-list.renderer';
import { drawDottedLine } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-dotted-line';
import { createHorizontalSeparatorSpec } from '@/modules/qqbot/plugins/bangdream/src/theme/layout';
import { DetailBlockBuilder } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.builder';

const songSeparatorLine = drawDottedLine(
  createHorizontalSeparatorSpec({ height: 10 }),
);

/**
 * 根据`songList`、`topLeftText`绘制或格式化歌曲数据Block。
 * @param songList - 决定歌曲数据Block内容、边界或目标的 `songList` 值。
 * @param topLeftText - 决定歌曲数据Block内容、边界或目标的 `topLeftText` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 歌曲数据Block。
 */
async function drawSongListDataBlock(songList: Song[], topLeftText?: string) {
  const list: Array<Image | Canvas> = [];
  for (const song of songList) {
    list.push(await drawSongInList(song));
    list.push(songSeparatorLine);
  }
  list.pop();
  return drawDataBlock({ list, topLeftText });
}

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
 * 通过 `builder.addSection` 追加渲染区块。
 * @param builder - 用于事件加成文本Sections的领域对象，包含 `addSection` 字段。
 * @param event - 触发事件加成文本Sections的领域事件，包含 `getAttributeList`、`getCharacterList` 字段。
 */
async function appendEventBonusSections(
  builder: DetailBlockBuilder,
  event: Event,
): Promise<void> {
  builder.addSection(drawList({ key: '活动加成' }));
  const attributeList = event.getAttributeList();
  for (const percent in attributeList) {
    if (!hasOwn(attributeList, percent)) {
      continue;
    }
    builder.addSection(
      await drawAttributeInList({
        content: attributeList[percent],
        text: ` +${percent}%`,
      }),
    );
  }

  builder.addSection(drawList({ key: '活动角色加成' }));
  const characterList = event.getCharacterList();
  for (const percent in characterList) {
    if (!hasOwn(characterList, percent)) {
      continue;
    }
    builder.addSection(
      await drawCharacterInList({
        content: characterList[percent],
        text: ` +${percent}%`,
      }),
    );
  }
}

/**
 * 按`event`读取事件统计值加成文本。
 * @param event - 触发事件统计值加成文本的领域事件，包含 `eventCharacterParameterBonus` 字段。
 * @returns 事件统计值加成文本。
 */
function getEventStatBonusText(event: Event): string {
  const statText: string[] = [];
  for (const key in event.eventCharacterParameterBonus) {
    if (key == 'eventId' || !hasOwn(event.eventCharacterParameterBonus, key)) {
      continue;
    }
    const element = event.eventCharacterParameterBonus[key];
    if (element == 0) {
      continue;
    }
    statText.push(`${statConfig[key].name} + ${element}%`);
  }
  return statText.join('  ');
}

/**
 * 根据`builder`、`event`更新事件统计值加成文本；当 `!statText` 成立时直接结束且不产生返回值。
 * @param builder - 用于事件统计值加成文本的领域对象，包含 `addSection` 字段。
 * @param event - 触发事件统计值加成文本的领域事件。
 */
function appendEventStatBonus(builder: DetailBlockBuilder, event: Event): void {
  const statText = getEventStatBonusText(event);
  if (!statText) {
    return;
  }
  builder.addSection(
    drawList({
      key: '活动偏科加成',
      text: statText,
    }),
  );
}

/**
 * 根据`builder`、`event`、`displayedServerList`更新事件奖励Sections；从 `event.getRewardDeco` 读取事件奖励Sections。
 * @param builder - 用于事件奖励Sections的领域对象，包含 `addSection` 字段。
 * @param event - 触发事件奖励Sections的领域事件，包含 `getRewardDeco`、`getRewardStamp`、`rewardCards` 字段。
 * @param displayedServerList - 用于事件奖励Sections的领域对象，包含 `0` 字段。
 */
async function appendEventRewardSections(
  builder: DetailBlockBuilder,
  event: Event,
  displayedServerList: Server[],
): Promise<void> {
  const decoImage = await event.getRewardDeco(displayedServerList[0]);
  if (decoImage) {
    builder.addSection(
      await drawList({
        key: '活动装饰',
        content: [decoImage],
        textSize: 64,
        lineHeight: 64,
      }),
    );
  }

  builder.addSection(await drawDegreeListOfEvent(event, displayedServerList));

  const stampImage = await event.getRewardStamp(displayedServerList[0]);
  if (stampImage) {
    builder.addSection(
      await drawList({
        key: '活动表情',
        content: [stampImage],
        textSize: 160,
        lineHeight: 160,
      }),
    );
  }

  const rewardCardList = event.rewardCards.map((cardId) => new Card(cardId));
  builder.addSection(
    await drawCardListInList({
      key: '奖励卡牌',
      cardList: rewardCardList,
      cardIdVisible: true,
      skillTypeVisible: true,
      cardTypeVisible: true,
      trainingStatus: false,
    }),
  );
}

/**
 * 按`event`、`displayedServerList`读取事件Music服务器；当 `event.musics[defaultServer]` 成立时返回 `defaultServer`。
 * @param event - 触发事件Music服务器的领域事件，包含 `musics` 字段。
 * @param displayedServerList - 用于事件Music服务器的领域对象，包含 `0` 字段。
 * @returns 事件Music服务器。
 */
function getEventMusicServer(event: Event, displayedServerList: Server[]) {
  const defaultServer = displayedServerList[0];
  if (event.musics[defaultServer]) {
    return defaultServer;
  }
  return Server.jp;
}

/**
 * 根据`builder`、`event`、`displayedServerList`更新事件Music内容分区；当 `!eventTypes.includes(event.eventType) || event.musics == unde…` 成立时直接结束且不产生返回值。
 * @param builder - 用于事件Music内容分区的领域对象，包含 `addSection` 字段。
 * @param event - 触发事件Music内容分区的领域事件，包含 `eventType`、`musics` 字段。
 * @param displayedServerList - 决定事件Music内容分区内容、边界或目标的 `displayedServerList` 值。
 */
async function appendEventMusicSection(
  builder: DetailBlockBuilder,
  event: Event,
  displayedServerList: Server[],
): Promise<void> {
  const eventTypes: string[] = ['versus', 'challenge', 'medley'];
  if (
    !eventTypes.includes(event.eventType) ||
    event.musics == undefined ||
    event.musics.length == 0
  ) {
    return;
  }

  const musicServer = getEventMusicServer(event, displayedServerList);
  const songs = event.musics[musicServer].map(
    (music) => new Song(music.musicId),
  );
  builder.addSection(await drawSongListInList(songs));
}

interface EventGachaSections {
  gachaCardList: Card[];
  gachaImageList: Canvas[];
}

/**
 * 根据`event`、`displayedServerList`处理事件卡池Sections；从 `getEventGachaAndCardList` 读取事件卡池Sections。
 * @param event - 触发事件卡池Sections的领域事件，包含 `startAt` 字段。
 * @param displayedServerList - 决定事件卡池Sections内容、边界或目标的 `displayedServerList` 值。
 * @returns 包含 `gachaCardList`、`gachaImageList` 字段的事件卡池Sections。
 */
async function collectEventGachaSections(
  event: Event,
  displayedServerList: Server[],
): Promise<EventGachaSections> {
  const gachaCardList: Card[] = [];
  const gachaCardIdSet = new Set<number>();
  const gachaImageList: Canvas[] = [];
  const gachaIdSet = new Set<number>();

  for (const server of displayedServerList) {
    if (event.startAt[server] == null) {
      continue;
    }
    const { gachaList, gachaCardList: serverGachaCardList } =
      await getEventGachaAndCardList(event, server);

    for (let i = 0; i < gachaList.length; i++) {
      const gacha = gachaList[i];
      if (gachaIdSet.has(gacha.gachaId)) {
        continue;
      }
      gachaImageList.push(
        await drawGachaDataBlock(
          gacha,
          (() => {
            if (i == 0) {
              return `${serverNameFullList[server]}相关卡池`;
            }
            return undefined;
          })(),
        ),
      );
      gachaIdSet.add(gacha.gachaId);
    }

    for (const card of serverGachaCardList) {
      if (gachaCardIdSet.has(card.cardId)) {
        continue;
      }
      gachaCardIdSet.add(card.cardId);
      gachaCardList.push(card);
    }
  }

  return { gachaCardList, gachaImageList };
}

/**
 * 将歌曲标识按列表原顺序连接为签名，用于避免重复渲染服务器间相同的歌曲集合。
 * @param songList - 要计算顺序敏感签名的歌曲列表。
 * @returns 以逗号分隔的歌曲标识签名；列表为空时返回空字符串。
 */
function getSongListSignature(songList: Song[]): string {
  return songList.map((song) => song.songId).join(',');
}

/**
 * 根据`all`、`event`、`displayedServerList`更新Related歌曲Sections；从 `getPresentSongList` 读取Related歌曲Sections。
 * @param all - 用于Related歌曲Sections的领域对象，包含 `push` 字段。
 * @param event - 触发Related歌曲Sections的领域事件，包含 `startAt`、`endAt` 字段。
 * @param displayedServerList - 决定Related歌曲Sections内容、边界或目标的 `displayedServerList` 值。
 */
async function appendRelatedSongSections(
  all: Array<Image | Canvas>,
  event: Event,
  displayedServerList: Server[],
): Promise<void> {
  const songSignatures = new Set<string>();

  for (const server of displayedServerList) {
    if (event.startAt[server] == null) {
      continue;
    }
    const songList = getPresentSongList(
      server,
      event.startAt[server],
      event.endAt[server] + 1000 * 60 * 60,
    );
    if (songList.length === 0) {
      continue;
    }

    const signature = getSongListSignature(songList);
    if (songSignatures.has(signature)) {
      continue;
    }
    songSignatures.add(signature);
    all.push(
      await drawSongListDataBlock(
        songList,
        `${serverNameFullList[server]}相关歌曲`,
      ),
    );
  }
}

/**
 * 根据`eventId`、`displayedServerList`、`useEasyBG`绘制或格式化事件详情；当 `!event.isExist` 成立时返回 `['错误: 活动不存在']`。
 * @param eventId - 用于精确定位事件的标识。
 * @param displayedServerList - 决定事件详情内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @param useEasyBG - 决定是否启用“useEasyBG”分支的布尔选项。
 * @param compress - 决定事件详情内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的事件详情列表；没有匹配项时为空数组。
 */
export async function drawEventDetail(
  eventId: number,
  displayedServerList: Server[] = globalDefaultServer,
  useEasyBG: boolean,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const event = new Event(eventId);
  if (!event.isExist) {
    return ['错误: 活动不存在'];
  }
  await event.initFull();
  const builder = new DetailBlockBuilder();

  //bannner
  const eventBannerImage = await event.getBannerImage();
  const eventBannerImageCanvas = drawBannerImageCanvas(eventBannerImage);
  builder.add(eventBannerImageCanvas).addSpacer(30);

  //标题
  builder.addSection(
    await drawListByServerList(
      event.eventName,
      '活动名称',
      displayedServerList,
    ),
  );

  //类型
  const typeImage = drawList({
    key: '类型',
    text: event.getTypeName(),
  });

  //活动ID
  const idImage = drawList({
    key: 'ID',
    text: event.eventId.toString(),
  });

  builder.addSection(drawListMerge([typeImage, idImage]));

  //开始时间
  builder.addSection(
    await drawTimeInList({
      key: '开始时间',
      content: event.startAt,
      eventId: event.eventId,
      estimateCNTime: true,
    }),
  );

  //结束时间
  builder.addSection(
    await drawTimeInList({
      key: '结束时间',
      content: event.endAt,
    }),
  );

  //活动属性加成
  await appendEventBonusSections(builder, event);

  //活动偏科加成(stat)
  appendEventStatBonus(builder, event);

  //有歌榜活动的歌榜歌曲
  await appendEventMusicSection(builder, event, displayedServerList);

  // 活动装饰、牌子、表情和奖励卡牌
  await appendEventRewardSections(builder, event, displayedServerList);

  const { gachaCardList, gachaImageList } = await collectEventGachaSections(
    event,
    displayedServerList,
  );

  builder.add(
    await drawCardListInList({
      key: '活动期间卡池卡牌',
      cardList: gachaCardList,
      cardIdVisible: true,
      skillTypeVisible: true,
      cardTypeVisible: true,
      trainingStatus: false,
    }),
  );

  const listImage = builder.toDataBlock();
  //创建最终输出数组

  const all = [];
  all.push(drawTitle('查询', '活动'));

  all.push(listImage);

  //歌曲
  await appendRelatedSongSections(all, event, displayedServerList);

  //卡池
  for (let i = 0; i < gachaImageList.length; i++) {
    all.push(gachaImageList[i]);
  }

  const BGimage = await (async () => {
    if (useEasyBG) {
      return undefined;
    }
    return await event.getEventBGImage(displayedServerList);
  })();

  return await createOutputFinalImages({
    useEasyBG,
    useImageBG: true,
    BGimage,
    text: 'Event',
    compress,
  })(all);
}

/**
 * 按`event`、`mainServer`、`useCache`读取事件卡池卡牌；当 `event.startAt[mainServer] == null` 成立时返回 `{ gachaCardList: [], gachaList: [] }`。
 * @param event - 触发事件卡池卡牌的领域事件，包含 `startAt`、`endAt` 字段。
 * @param mainServer - 决定事件卡池卡牌内容、边界或目标的 `mainServer` 值。
 * @param useCache - 决定是否启用“use缓存”分支的布尔选项；省略时默认采用 `false`。
 * @returns 包含 `gachaCardList`、`gachaList` 字段的事件卡池卡牌。
 */
export async function getEventGachaAndCardList(
  event: Event,
  mainServer: Server,
  useCache = false,
) {
  const gachaList: Gacha[] = [];
  const gachaIdList = []; //用于去重
  if (event.startAt[mainServer] == null) {
    return { gachaCardList: [], gachaList: [] };
  }
  const tempGachaList = await getPresentGachaList(
    mainServer,
    event.startAt[mainServer],
    event.endAt[mainServer],
  );
  for (let j = 0; j < tempGachaList.length; j++) {
    if (gachaIdList.indexOf(tempGachaList[j].gachaId) == -1) {
      gachaList.push(tempGachaList[j]);
      gachaIdList.push(tempGachaList[j].gachaId);
    }
  }
  const gachaCardIdList: number[] = [];
  for (let i = 0; i < gachaList.length; i++) {
    const tempGacha = gachaList[i];
    if (isBirthdayGachaType(tempGacha.type)) {
      continue;
    }
    await tempGacha.initFull(!useCache);
    const tempCardList = tempGacha.pickUpCardId;
    /*
        //检查是否有超过7张稀有度2的卡牌，发布了太多2星卡的卡池会被跳过
        let rarity2CardNum = 0
        for (let j = 0; j < tempCardList.length; j++) {
            let tempCard = new Card(tempCardList[j])
            if (tempCard.rarity == 2) {
                rarity2CardNum++
            }
        }
        if (rarity2CardNum > 6) {
            continue
        }
        */
    for (let j = 0; j < tempCardList.length; j++) {
      const tempCardId = tempCardList[j];
      if (gachaCardIdList.indexOf(tempCardId) == -1) {
        gachaCardIdList.push(tempCardId);
      }
    }
  }
  const gachaCardList: Card[] = [];
  for (let i = 0; i < gachaCardIdList.length; i++) {
    const tempCardId = gachaCardIdList[i];
    const tempCard = new Card(tempCardId);
    //如果卡牌的发布时间不在活动期间内，则不显示
    if (
      tempCard.releasedAt[mainServer] <
        event.startAt[mainServer] - 1000 * 60 * 60 * 24 ||
      tempCard.releasedAt[mainServer] > event.endAt[mainServer]
    ) {
      continue;
    }
    gachaCardList.push(tempCard);
  }

  gachaCardList.sort((a, b) => {
    return a.rarity - b.rarity;
  });
  gachaList.sort((a, b) => {
    if (a.publishedAt[mainServer] != b.publishedAt[mainServer]) {
      return a.publishedAt[mainServer] - b.publishedAt[mainServer];
    } else {
      return a.gachaId - b.gachaId;
    }
  });
  return { gachaCardList, gachaList };
}
