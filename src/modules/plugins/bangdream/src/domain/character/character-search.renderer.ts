import { Character } from '@/modules/plugins/bangdream/src/domain/character/character.model';
import bangdreamCatalogCache from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import {
  match,
  FuzzySearchResult,
} from '@/modules/plugins/bangdream/src/domain/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawDataBlock } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { drawCharacterHalfBlock } from '@/modules/plugins/bangdream/src/theme/detail-block.renderer';
import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { drawCharacterDetail } from '@/modules/plugins/bangdream/src/domain/character/character-detail.renderer';

const maxWidth = 1370;

/**
 * 根据`matches`、`displayedServerList`、`compress`绘制或格式化角色；当 `tempCharacterList.length == 0` 成立时返回 `['没有搜索到符合条件的角色']`。
 * @param matches - 决定角色内容、边界或目标的 `matches` 值。
 * @param displayedServerList - 用于角色的领域对象，包含 `length`、`j` 字段；省略时默认采用 `globalDefaultServer`。
 * @param compress - 决定角色内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的角色列表；没有匹配项时为空数组。
 */
export async function drawCharacterList(
  matches: FuzzySearchResult,
  displayedServerList: Server[] = globalDefaultServer,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  //计算模糊搜索结果
  const tempCharacterList: Array<Character> = []; //最终输出的角色列表
  const characterIdList: Array<number> = Object.keys(
    bangdreamCatalogCache['characters'],
  ).map(Number); //所有卡牌ID列表
  for (let i = 0; i < characterIdList.length; i++) {
    const tempCharacter = new Character(characterIdList[i]);
    let isMatch = match(matches, tempCharacter, ['scoreUpMaxValue']);
    //如果在所有所选服务器列表中都不存在，则不输出
    let numberOfNotReleasedServer = 0;
    for (let j = 0; j < displayedServerList.length; j++) {
      const server = displayedServerList[j];
      //通过该服务器是否有角色名来判断是否已经发布
      if (tempCharacter.characterName[server] == null) {
        numberOfNotReleasedServer++;
      }
    }
    if (numberOfNotReleasedServer == displayedServerList.length) {
      isMatch = false;
    }
    if (isMatch) {
      tempCharacterList.push(tempCharacter);
    }
  }
  if (tempCharacterList.length == 0) {
    return ['没有搜索到符合条件的角色'];
  }
  if (tempCharacterList.length == 1) {
    return await drawCharacterDetail(
      tempCharacterList[0].characterId,
      displayedServerList,
      compress,
    );
  }
  const characterImageList: Canvas[] = [];
  for (let i = 0; i < tempCharacterList.length; i++) {
    const element = tempCharacterList[i];
    characterImageList.push(
      await drawCharacterHalfBlock(element, displayedServerList),
    );
  }
  const characterListImage = drawList({
    content: characterImageList,
    maxWidth: maxWidth,
    spacing: 20,
    lineHeight: 820,
    textSize: 800,
  });
  const all = [];
  all.push(drawTitle('查询', '角色列表'));
  all.push(
    drawDataBlock({
      list: [characterListImage],
    }),
  );
  return await outputEasyImages(all, { compress });
}
