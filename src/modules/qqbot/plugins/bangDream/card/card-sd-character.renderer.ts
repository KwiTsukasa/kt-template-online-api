import { Costume } from '@/modules/qqbot/plugins/bangDream/catalog/costume.model';
import { Card } from '@/modules/qqbot/plugins/bangDream/card/card.model';
import { Canvas } from 'skia-canvas';
import { drawList } from '@/modules/qqbot/plugins/bangDream/shared/list-frame.renderer';
import {
  BANGDREAM_CARD_SD_CHARACTER_SPEC,
  getCardSdCharacterCropRects,
  getCardSdCharacterListLineHeight,
  getCardSdCharacterListTextSize,
} from '@/modules/qqbot/plugins/bangDream/card/card-sd-character.layout';

/**
 * 在图片布局层中绘制SD角色In列表。
 *
 * @param card - 卡牌参数。
 * @returns 异步处理结果。
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
