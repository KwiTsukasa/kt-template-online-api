import { Event } from '@/qqbot/plugins/bangDream/tsugu/models/event';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/models/card';
import {
  drawList,
  drawListByServerList,
  drawListMerge,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-frame';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/data-block';
import { drawGachaDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/detail-blocks';
import { Image, Canvas } from 'skia-canvas';
import { drawBannerImageCanvas } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/data-block';
import { drawTimeInList } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-time';
import { drawAttributeInList } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-attribute';
import { drawCharacterInList } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-character';
import { statConfig } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-stat';
import { drawCardListInList } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-card-icon-list';
import {
  getPresentGachaList,
  Gacha,
} from '@/qqbot/plugins/bangDream/tsugu/models/gacha';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/title';
import { createOutputFinalImages } from '@/qqbot/plugins/bangDream/tsugu/canvas/output';
import { drawDegreeListOfEvent } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-degree-list';
import {
  Song,
  getPresentSongList,
} from '@/qqbot/plugins/bangDream/tsugu/models/song';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import {
  drawSongInList,
  drawSongListInList,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-song';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/tsugu/canvas/dotted-line';
import { createHorizontalSeparatorSpec } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/layout-spec';
import { DetailBlockBuilder } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/detail-block-builder';

const songSeparatorLine = drawDottedLine(
  createHorizontalSeparatorSpec({ height: 10 }),
);

/**
 * 在QQBot 图片视图层中绘制歌曲列表数据块。
 *
 * @param songList - 歌曲列表参数。
 * @param topLeftText - 排名Left文本参数，未传入时使用默认值。
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
 * 在QQBot 图片视图层中判断对象是否包含指定自有属性。
 *
 * @param source - 输入来源对象或数据集合。
 * @param key - 当前字段键名。
 * @returns 判断结果。
 */
function hasOwn(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * 在QQBot 图片视图层中追加活动加成区块列表。
 *
 * @param builder - 详情区块构建器。
 * @param event - 活动参数。
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
 * 在QQBot 图片视图层中获取活动数值加成文本。
 *
 * @param event - 活动参数。
 * @returns 格式化后的文本。
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
 * 在QQBot 图片视图层中追加活动数值加成。
 *
 * @param builder - 详情区块构建器。
 * @param event - 活动参数。
 */
function appendEventStatBonus(
  builder: DetailBlockBuilder,
  event: Event,
): void {
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
 * 在QQBot 图片视图层中追加活动奖励区块列表。
 *
 * @param builder - 详情区块构建器。
 * @param event - 活动参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
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
 * 在QQBot 图片视图层中获取活动音乐服务器。
 *
 * @param event - 活动参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
 */
function getEventMusicServer(event: Event, displayedServerList: Server[]) {
  const defaultServer = displayedServerList[0];
  return event.musics[defaultServer] ? defaultServer : Server.jp;
}

/**
 * 在QQBot 图片视图层中追加活动音乐区块。
 *
 * @param builder - 详情区块构建器。
 * @param event - 活动参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
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
 * 在QQBot 图片视图层中收集活动卡池区块列表。
 *
 * @param event - 活动参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
 * @returns 异步处理结果。
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
          i == 0 ? `${serverNameFullList[server]}相关卡池` : undefined,
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
 * 在QQBot 图片视图层中获取歌曲列表Signature。
 *
 * @param songList - 歌曲列表参数。
 * @returns 格式化后的文本。
 */
function getSongListSignature(songList: Song[]): string {
  return songList.map((song) => song.songId).join(',');
}

/**
 * 在QQBot 图片视图层中追加Related歌曲区块列表。
 *
 * @param all - 全部参数。
 * @param event - 活动参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
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
 * 在QQBot 图片视图层中绘制活动详情。
 *
 * @param eventId - 活动 ID。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param useEasyBG - use简易背景参数。
 * @param compress - compress参数。
 * @returns 异步处理结果。
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

  const BGimage = useEasyBG ? undefined : await event.getEventBGImage();

  return await createOutputFinalImages({
    useEasyBG,
    useImageBG: true,
    BGimage,
    text: 'Event',
    compress,
  })(all);
}

/**
 * 在QQBot 图片视图层中获取活动卡池And卡牌列表。
 *
 * @param event - 活动参数。
 * @param mainServer - 主数据服务器参数。
 * @param useCache - use缓存参数，未传入时使用默认值。
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
    if (tempGacha.type == 'birthday') {
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
