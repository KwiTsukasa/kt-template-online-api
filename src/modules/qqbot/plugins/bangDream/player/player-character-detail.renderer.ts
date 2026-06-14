import { Player } from '@/modules/qqbot/plugins/bangDream/player/player.model';
import { Canvas, Image } from 'skia-canvas';
import { drawList } from '@/modules/qqbot/plugins/bangDream/shared/list-frame.renderer';
import { resizeImage } from '@/modules/qqbot/plugins/bangDream/shared/image-stack';
import { drawTextWithImages } from '@/modules/qqbot/plugins/bangDream/theme/canvas-text';
import { Character } from '@/modules/qqbot/plugins/bangDream/character/character.model';
import mainAPI from '@/modules/qqbot/plugins/bangDream/shared/main-data-store';
import {
  createCharacterDetailIconSpec,
  createCharacterDetailItemLayout,
  createCharacterDetailListFrameSpec,
  createCharacterDetailTextSpec,
} from '@/modules/qqbot/plugins/bangDream/player/player-character-detail.layout';

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
    const tempCharacterIcon = resizeImage({
      image: await tempCharacter.getIcon(),
      ...createCharacterDetailIconSpec(),
    });
    const textSpec = createCharacterDetailTextSpec();
    const tempCharacterRankText = drawTextWithImages({
      content,
      maxWidth: textSpec.maxWidth,
      lineHeight: textSpec.lineHeight,
    });
    const layout = createCharacterDetailItemLayout(tempCharacterRankText);
    const canvas = new Canvas(layout.canvasWidth, layout.canvasHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempCharacterIcon, layout.iconX, layout.iconY);
    ctx.drawImage(tempCharacterRankText, layout.textX, layout.textY);
    characterAndContentList.push(canvas);
  }
  const frameSpec = createCharacterDetailListFrameSpec(
    characterAndContentList?.[0],
  );
  const characterAndContentListImage = drawList({
    key,
    content: characterAndContentList,
    spacing: frameSpec.spacing,
    lineHeight: frameSpec.lineHeight,
    textSize: frameSpec.textSize,
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
