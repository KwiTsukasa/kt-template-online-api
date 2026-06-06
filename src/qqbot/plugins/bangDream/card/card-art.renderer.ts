import { setFontStyle } from '@/qqbot/plugins/bangDream/theme/canvas-text';
import { Band } from '@/qqbot/plugins/bangDream/catalog/band.model';
import { Attribute } from '@/qqbot/plugins/bangDream/catalog/attribute.model';
import { Card } from '@/qqbot/plugins/bangDream/card/card.model';
import { Image, Canvas, loadImage } from 'skia-canvas';
import { drawCardIconSkill } from '@/qqbot/plugins/bangDream/card/card-skill-text.renderer';
import { Skill } from '@/qqbot/plugins/bangDream/catalog/skill.model';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/theme/canvas-image';
import { getBangDreamAssetPath } from '@/qqbot/plugins/bangDream/theme/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/theme/render-theme';
import {
  BANGDREAM_CARD_ART_SPEC,
  BangDreamCardArtAttribute,
} from '@/qqbot/plugins/bangDream/card/card-art.layout';
import { cardArtResourceRepository } from '@/qqbot/plugins/bangDream/card/card-art.repository';

const cardTypeIconList: { [type: string]: Image } = {};
const starList: { [type: string]: Image } = {};
let limitBreakIcon: Image;

/**
 * 在图片布局层中加载图片Once。
 */
async function loadImageOnce() {
  cardTypeIconList.limited = await loadImageFromPath(
    getBangDreamAssetPath('cardLimited'),
  );
  cardTypeIconList.dreamfes = await loadImageFromPath(
    getBangDreamAssetPath('cardDreamfes'),
  );
  cardTypeIconList.kirafes = await loadImageFromPath(
    getBangDreamAssetPath('cardKirafes'),
  );
  cardTypeIconList.birthday = await loadImageFromPath(
    getBangDreamAssetPath('cardBirthday'),
  );
  starList.normal = await loadImageFromPath(getBangDreamAssetPath('cardStar'));
  starList.trained = await loadImageFromPath(
    getBangDreamAssetPath('cardStarTrained'),
  );
  limitBreakIcon = await loadImageFromPath(
    getBangDreamAssetPath('cardLimitBreakRank'),
  );
}

loadImageOnce();

//根据稀有度与属性，获得图标框
/**
 * 在图片布局层中获取卡牌图标Frame。
 *
 * @param rarity - rarity参数。
 * @param attribute - 属性参数。
 * @returns 异步处理结果。
 */
async function getCardIconFrame(
  rarity: number,
  attribute: BangDreamCardArtAttribute,
): Promise<Image> {
  const imageBuffer = await cardArtResourceRepository.getIconFrameBuffer(
    rarity,
    attribute,
  );
  return await loadImage(imageBuffer);
}

//根据稀有度与属性，获得插画框
/**
 * 在图片布局层中获取卡牌IllustrationFrame。
 *
 * @param rarity - rarity参数。
 * @param attribute - 属性参数。
 * @returns 异步处理结果。
 */
async function getCardIllustrationFrame(
  rarity: number,
  attribute: BangDreamCardArtAttribute,
): Promise<Image> {
  const imageBuffer =
    await cardArtResourceRepository.getIllustrationFrameBuffer(
      rarity,
      attribute,
    );
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
/**
 * 在图片布局层中绘制卡牌图标。
 *
 * @param options1 - options1参数。
 * @returns 异步处理结果。
 */
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
  const spec = BANGDREAM_CARD_ART_SPEC.icon;
  const canvas: Canvas = cardIdVisible
    ? new Canvas(spec.width, spec.heightWithId)
    : new Canvas(spec.width, spec.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    await card.getCardIconImage(illustrationTrainingStatus),
    0,
    0,
    spec.width,
    spec.height,
  );
  //如果显示卡牌ID，画面高度为210，在下方显示
  if (cardIdVisible) {
    ctx.textAlign = 'start';
    ctx.textBaseline = 'middle';
    setFontStyle(ctx, spec.cardId.fontSize, BANGDREAM_RENDER_THEME.font.body);
    ctx.fillStyle = BANGDREAM_RENDER_THEME.color.mutedText;
    ctx.fillText(`ID:${card.cardId}`, spec.cardId.x, spec.cardId.y);
  }
  //如果显示技能类型，在右上显示
  if (skillLevel != undefined) {
    ctx.fillStyle = BANGDREAM_RENDER_THEME.color.skillLevelBackground;
    ctx.fillRect(
      spec.skillLevel.x,
      spec.skillLevel.y,
      spec.skillLevel.width,
      spec.skillLevel.height,
    );
    ctx.fillStyle = BANGDREAM_RENDER_THEME.color.surface;
    ctx.textAlign = 'center';
    setFontStyle(
      ctx,
      spec.skillLevel.fontSize,
      BANGDREAM_RENDER_THEME.font.body,
    );
    ctx.fillText(
      skillLevel.toString(),
      spec.skillLevel.textX,
      spec.skillLevel.textY,
    );
  }
  //如果显示技能类型，在右上显示
  else if (cardTypeVisible) {
    if (cardTypeIconList[card.type] != undefined) {
      ctx.drawImage(
        cardTypeIconList[card.type],
        spec.cardType.x,
        spec.cardType.y,
      );
    }
  }
  if (skillTypeVisible) {
    const skill = new Skill(card.skillId);
    const skillTypeIcon = await drawCardIconSkill(skill);
    ctx.drawImage(
      skillTypeIcon,
      spec.width - skillTypeIcon.width,
      spec.skillIconY,
    );
  }
  //获得框
  const frame = await getCardIconFrame(card.rarity, card.attribute);
  ctx.drawImage(frame, 0, 0);
  const attributeIcon = await new Attribute(card.attribute).getIcon();
  ctx.drawImage(
    attributeIcon,
    spec.attribute.x,
    spec.attribute.y,
    spec.attribute.width,
    spec.attribute.height,
  );
  const bandIcon = await new Band(card.bandId).getIcon();
  ctx.drawImage(
    bandIcon,
    spec.band.x,
    spec.band.y,
    spec.band.width,
    spec.band.height,
  );
  if (limitBreakRank != 0) {
    ctx.drawImage(
      limitBreakIcon,
      spec.limitBreak.x,
      spec.limitBreak.y,
      spec.limitBreak.width,
      spec.limitBreak.height,
    );
    setFontStyle(
      ctx,
      spec.limitBreak.fontSize,
      BANGDREAM_RENDER_THEME.font.body,
    );
    ctx.fillStyle = BANGDREAM_RENDER_THEME.color.surface;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      limitBreakRank.toString(),
      spec.limitBreak.textX,
      spec.limitBreak.textY,
    );
  }
  const star = starList[trainingStatus ? 'trained' : 'normal'];
  for (let i = 0; i < card.rarity; i++) {
    //星星数量
    ctx.drawImage(
      star,
      spec.star.x,
      spec.star.startY - spec.star.stepY * i,
      spec.star.width,
      spec.star.height,
    );
  }
  return canvas;
}

interface DrawCardIllustrationOptions {
  card: Card;
  trainingStatus: boolean;
  isList?: boolean;
}
//画卡插画
/**
 * 在图片布局层中绘制卡牌Illustration。
 *
 * @param options1 - options1参数。
 * @returns 异步处理结果。
 */
export async function drawCardIllustration({
  card,
  trainingStatus,
  isList = false,
}: DrawCardIllustrationOptions): Promise<Canvas> {
  trainingStatus = card.ableToTraining(trainingStatus);
  const spec = BANGDREAM_CARD_ART_SPEC.illustration;
  const cardIllustrationImage =
    await card.getCardIllustrationImage(trainingStatus);
  const canvas = new Canvas(spec.width, spec.height);
  const ctx = canvas.getContext('2d');
  //将cardIllustration等比例缩放至宽度为1334
  const scale = spec.innerWidth / cardIllustrationImage.width;
  const illustrationCanvas = new Canvas(spec.innerWidth, spec.innerHeight);
  const illustrationCtx = illustrationCanvas.getContext('2d');
  const illustrationHeight = cardIllustrationImage.height * scale;
  illustrationCtx.drawImage(
    cardIllustrationImage,
    0,
    spec.innerHeight / 2 - illustrationHeight / 2,
    spec.innerWidth,
    illustrationHeight,
  );
  ctx.drawImage(illustrationCanvas, spec.innerX, spec.innerY);
  //获得框
  const frame = await getCardIllustrationFrame(card.rarity, card.attribute);
  ctx.drawImage(frame, 0, 0, spec.width, spec.height);
  const attributeIcon = await new Attribute(card.attribute).getIcon();
  ctx.drawImage(
    attributeIcon,
    spec.attribute.x,
    spec.attribute.y,
    spec.attribute.width,
    spec.attribute.height,
  );
  const bandIcon = await new Band(card.bandId).getIcon();
  ctx.drawImage(
    bandIcon,
    spec.band.x,
    spec.band.y,
    spec.band.width,
    spec.band.height,
  );

  const star = starList[trainingStatus ? 'trained' : 'normal'];
  for (let i = 0; i < card.rarity; i++) {
    //星星数量
    ctx.drawImage(
      star,
      spec.star.x,
      spec.star.startY - spec.star.stepY * i,
      spec.star.width,
      spec.star.height,
    );
  }
  if (isList) {
    //等比例缩放到宽度为widthMax
    const scale = spec.listWidth / spec.width;
    const tempCanvas = new Canvas(spec.listWidth, spec.height * scale);
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, spec.listWidth, spec.height * scale);
    return tempCanvas;
  } else {
    return canvas;
  }
}
