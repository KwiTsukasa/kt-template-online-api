import { Event } from '@/qqbot/plugins/bangDream/tsugu/domain/event';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import {
  drawList,
  line,
  drawListByServerList,
  drawListMerge,
} from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { drawGachaDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import { Image, Canvas } from 'skia-canvas';
import { drawBannerImageCanvas } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { drawTimeInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/time';
import { drawAttributeInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/attribute';
import { drawCharacterInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/character';
import { statConfig } from '@/qqbot/plugins/bangDream/tsugu/layout/list/stat';
import { drawCardListInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/card-icon-list';
import {
  getPresentGachaList,
  Gacha,
} from '@/qqbot/plugins/bangDream/tsugu/domain/gacha';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { createOutputFinalImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { drawDegreeListOfEvent } from '@/qqbot/plugins/bangDream/tsugu/layout/list/degree-list';
import {
  Song,
  getPresentSongList,
} from '@/qqbot/plugins/bangDream/tsugu/domain/song';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import {
  drawSongInList,
  drawSongListInList,
} from '@/qqbot/plugins/bangDream/tsugu/layout/list/song';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/tsugu/graphics/dotted-line';

const songSeparatorLine = drawDottedLine({
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

async function drawSongListDataBlock(songList: Song[], topLeftText?: string) {
  const list: Array<Image | Canvas> = [];
  for (const song of songList) {
    list.push(await drawSongInList(song));
    list.push(songSeparatorLine);
  }
  list.pop();
  return drawDataBlock({ list, topLeftText });
}

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
  const list: Array<Image | Canvas> = [];

  //bannner
  const eventBannerImage = await event.getBannerImage();
  const eventBannerImageCanvas = drawBannerImageCanvas(eventBannerImage);
  list.push(eventBannerImageCanvas);
  list.push(new Canvas(800, 30));

  //标题
  list.push(
    await drawListByServerList(
      event.eventName,
      '活动名称',
      displayedServerList,
    ),
  );
  list.push(line);

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

  list.push(drawListMerge([typeImage, idImage]));
  list.push(line);

  //开始时间
  list.push(
    await drawTimeInList({
      key: '开始时间',
      content: event.startAt,
      eventId: event.eventId,
      estimateCNTime: true,
    }),
  );
  list.push(line);

  //结束时间
  list.push(
    await drawTimeInList({
      key: '结束时间',
      content: event.endAt,
    }),
  );
  list.push(line);

  //活动属性加成
  list.push(
    drawList({
      key: '活动加成',
    }),
  );
  const attributeList = event.getAttributeList();
  for (const i in attributeList) {
    if (Object.prototype.hasOwnProperty.call(attributeList, i)) {
      const element = attributeList[i];
      list.push(
        await drawAttributeInList({
          content: element,
          text: ` +${i}%`,
        }),
      );
    }
  }
  list.push(line);

  //活动角色加成
  list.push(
    drawList({
      key: '活动角色加成',
    }),
  );
  const characterList = event.getCharacterList();
  for (const i in characterList) {
    if (Object.prototype.hasOwnProperty.call(characterList, i)) {
      const element = characterList[i];
      list.push(
        await drawCharacterInList({
          content: element,
          text: ` +${i}%`,
        }),
      );
    }
  }
  list.push(line);

  //活动偏科加成(stat)
  if (Object.keys(event.eventCharacterParameterBonus).length != 0) {
    let statText = '';
    for (const i in event.eventCharacterParameterBonus) {
      if (i == 'eventId') {
        continue;
      }
      if (
        Object.prototype.hasOwnProperty.call(
          event.eventCharacterParameterBonus,
          i,
        )
      ) {
        const element = event.eventCharacterParameterBonus[i];
        if (element == 0) {
          continue;
        }
        statText += `${statConfig[i].name} + ${element}%  `;
      }
    }
    list.push(
      drawList({
        key: '活动偏科加成',
        text: statText,
      }),
    );
    list.push(line);
  }
  // 活动装饰
  const decoImage = await event.getRewardDeco(displayedServerList[0]);
  if (decoImage) {
    list.push(
      await drawList({
        key: '活动装饰',
        content: [decoImage],
        textSize: 64,
        lineHeight: 64,
      }),
    );
    list.push(line);
  }

  //牌子
  list.push(await drawDegreeListOfEvent(event, displayedServerList));
  list.push(line);

  //有歌榜活动的歌榜歌曲
  const eventTypes: string[] = ['versus', 'challenge', 'medley'];
  if (
    eventTypes.includes(event.eventType) &&
    event.musics != undefined &&
    event.musics.length > 0
  ) {
    const songs: Song[] = [];
    let defaultServer = displayedServerList[0];
    if (!event.musics[displayedServerList[0]]) {
      defaultServer = Server.jp;
    }
    for (let i = 0; i < event.musics[defaultServer].length; i++) {
      songs.push(new Song(event.musics[defaultServer][i].musicId));
    }
    list.push(await drawSongListInList(songs));
    list.push(line);
  }

  //活动表情
  const stampImage = await event.getRewardStamp(displayedServerList[0]);
  if (stampImage) {
    list.push(
      await drawList({
        key: '活动表情',
        content: [stampImage],
        textSize: 160,
        lineHeight: 160,
      }),
    );
    list.push(line);
  }

  //奖励卡牌
  const rewardCardList: Card[] = [];
  for (let i = 0; i < event.rewardCards.length; i++) {
    const cardId = event.rewardCards[i];
    rewardCardList.push(new Card(cardId));
  }
  list.push(
    await drawCardListInList({
      key: '奖励卡牌',
      cardList: rewardCardList,
      cardIdVisible: true,
      skillTypeVisible: true,
      cardTypeVisible: true,
      trainingStatus: false,
    }),
  );
  list.push(line);

  const gachaCardList: Card[] = [];
  const gachaCardIdList: number[] = []; //用于去重
  const gachaImageList: Canvas[] = [];
  const gachaIdList: number[] = []; //用于去重
  //活动期间卡池卡牌
  for (let i = 0; i < displayedServerList.length; i++) {
    const server = displayedServerList[i];
    if (event.startAt[server] == null) {
      continue;
    }
    const EventGachaAndCardList = await getEventGachaAndCardList(event, server);
    const tempGachaList = EventGachaAndCardList.gachaList;
    const tempGachaCardList = EventGachaAndCardList.gachaCardList;
    for (let i = 0; i < tempGachaList.length; i++) {
      const tempGacha = tempGachaList[i];
      if (gachaIdList.indexOf(tempGacha.gachaId) != -1) {
        continue;
      }
      if (i == 0) {
        gachaImageList.push(
          await drawGachaDataBlock(
            tempGacha,
            `${serverNameFullList[server]}相关卡池`,
          ),
        );
      } else {
        gachaImageList.push(await drawGachaDataBlock(tempGacha));
      }
      gachaIdList.push(tempGacha.gachaId);
    }
    for (let i = 0; i < tempGachaCardList.length; i++) {
      const tempCard = tempGachaCardList[i];
      if (gachaCardIdList.indexOf(tempCard.cardId) != -1) {
        continue;
      }
      gachaCardIdList.push(tempCard.cardId);
      gachaCardList.push(tempCard);
    }
  }

  list.push(
    await drawCardListInList({
      key: '活动期间卡池卡牌',
      cardList: gachaCardList,
      cardIdVisible: true,
      skillTypeVisible: true,
      cardTypeVisible: true,
      trainingStatus: false,
    }),
  );

  const listImage = drawDataBlock({ list });
  //创建最终输出数组

  const all = [];
  all.push(drawTitle('查询', '活动'));

  all.push(listImage);

  //歌曲
  for (let i = 0; i < displayedServerList.length; i++) {
    const server = displayedServerList[i];
    if (event.startAt[server] == null) {
      continue;
    }
    const songList: Song[] = getPresentSongList(
      server,
      event.startAt[server],
      event.endAt[server] + 1000 * 60 * 60,
    );

    if (songList.length !== 0) {
      const isDuplicate = all.some((block) => {
        // 检查当前的songList是否与已存在的块的songList完全相同
        return JSON.stringify(block.songList) === JSON.stringify(songList);
      });

      if (!isDuplicate) {
        all.push(
          await drawSongListDataBlock(
            songList,
            `${serverNameFullList[server]}相关歌曲`,
          ),
        );
      }
    }
  }

  //卡池
  for (let i = 0; i < gachaImageList.length; i++) {
    all.push(gachaImageList[i]);
  }

  const BGimage = await event.getEventBGImage();

  return await createOutputFinalImages({
    useEasyBG,
    BGimage,
    text: 'Event',
    compress,
  })(all);
}

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
