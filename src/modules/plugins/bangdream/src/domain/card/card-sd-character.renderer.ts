import { Costume } from '@/modules/plugins/bangdream/src/domain/catalog/costume.model';
import { Card } from '@/modules/plugins/bangdream/src/domain/card/card.model';
import { Canvas } from 'skia-canvas';
import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import {
  BANGDREAM_CARD_SD_CHARACTER_SPEC,
  getCardSdCharacterCropRects,
  getCardSdCharacterListLineHeight,
  getCardSdCharacterListTextSize,
} from '@/modules/plugins/bangdream/src/domain/card/card-sd-character.layout';

/**
 * 根据`card`绘制或格式化Sd角色；把图片、文本或图形按布局规格绘制到画布。
 * @param card - 用于Sd角色的领域对象，包含 `costumeId` 字段。
 * @returns Sd角色。
 */
export async function drawSdCharacterInList(card: Card): Promise<Canvas> {
  const costumeId = card.costumeId;
  const costume = new Costume(costumeId);
  await costume.initFull();
  const sdCharacterImage = await costume.getSdCharacter();
  const sdCharacterImageList: Array<Canvas> = [];
  for (const cropRect of getCardSdCharacterCropRects()) {
    const canvas = new Canvas(cropRect.width, cropRect.height);
    const context = canvas.getContext('2d');

    context.drawImage(
      sdCharacterImage,
      cropRect.sourceX,
      cropRect.sourceY,
      cropRect.width,
      cropRect.height,
      0,
      0,
      cropRect.width,
      cropRect.height,
    );
    sdCharacterImageList.push(canvas);
  }
  return drawList({
    key: '演出缩略图',
    content: sdCharacterImageList,
    lineHeight: getCardSdCharacterListLineHeight(),
    textSize: getCardSdCharacterListTextSize(),
    spacing: BANGDREAM_CARD_SD_CHARACTER_SPEC.list.spacing,
  });
}
