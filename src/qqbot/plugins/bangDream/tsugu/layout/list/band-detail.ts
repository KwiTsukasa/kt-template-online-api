import { Player } from '@/qqbot/plugins/bangDream/tsugu/domain/player';
import { Canvas, Image } from 'skia-canvas';
import { drawList } from '../list';
import { resizeImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/domain/band';
import { drawTextWithImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/text';
import { starList } from './rarity';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import { bestdoriUrl } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { assetsRootPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import * as path from 'path';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/graphics/utils';
import {
  BANGDREAM_DECK_TOTAL_RATING_ID,
  BANGDREAM_STAGE_CHALLENGE_BAND_ID,
} from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';

interface drawBandDetailsInListOptions {
  [bandId: number]: Array<Canvas | Image | string>;
}
//画乐队详情
async function drawBandDetailsInList(
  BandDetailsInListOptions: drawBandDetailsInListOptions,
  key?: string,
) {
  const bandAndContentList: Array<Canvas> = [];
  for (const i in BandDetailsInListOptions) {
    const tempBand = new Band(parseInt(i));
    const content = BandDetailsInListOptions[i];
    const maxWidth = 152;
    const logoWidth = 110;
    const tempBandIcon = resizeImage({
      image: await tempBand.getLogo(),
      widthMax: logoWidth,
    });
    const canvas = new Canvas(maxWidth, 100);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempBandIcon, (maxWidth - logoWidth) / 2, 0);
    const tempBandRankText = drawTextWithImages({
      content,
      maxWidth: maxWidth,
      lineHeight: 40,
    });
    ctx.drawImage(
      tempBandRankText,
      maxWidth / 2 - tempBandRankText.width / 2,
      50,
    );
    bandAndContentList.push(canvas);
  }
  const bandAndContentListImage = drawList({
    key,
    content: bandAndContentList,
    spacing: 0,
    lineHeight: bandAndContentList?.[0].height,
    textSize: bandAndContentList?.[0].height,
  });
  return bandAndContentListImage;
}
//画玩家信息内乐队等级
export async function drawPlayerBandRankInList(
  player: Player,
  key?: string,
): Promise<Canvas> {
  const bandRankMap = player.profile.bandRankMap?.entries;
  const BandDetails = {};
  for (const i in mainAPI['bands']) {
    if (bandRankMap[i] != undefined) {
      BandDetails[i] = [bandRankMap[i].toString()];
    } else {
      BandDetails[i] = ['?'];
    }
  }
  return drawBandDetailsInList(BandDetails, key);
}

//画玩家信息内stage challenge等级
export async function drawPlayerStageChallengeRankInList(
  player: Player,
  key?: string,
): Promise<Canvas> {
  const stageChallengeAchievementConditionsMap =
    player.profile.stageChallengeAchievementConditionsMap.entries;

  const BandDetails = {};
  for (const band in mainAPI['bands']) {
    const level =
      stageChallengeAchievementConditionsMap?.[
        BANGDREAM_STAGE_CHALLENGE_BAND_ID[band]
      ] || 0;
    BandDetails[band] = [starList.normal, level.toString()];
  }
  return drawBandDetailsInList(BandDetails, key);
}

//画玩家信息内乐队卡组最高等级
const rankImage: { [rankImageName: string]: Image } = {};
async function loadRankImage(rankImageName: string): Promise<Image> {
  if (rankImage[rankImageName] == undefined) {
    try {
      rankImage[rankImageName] = await loadImageFromPath(
        path.join(assetsRootPath, `/Rank/${rankImageName}.png`),
      );
    } catch {
      rankImage[rankImageName] = await loadImageFromPath(
        `${bestdoriUrl}/res/icon/${rankImageName}.png`,
      );
    }
  }
  return rankImage[rankImageName];
}

export async function drawPlayerDeckTotalRatingInList(
  player: Player,
  key?: string,
) {
  const userDeckTotalRatingMap = player.profile.userDeckTotalRatingMap.entries;
  const BandDetails = {};

  for (const i in mainAPI['bands']) {
    if (userDeckTotalRatingMap[i] != undefined) {
      const rankName = userDeckTotalRatingMap[i].rank;
      let rankId = BANGDREAM_DECK_TOTAL_RATING_ID[rankName];
      const rankImage = await loadRankImage(`rank_${rankId}`);
      const widthMax = 150,
        heightMax = 100;
      const canvas = new Canvas(widthMax, heightMax);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(rankImage, (widthMax - rankImage.width) / 2, 0);
      if (userDeckTotalRatingMap[i].level != 0) {
        //ss与s字体相同
        if (rankId > 4) {
          rankId = 4;
        }
        const rankLevelImage = resizeImage({
          image: await loadRankImage(
            `rank_${rankId}_${userDeckTotalRatingMap[i].level}`,
          ),
          heightMax: 50,
        });
        ctx.drawImage(
          rankLevelImage,
          (widthMax + rankImage.width) / 2 + 2 - rankLevelImage.width,
          45,
        );
      }
      BandDetails[i] = [canvas];
    } else {
      BandDetails[i] = ['?'];
    }
  }

  return drawBandDetailsInList(BandDetails, key);
}
