import { Character } from '@/qqbot/plugins/bangDream/tsugu/domain/character';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import {
  match,
  FuzzySearchResult,
} from '@/qqbot/plugins/bangDream/tsugu/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { drawCharacterHalfBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import { drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { drawCharacterDetail } from './character-detail';

const maxWidth = 1370;

export async function drawCharacterList(
  matches: FuzzySearchResult,
  displayedServerList: Server[] = globalDefaultServer,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  //计算模糊搜索结果
  const tempCharacterList: Array<Character> = []; //最终输出的角色列表
  const characterIdList: Array<number> = Object.keys(mainAPI['characters']).map(
    Number,
  ); //所有卡牌ID列表
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
