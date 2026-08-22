import { Player } from '@/modules/plugins/bangdream/src/domain/player/player.model';
import { Canvas, Image } from 'skia-canvas';
import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { resizeImage } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { drawTextWithImages } from '@/modules/plugins/bangdream/src/theme/canvas-text';
import { Character } from '@/modules/plugins/bangdream/src/domain/character/character.model';
import bangdreamCatalogCache from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import {
  createCharacterDetailIconSpec,
  createCharacterDetailItemLayout,
  createCharacterDetailListFrameSpec,
  createCharacterDetailTextSpec,
} from '@/modules/plugins/bangdream/src/domain/player/player-character-detail.layout';

interface drawBandDetailsInListOptions {
  [characterId: number]: Array<Canvas | Image | string>;
}
//画角色等级
/**
 * 根据`CharacterDetailsInListOptions`、`key`绘制或格式化角色；把图片、文本或图形按布局规格绘制到画布。
 * @param CharacterDetailsInListOptions - 控制角色筛选、缓存或输出方式的可选项，包含 `i` 字段。
 * @param key - 用于读取或更新角色的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 角色。
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
 * 根据`player`、`key`绘制或格式化角色排名。
 * @param player - 用于角色排名的领域对象，包含 `profile` 字段。
 * @param key - 用于读取或更新角色排名的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 角色排名。
 */
export async function drawCharacterRankInList(player: Player, key?: string) {
  const characterRankMap = player.profile.userCharacterRankMap?.entries;
  const CharacterDetailsInListOptions = {};
  for (const i in bangdreamCatalogCache['characters']) {
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
