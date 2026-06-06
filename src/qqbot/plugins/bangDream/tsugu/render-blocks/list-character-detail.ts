import { Player } from '@/qqbot/plugins/bangDream/tsugu/models/player';
import { Canvas, Image } from 'skia-canvas';
import { drawList } from './list-frame';
import { resizeImage } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import { drawTextWithImages } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/models/character';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/models/main-data-store';

interface drawBandDetailsInListOptions {
  [characterId: number]: Array<Canvas | Image | string>;
}
//画角色等级
/**
 * 在图片布局层中绘制角色In列表。
 *
 * @param CharacterDetailsInListOptions - 角色详情列表In列表Options参数。
 * @param key - 当前字段键名，未传入时使用默认值。
 */
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

/**
 * 在图片布局层中绘制角色RankIn列表。
 *
 * @param player - 玩家参数。
 * @param key - 当前字段键名，未传入时使用默认值。
 */
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
