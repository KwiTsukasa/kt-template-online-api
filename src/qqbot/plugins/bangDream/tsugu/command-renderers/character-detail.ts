import {
  drawList,
  line,
  drawListByServerList,
  drawListMerge,
  drawImageListCenter,
  drawTipsInList,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-frame';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/data-block';
import { Image, Canvas } from 'skia-canvas';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/title';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/canvas/output';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/models/character';
import { drawCharacterHalfBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/detail-blocks';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/tsugu/canvas/dotted-line';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/models/band';
import { formatMonthDay } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-time';
import {
  stackImage,
  stackImageHorizontal,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import { drawBandInList } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-band';
import { config } from '@/qqbot/plugins/bangDream/tsugu/search/fuzzy-search';
import { getColorFromHex } from '@/qqbot/plugins/bangDream/tsugu/models/color';

const rightListWidth = 500;
const rightListLine: Canvas = drawDottedLine({
  width: rightListWidth,
  height: 30,
  startX: 5,
  startY: 15,
  endX: rightListWidth - 5,
  endY: 15,
  radius: 2,
  gap: 10,
  color: '#a8a8a8',
});

const constellationList = {
  capricorn: '摩羯座',
  aquarius: '水瓶座',
  pisces: '双鱼座',
  aries: '白羊座',
  taurus: '金牛座',
  gemini: '双子座',
  cancer: '巨蟹座',
  leo: '狮子座',
  virgo: '处女座',
  libra: '天秤座',
  scorpio: '天蝎座',
  sagittarius: '射手座',
};

/**
 * 在QQBot 图片视图层中绘制角色详情。
 *
 * @param characterId - 角色 ID。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawCharacterDetail(
  characterId: number,
  displayedServerList: Server[] = globalDefaultServer,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const character = new Character(characterId);
  if (!character.isExist) {
    return ['错误: 角色不存在'];
  }
  await character.initFull();
  const all: Array<Canvas | Image> = [];
  //右侧文字
  const listRight: Array<Canvas | Image> = [];
  //角色名
  listRight.push(
    await drawListByServerList(
      character.characterName,
      '角色名',
      displayedServerList,
      rightListWidth,
    ),
  );
  listRight.push(rightListLine);

  //ruby
  listRight.push(
    await drawListByServerList(
      character.ruby,
      'ruby',
      displayedServerList,
      rightListWidth,
    ),
  );
  listRight.push(rightListLine);

  //nickname
  if (!character.nickname.every((element) => element === null)) {
    //如果有昵称
    listRight.push(
      await drawListByServerList(
        character.nickname,
        '昵称',
        displayedServerList,
        rightListWidth,
      ),
    );
    listRight.push(rightListLine);
  }
  //配音
  listRight.push(
    await drawListByServerList(
      character.profile.characterVoice,
      '配音',
      displayedServerList,
      rightListWidth,
    ),
  );
  listRight.push(rightListLine);
  //应援色
  const tempColor = getColorFromHex(character.colorCode);
  listRight.push(
    drawList({
      key: '应援色',
      content: [character.colorCode, tempColor.generateColorBlock(1)],
      maxWidth: rightListWidth,
    }),
  );

  //画上部图片
  const imageLeft = stackImage(listRight);
  const characterHalfBlock = await drawCharacterHalfBlock(character);
  const imageUp = stackImageHorizontal([
    imageLeft,
    new Canvas(50, 50),
    characterHalfBlock,
  ]);

  //画下部文字
  const list: Array<Canvas | Image> = [];
  //描述
  list.push(line);
  const tempServer = getServerByPriority(character.characterName);
  list.push(
    drawTipsInList({
      text: character.profile.selfIntroduction[tempServer],
    }),
  );
  list.push(line);

  //乐队
  const band = new Band(character.bandId);
  list.push(
    await drawBandInList({
      key: '乐队',
      content: [band],
    }),
  );
  list.push(line);
  //生日
  const birthdayTextImage = drawList({
    text: formatMonthDay(Number(character.profile.birthday)),
    key: '生日',
  });
  //星座
  const constellationTextImafe = drawList({
    text: constellationList[character.profile.constellation],
    key: '星座',
  });
  list.push(drawListMerge([birthdayTextImage, constellationTextImafe]));
  list.push(line);
  //身高
  const heightTextImage = drawList({
    text: `${character.profile.height}cm`,
    key: '身高',
  });
  //part
  const partTextImage = drawList({
    text: character.profile.part,
    key: '位置',
  });
  list.push(drawListMerge([heightTextImage, partTextImage]));
  list.push(line);
  //学校
  list.push(
    await drawListByServerList(
      character.profile.school,
      '学校',
      displayedServerList,
    ),
  );
  list.push(line);

  //年级
  const schoolYearTextImage = await drawListByServerList(
    character.profile.schoolYear,
    '年级',
    displayedServerList,
  );
  //班级
  const schoolClsTextImage = await drawListByServerList(
    character.profile.schoolCls,
    '班级',
    displayedServerList,
  );
  list.push(drawListMerge([schoolYearTextImage, schoolClsTextImage]));
  list.push(line);

  //兴趣
  list.push(
    await drawListByServerList(
      character.profile.hobby,
      '兴趣',
      displayedServerList,
    ),
  );
  list.push(line);
  //喜欢的食物
  list.push(
    await drawListByServerList(
      character.profile.favoriteFood,
      '喜欢的食物',
      displayedServerList,
    ),
  );
  list.push(line);

  //讨厌的食物
  list.push(
    await drawListByServerList(
      character.profile.hatedFood,
      '讨厌的食物',
      displayedServerList,
    ),
  );
  list.push(line);

  //角色模糊搜索文字
  list.push(
    drawList({
      text: config.characterId[character.characterId].toString(),
      key: '角色模糊搜索关键字',
    }),
  );
  list.push(line);

  //乐队模糊搜索文字
  list.push(
    drawList({
      text: config.bandId[character.bandId].toString(),
      key: '乐队模糊搜索关键字',
    }),
  );

  //总体
  all.push(drawTitle('查询', '角色'));
  all.push(
    drawDataBlock({
      list: [
        drawImageListCenter([await character.getNameBanner()]),
        new Canvas(50, 50),
        imageUp,
        stackImage(list),
      ],
    }),
  );

  return await outputEasyImages(all, { compress });
}
