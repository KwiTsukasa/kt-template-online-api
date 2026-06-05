import { assetsRootPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { setFontStyle } from '@/qqbot/plugins/bangDream/tsugu/graphics/text';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/domain/band';
import { Attribute } from '@/qqbot/plugins/bangDream/tsugu/domain/attribute';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { Image, Canvas, loadImage } from 'skia-canvas';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import { drawCardIconSkill } from '@/qqbot/plugins/bangDream/tsugu/layout/skill';
import * as path from 'path';
import { Skill } from '@/qqbot/plugins/bangDream/tsugu/domain/skill';
import { bestdoriUrl } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/graphics/utils';

const cardTypeIconList: { [type: string]: Image } = {};
const starList: { [type: string]: Image } = {};
let limitBreakIcon: Image;

async function loadImageOnce() {
  cardTypeIconList.limited = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/L.png'),
  );
  cardTypeIconList.dreamfes = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/D.png'),
  );
  cardTypeIconList.kirafes = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/K.png'),
  );
  cardTypeIconList.birthday = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/B.png'),
  );
  starList.normal = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/star.png'),
  );
  starList.trained = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/star_trained.png'),
  );
  limitBreakIcon = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/limitBreakRank.png'),
  );
}

loadImageOnce();

//根据稀有度与属性，获得图标框
async function getCardIconFrame(
  rarity: number,
  attribute: 'cool' | 'happy' | 'pure' | 'powerful',
): Promise<Image> {
  const baseUrl = `${bestdoriUrl}/res/image/card-`;
  let imageUrl: string;
  if (rarity == 1) {
    imageUrl = baseUrl + '1-' + attribute + '.png';
  } else {
    imageUrl = baseUrl + rarity.toString() + '.png';
  }
  const imageBuffer = await downloadFileCache(imageUrl);
  return await loadImage(imageBuffer);
}

//根据稀有度与属性，获得插画框
async function getCardIllustrationFrame(
  rarity: number,
  attribute: 'cool' | 'happy' | 'pure' | 'powerful',
): Promise<Image> {
  const baseUrl = `${bestdoriUrl}/res/image/frame-`;
  let imageUrl: string;
  if (rarity == 1) {
    imageUrl = baseUrl + '1-' + attribute + '.png';
  } else {
    imageUrl = baseUrl + rarity.toString() + '.png';
  }
  const imageBuffer = await downloadFileCache(imageUrl);
  return await loadImage(imageBuffer);
}

interface DrawCardIconOptions {
  card: Card;
  trainingStatus: boolean;
  illustrationTrainingStatus?: boolean;
  limitBreakRank?: number;
  level?: number;
  cardIdVisible?: boolean;
  skillTypeVisible?: boolean;
  cardTypeVisible?: boolean;
  skillLevel?: number;
}

//画卡icon
export async function drawCardIcon({
  card,
  trainingStatus,
  illustrationTrainingStatus,
  limitBreakRank = 0,
  cardIdVisible = false,
  skillTypeVisible = false,
  cardTypeVisible = true,
  skillLevel,
}: DrawCardIconOptions): Promise<Canvas> {
  trainingStatus = card.ableToTraining(trainingStatus);
  illustrationTrainingStatus ??= trainingStatus;
  const canvas: Canvas = cardIdVisible
    ? new Canvas(180, 210)
    : new Canvas(180, 180);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    await card.getCardIconImage(illustrationTrainingStatus),
    0,
    0,
    180,
    180,
  );
  //如果显示卡牌ID，画面高度为210，在下方显示
  if (cardIdVisible) {
    ctx.textAlign = 'start';
    ctx.textBaseline = 'middle';
    setFontStyle(ctx, 30, 'old');
    ctx.fillStyle = '#a7a7a7';
    ctx.fillText(`ID:${card.cardId}`, 4, 195);
  }
  //如果显示技能类型，在右上显示
  if (skillLevel != undefined) {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(138, 91, 35, 39);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    setFontStyle(ctx, 35, 'old');
    ctx.fillText(skillLevel.toString(), 155.5, 107.5);
  }
  //如果显示技能类型，在右上显示
  else if (cardTypeVisible) {
    if (cardTypeIconList[card.type] != undefined) {
      ctx.drawImage(cardTypeIconList[card.type], 138, 91);
    }
  }
  if (skillTypeVisible) {
    const skill = new Skill(card.skillId);
    const skillTypeIcon = await drawCardIconSkill(skill);
    ctx.drawImage(skillTypeIcon, 180 - skillTypeIcon.width, 142);
  }
  //获得框
  const frame = await getCardIconFrame(card.rarity, card.attribute);
  ctx.drawImage(frame, 0, 0);
  const attributeIcon = await new Attribute(card.attribute).getIcon();
  ctx.drawImage(attributeIcon, 132.5, 3, 45.26, 45.26);
  const bandIcon = await new Band(card.bandId).getIcon();
  ctx.drawImage(bandIcon, 0, 0, 45, 45);
  if (limitBreakRank != 0) {
    ctx.drawImage(limitBreakIcon, 137, 51, 39, 39);
    setFontStyle(ctx, 25, 'old');
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(limitBreakRank.toString(), 155, 70);
  }
  const star = starList[trainingStatus ? 'trained' : 'normal'];
  for (let i = 0; i < card.rarity; i++) {
    //星星数量
    ctx.drawImage(star, 4, 150 - 26 * i, 29, 29);
  }
  return canvas;
}

interface DrawCardIllustrationOptions {
  card: Card;
  trainingStatus: boolean;
  isList?: boolean;
}
//画卡插画
export async function drawCardIllustration({
  card,
  trainingStatus,
  isList = false,
}: DrawCardIllustrationOptions): Promise<Canvas> {
  trainingStatus = card.ableToTraining(trainingStatus);
  const cardIllustrationImage =
    await card.getCardIllustrationImage(trainingStatus);
  const canvas = new Canvas(1360, 905);
  const ctx = canvas.getContext('2d');
  //将cardIllustration等比例缩放至宽度为1334
  const scale = 1334 / cardIllustrationImage.width;
  const illustrationCanvas = new Canvas(1334, 879);
  const illustrationCtx = illustrationCanvas.getContext('2d');
  const illustrationHeight = cardIllustrationImage.height * scale;
  illustrationCtx.drawImage(
    cardIllustrationImage,
    0,
    879 / 2 - illustrationHeight / 2,
    1334,
    illustrationHeight,
  );
  ctx.drawImage(illustrationCanvas, 13, 13);
  //获得框
  const frame = await getCardIllustrationFrame(card.rarity, card.attribute);
  ctx.drawImage(frame, 0, 0, 1360, 905);
  const attributeIcon = await new Attribute(card.attribute).getIcon();
  ctx.drawImage(attributeIcon, 1195, 11, 150, 150);
  const bandIcon = await new Band(card.bandId).getIcon();
  ctx.drawImage(bandIcon, 11, 11, 150, 150);

  const star = starList[trainingStatus ? 'trained' : 'normal'];
  for (let i = 0; i < card.rarity; i++) {
    //星星数量
    ctx.drawImage(star, 5, 780 - 100 * i, 110, 110);
  }
  if (isList) {
    //等比例缩放到宽度为widthMax
    const scale = 800 / 1360;
    const tempCanvas = new Canvas(800, 905 * scale);
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 800, 905 * scale);
    return tempCanvas;
  } else {
    return canvas;
  }
}
