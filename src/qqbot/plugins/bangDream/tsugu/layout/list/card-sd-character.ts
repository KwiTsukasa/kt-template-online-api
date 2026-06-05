import { Costume } from '@/qqbot/plugins/bangDream/tsugu/domain/costume';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { Canvas } from 'skia-canvas';
import { drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';

export async function drawSdCharacterInList(card: Card): Promise<Canvas> {
  const costumeId = card.costumeId;
  const costume = new Costume(costumeId);
  await costume.initFull();
  const sdCharacterImage = await costume.getSdCharacter();
  //从高度84开始，把sdCharaImage切成田字形的四分，大小都为400*470
  const sdCharacterImageList: Array<Canvas> = [];
  for (let i = 0; i < 4; i++) {
    const canvas = new Canvas(400, 470);
    const context = canvas.getContext('2d');
    const x = i % 2 === 0 ? 0 : 400;
    const y = i < 2 ? 84 : 554;

    context.drawImage(sdCharacterImage, x, y, 400, 470, 0, 0, 400, 470);
    sdCharacterImageList.push(canvas);
  }
  return drawList({
    key: '演出缩略图',
    content: sdCharacterImageList,
    lineHeight: (470 / 400) * 190,
    textSize: (470 / 400) * 190,
    spacing: 0,
  });
}
