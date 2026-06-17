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
 * 在图片布局层中绘制乐队详情列表In列表。
 *
 * @param BandDetailsInListOptions - BangDream列表；驱动 `for()` 的 BangDream步骤。
 * @param key - 键名；影响 drawBandDetailsInList 的返回值。
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
 * 在图片布局层中绘制玩家乐队RankIn列表。
 *
 * @param player - player 输入；使用 `profile` 字段生成结果。
 * @param key - 键名；驱动 `drawBandDetailsInList()` 的 BangDream步骤。
 * @returns 异步处理结果。
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
 * 在图片布局层中绘制玩家试炼ChallengeRankIn列表。
 *
 * @param player - player 输入；使用 `profile` 字段生成结果。
 * @param key - 键名；驱动 `drawBandDetailsInList()` 的 BangDream步骤。
 * @returns 异步处理结果。
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
 * 在图片布局层中加载Rank图片。
 *
 * @param rankImageName - rankImageName 输入；驱动 `deckRankResourceRepository.getRankImageBuffer()` 的 BangDream步骤。
 * @returns 异步处理结果。
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
 * 在图片布局层中绘制玩家DeckTotalRatingIn列表。
 *
 * @param player - player 输入；使用 `profile` 字段生成结果。
 * @param key - 键名；驱动 `drawBandDetailsInList()` 的 BangDream步骤。
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
