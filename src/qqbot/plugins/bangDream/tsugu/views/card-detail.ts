import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { Skill } from '@/qqbot/plugins/bangDream/tsugu/domain/skill';
import {
  drawList,
  line,
  drawListByServerList,
  drawListMerge,
} from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { drawCardIllustration } from '@/qqbot/plugins/bangDream/tsugu/layout/card';
import { drawSkillInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/skill';
import { drawTimeInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/time';
import { drawCardPrefixInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/card-prefix';
import { drawCardStatInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/stat';
import { drawCardListInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/card-icon-list';
import { drawSdCharacterInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/card-sd-character';
import { drawEventDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import { drawGachaDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import { Image, Canvas } from 'skia-canvas';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { createOutputFinalImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { Event } from '@/qqbot/plugins/bangDream/tsugu/domain/event';
import { Gacha } from '@/qqbot/plugins/bangDream/tsugu/domain/gacha';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';

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

  const list: Array<Image | Canvas> = [];

  //标题
  list.push(await drawCardPrefixInList(card, displayedServerList));
  const trainingStatusList = card.getTrainingStatusList();
  list.push(new Canvas(800, 30));

  //插画
  for (let i = 0; i < trainingStatusList.length; i++) {
    const element = trainingStatusList[i];
    list.push(
      await drawCardIllustration({
        card: card,
        trainingStatus: element,
        isList: true,
      }),
    );
    list.push(new Canvas(800, 30));
  }

  //类型
  const typeImage = drawList({
    key: '类型',
    text: card.getTypeName(),
  });

  //卡牌ID
  const idImage = drawList({
    key: 'ID',
    text: card.cardId.toString(),
  });

  list.push(drawListMerge([typeImage, idImage]));
  list.push(line);

  //综合力
  list.push(await drawCardStatInList(card));
  list.push(line);

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
  //技能
  const skill = new Skill(card.skillId);
  list.push(
    await drawSkillInList(
      { key: '技能', card: card, content: skill },
      displayedServerList,
    ),
  );
  list.push(line);

  //标题
  list.push(
    await drawListByServerList(card.prefix, '标题', displayedServerList),
  );
  list.push(line);

  //判断是否来自卡池
  for (let j = 0; j < displayedServerList.length; j++) {
    let releaseFromGacha = false;
    const server = displayedServerList[j];
    if (card.releasedAt[server] == null) {
      continue;
    }
    const sourceOfServer = source[server];
    for (const i in sourceOfServer) {
      if (Object.prototype.hasOwnProperty.call(sourceOfServer, i)) {
        if (i == 'gacha' && card.rarity > 2 && card.type != 'kirafes') {
          //招募语
          list.push(
            await drawListByServerList(
              card.gachaText,
              '招募语',
              displayedServerList,
            ),
          );
          list.push(line);
          releaseFromGacha = true;
          break;
        }
      }
    }
    if (releaseFromGacha) {
      break;
    }
  }

  //发售日期
  list.push(
    await drawTimeInList(
      {
        key: '发布日期',
        content: card.releasedAt,
      },
      displayedServerList,
    ),
  );
  list.push(line);

  //缩略图
  list.push(
    await drawCardListInList({
      key: '缩略图',
      cardList: [card],
      cardIdVisible: false,
      skillTypeVisible: false,
      cardTypeVisible: false,
    }),
  );
  list.push(line);

  //演出缩略图
  list.push(await drawSdCharacterInList(card));

  //创建最终输出数组
  const listImage = drawDataBlock({ list });
  const all = [];
  all.push(drawTitle('查询', '卡牌'));
  all.push(listImage);
  //相关来源
  const tempEventIdList = []; //用于防止重复
  const tempGachaIdList = [];
  const eventImageList: Array<Canvas | Image> = [];
  const gachaImageList: Array<Canvas | Image> = [];
  for (let k = 0; k < displayedServerList.length; k++) {
    const server = displayedServerList[k];
    //如果卡牌有关联活动
    if (card.releaseEvent[server].length != 0) {
      const tempEvent = new Event(card.releaseEvent[server][0]);
      if (!tempEventIdList.includes(tempEvent.eventId)) {
        eventImageList.push(
          await drawEventDataBlock(
            tempEvent,
            displayedServerList,
            `${serverNameFullList[server]}相关活动`,
          ),
        );
        tempEventIdList.push(tempEvent.eventId);
      }
    }
    //如果卡牌有关联卡池
    if (card.releaseGacha[server].length != 0) {
      const gachaIdList = card.releaseGacha[server];
      gachaIdList.sort((a, b) => {
        const gachaA = new Gacha(a);
        const gachaB = new Gacha(b);
        if (
          server != Server.jp &&
          gachaA.publishedAt[server] != gachaB.publishedAt[server]
        ) {
          return gachaA.publishedAt[server] - gachaB.publishedAt[server];
        } else {
          return gachaA.gachaId - gachaB.gachaId;
        }
      });
      const tempGacha = new Gacha(gachaIdList[0]);
      const tempEventId = tempGacha.getEventId()[server];
      if (tempEventId != null) {
        const tempEvent = new Event(tempEventId);
        if (!tempEventIdList.includes(tempEvent.eventId)) {
          eventImageList.push(
            await drawEventDataBlock(
              tempEvent,
              displayedServerList,
              `${serverNameFullList[server]}相关活动`,
            ),
          );
          tempEventIdList.push(tempEvent.eventId);
        }
      }
      if (!tempGachaIdList.includes(tempGacha.gachaId)) {
        gachaImageList.push(
          await drawGachaDataBlock(
            tempGacha,
            `${serverNameFullList[server]}相关卡池`,
          ),
        );
        tempGachaIdList.push(tempGacha.gachaId);
      }
    }
  }
  for (let i = 0; i < eventImageList.length; i++) {
    all.push(eventImageList[i]);
  }
  for (let i = 0; i < gachaImageList.length; i++) {
    all.push(gachaImageList[i]);
  }

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
