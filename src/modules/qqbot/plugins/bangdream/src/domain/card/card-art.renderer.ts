import { setFontStyle } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { Band } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/band.model';
import { Attribute } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/attribute.model';
import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { Image, Canvas, loadImage } from 'skia-canvas';
import { drawCardIconSkill } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-skill-text.renderer';
import { Skill } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/skill.model';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';
import {
  BANGDREAM_CARD_ART_SPEC,
  BangDreamCardArtAttribute,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.layout';
import { cardArtResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.repository';

const cardTypeIconList: { [type: string]: Image } = {};
const starList: { [type: string]: Image } = {};
let limitBreakIcon: Image;
let cardArtAssetsPreload: Promise<void> | undefined;

/**
 * 执行 BangDream 插件流程。
 */
export async function preloadBangDreamCardArtAssets() {
  if (!cardArtAssetsPreload) {
    cardArtAssetsPreload = Promise.all([
      loadImageFromPath(getBangDreamAssetPath('cardLimited')),
      loadImageFromPath(getBangDreamAssetPath('cardDreamfes')),
      loadImageFromPath(getBangDreamAssetPath('cardKirafes')),
      loadImageFromPath(getBangDreamAssetPath('cardBirthday')),
      loadImageFromPath(getBangDreamAssetPath('cardStar')),
      loadImageFromPath(getBangDreamAssetPath('cardStarTrained')),
      loadImageFromPath(getBangDreamAssetPath('cardLimitBreakRank')),
    ])
      .then(
        ([
          limited,
          dreamfes,
          kirafes,
          birthday,
          normalStar,
          trainedStar,
          limitBreak,
        ]) => {
          cardTypeIconList.limited = limited;
          cardTypeIconList.dreamfes = dreamfes;
          cardTypeIconList.kirafes = kirafes;
          cardTypeIconList.birthday = birthday;
          starList.normal = normalStar;
          starList.trained = trainedStar;
          limitBreakIcon = limitBreak;
        },
      )
      .catch((error) => {
        cardArtAssetsPreload = undefined;
        throw error;
      });
  }
  await cardArtAssetsPreload;
}

//根据稀有度与属性，获得图标框
/**
 * 在图片布局层中获取卡牌图标Frame。
 *
 * @param rarity - rarity 输入；驱动 `cardArtResourceRepository.getIconFrameBuffer()` 的 BangDream步骤。
 * @param attribute - attribute 输入；驱动 `cardArtResourceRepository.getIconFrameBuffer()` 的 BangDream步骤。
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
 * @param rarity - rarity 输入；驱动 `cardArtResourceRepository.getIllustrationFrameBuffer()` 的 BangDream步骤。
 * @param attribute - attribute 输入；驱动 `cardArtResourceRepository.getIllustrationFrameBuffer()` 的 BangDream步骤。
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
 * @param options1 - options1 输入；影响 drawCardIcon 的返回值。
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
  await preloadBangDreamCardArtAssets();
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
 * @param options1 - options1 输入；影响 drawCardIllustration 的返回值。
 * @returns 异步处理结果。
 */
export async function drawCardIllustration({
  card,
  trainingStatus,
  isList = false,
}: DrawCardIllustrationOptions): Promise<Canvas> {
  await preloadBangDreamCardArtAssets();
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
