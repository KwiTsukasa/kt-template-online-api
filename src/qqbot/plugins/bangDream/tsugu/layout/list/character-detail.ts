import { Player } from '@/qqbot/plugins/bangDream/tsugu/domain/player';
import { Canvas, Image } from 'skia-canvas';
import { drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { resizeImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { drawTextWithImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/text';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/domain/character';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';

interface drawBandDetailsInListOptions {
  [characterId: number]: Array<Canvas | Image | string>;
}
//画角色等级
async function drawCharacterInList(
  CharacterDetailsInListOptions: drawBandDetailsInListOptions,
  key?: string,
) {
  const characterAndContentList: Array<Canvas> = [];
  for (const i in CharacterDetailsInListOptions) {
    const tempCharacter = new Character(parseInt(i));
    const content = CharacterDetailsInListOptions[i];
    const maxWidth = 76;
    const logoWidth = 50;
    const tempCharacterIcon = resizeImage({
      image: await tempCharacter.getIcon(),
      widthMax: logoWidth,
    });
    const canvas = new Canvas(maxWidth, 100);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempCharacterIcon, (maxWidth - logoWidth) / 2, 0);
    const tempCharacterRankText = drawTextWithImages({
      content,
      maxWidth: maxWidth,
      lineHeight: 40,
    });
    ctx.drawImage(
      tempCharacterRankText,
      maxWidth / 2 - tempCharacterRankText.width / 2,
      50,
    );
    characterAndContentList.push(canvas);
  }
  const characterAndContentListImage = drawList({
    key,
    content: characterAndContentList,
    spacing: 0,
    lineHeight: characterAndContentList?.[0].height,
    textSize: characterAndContentList?.[0].height,
  });
  return characterAndContentListImage;
}

export async function drawCharacterRankInList(player: Player, key?: string) {
  const characterRankMap = player.profile.userCharacterRankMap?.entries;
  const CharacterDetailsInListOptions = {};
  for (const i in mainAPI['characters']) {
    if (characterRankMap[i] != undefined) {
      CharacterDetailsInListOptions[i] = [`${characterRankMap[i].rank}`];
    } else {
      CharacterDetailsInListOptions[i] = ['?'];
    }
  }
  const characterRankInList = await drawCharacterInList(
    CharacterDetailsInListOptions,
    key,
  );
  return characterRankInList;
}
