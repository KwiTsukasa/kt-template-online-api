import { Player } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player.model';
import { Canvas, Image, loadImage } from 'skia-canvas';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { resizeImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { Band } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/band.model';
import { drawTextWithImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { starList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-rarity.renderer';
import bangdreamCatalogCache from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import {
  BANGDREAM_DECK_TOTAL_RATING_ID,
  BANGDREAM_STAGE_CHALLENGE_BAND_ID,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import { deckRankResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/player/deck-rank.repository';
import {
  createBandDetailItemLayout,
  createBandDetailListFrameSpec,
  createBandDetailLogoSpec,
  createBandDetailTextSpec,
  createDeckRankCanvasSpec,
  createDeckRankImageLayout,
  createDeckRankLevelImageSpec,
  normalizeDeckRankLevelSpriteRankId,
} from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-band-detail.layout';

interface drawBandDetailsInListOptions {
  [bandId: number]: Array<Canvas | Image | string>;
}
//画乐队详情
/**
 * 根据`BandDetailsInListOptions`、`key`绘制或格式化Band详情；把图片、文本或图形按布局规格绘制到画布。
 * @param BandDetailsInListOptions - 控制Band详情筛选、缓存或输出方式的可选项，包含 `i` 字段。
 * @param key - 用于读取或更新Band详情的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns Band详情。
 */
async function drawBandDetailsInList(
  BandDetailsInListOptions: drawBandDetailsInListOptions,
  key?: string,
) {
  const bandAndContentList: Array<Canvas> = [];
  for (const i in BandDetailsInListOptions) {
    const tempBand = new Band(parseInt(i));
    const content = BandDetailsInListOptions[i];
    const tempBandIcon = resizeImage({
      image: await tempBand.getLogo(),
      ...createBandDetailLogoSpec(),
    });
    const textSpec = createBandDetailTextSpec();
    const tempBandRankText = drawTextWithImages({
      content,
      maxWidth: textSpec.maxWidth,
      lineHeight: textSpec.lineHeight,
    });
    const layout = createBandDetailItemLayout(tempBandRankText);
    const canvas = new Canvas(layout.canvasWidth, layout.canvasHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempBandIcon, layout.logoX, layout.logoY);
    ctx.drawImage(tempBandRankText, layout.textX, layout.textY);
    bandAndContentList.push(canvas);
  }
  const frameSpec = createBandDetailListFrameSpec(bandAndContentList?.[0]);
  const bandAndContentListImage = drawList({
    key,
    content: bandAndContentList,
    spacing: frameSpec.spacing,
    lineHeight: frameSpec.lineHeight,
    textSize: frameSpec.textSize,
  });
  return bandAndContentListImage;
}
//画玩家信息内乐队等级
/**
 * 按目录乐队顺序将玩家乐队等级绘制为列表画布，缺失等级显示为问号。
 * @param player - 用于按目录乐队顺序将玩家乐队等级绘制为列表画布，缺失等级显示为问号的领域对象，包含 `profile` 字段。
 * @param key - 用于读取或更新按目录乐队顺序将玩家乐队等级绘制为列表画布，缺失等级显示为问号的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 按目录乐队顺序将玩家乐队等级绘制为列表画布，缺失等级显示为问号。
 */
export async function drawPlayerBandRankInList(
  player: Player,
  key?: string,
): Promise<Canvas> {
  const bandRankMap = player.profile.bandRankMap?.entries;
  const BandDetails = {};
  for (const i in bangdreamCatalogCache['bands']) {
    if (bandRankMap[i] != undefined) {
      BandDetails[i] = [bandRankMap[i].toString()];
    } else {
      BandDetails[i] = ['?'];
    }
  }
  return drawBandDetailsInList(BandDetails, key);
}

//画玩家信息内stage challenge等级
/**
 * 按目录乐队顺序将玩家试炼等级与星标绘制为列表画布，缺失等级按 `0` 处理。
 * @param player - 用于按目录乐队顺序将玩家试炼等级与星标绘制为列表画布，缺失等级按 `0` 处理的领域对象，包含 `profile` 字段。
 * @param key - 用于读取或更新按目录乐队顺序将玩家试炼等级与星标绘制为列表画布，缺失等级按 `0` 处理的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 玩家阶段验证挑战排名。
 */
export async function drawPlayerStageChallengeRankInList(
  player: Player,
  key?: string,
): Promise<Canvas> {
  const stageChallengeAchievementConditionsMap =
    player.profile.stageChallengeAchievementConditionsMap.entries;

  const BandDetails = {};
  for (const band in bangdreamCatalogCache['bands']) {
    const level =
      stageChallengeAchievementConditionsMap?.[
        BANGDREAM_STAGE_CHALLENGE_BAND_ID[band]
      ] || 0;
    BandDetails[band] = [starList.normal, level.toString()];
  }
  return drawBandDetailsInList(BandDetails, key);
}

//画玩家信息内乐队卡组最高等级
const rankImageCache: { [rankImageName: string]: Image } = {};
/**
 * 按`rankImageName`读取排名图片；从受控资源来源加载所需数据（`loadImage`）。
 * @param rankImageName - 决定排名图片内容、边界或目标的 `rankImageName` 值。
 * @returns 排名图片。
 */
async function loadRankImage(rankImageName: string): Promise<Image> {
  if (rankImageCache[rankImageName] == undefined) {
    const rankImageBuffer =
      await deckRankResourceRepository.getRankImageBuffer(rankImageName);
    rankImageCache[rankImageName] = await loadImage(rankImageBuffer);
  }
  return rankImageCache[rankImageName];
}

/**
 * 根据`player`、`key`绘制或格式化玩家DeckTotalRating；把图片、文本或图形按布局规格绘制到画布。
 * @param player - 用于玩家DeckTotalRating的领域对象，包含 `profile` 字段。
 * @param key - 用于读取或更新玩家DeckTotalRating的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 玩家DeckTotalRating。
 */
export async function drawPlayerDeckTotalRatingInList(
  player: Player,
  key?: string,
) {
  const userDeckTotalRatingMap = player.profile.userDeckTotalRatingMap.entries;
  const BandDetails = {};

  for (const i in bangdreamCatalogCache['bands']) {
    if (userDeckTotalRatingMap[i] != undefined) {
      const rankName = userDeckTotalRatingMap[i].rank;
      let rankId = BANGDREAM_DECK_TOTAL_RATING_ID[rankName];
      const rankImage = await loadRankImage(`rank_${rankId}`);
      const canvasSpec = createDeckRankCanvasSpec();
      const canvas = new Canvas(canvasSpec.width, canvasSpec.height);
      const ctx = canvas.getContext('2d');
      const rankLayout = createDeckRankImageLayout(rankImage);
      ctx.drawImage(rankImage, rankLayout.rankX, rankLayout.rankY);
      if (userDeckTotalRatingMap[i].level != 0) {
        rankId = normalizeDeckRankLevelSpriteRankId(rankId);
        const rankLevelImage = resizeImage({
          image: await loadRankImage(
            `rank_${rankId}_${userDeckTotalRatingMap[i].level}`,
          ),
          ...createDeckRankLevelImageSpec(),
        });
        const levelLayout = createDeckRankImageLayout(
          rankImage,
          rankLevelImage,
        );
        ctx.drawImage(rankLevelImage, levelLayout.levelX, levelLayout.levelY);
      }
      BandDetails[i] = [canvas];
    } else {
      BandDetails[i] = ['?'];
    }
  }

  return drawBandDetailsInList(BandDetails, key);
}
