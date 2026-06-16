import { Canvas, Image } from 'skia-canvas';
import { createOutputFinalImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawPlayerDetailBlockWithIllustration } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.renderer';
import {
  assetsRootPath,
  serverNameFullList,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import * as path from 'path';
import { drawPlayerCardInList } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-card-icon.renderer';
import {
  line,
  drawList,
} from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { drawStatInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-stat.renderer';
import { drawDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import {
  drawPlayerBandRankInList,
  drawPlayerStageChallengeRankInList,
  drawPlayerDeckTotalRatingInList,
} from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-band-detail.renderer';
import { drawPlayerDifficultyDetailInList } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-difficulty-detail.renderer';
import { drawCharacterRankInList } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-character-detail.renderer';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { playerRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player.repository';

let BGDefaultImage: Image;
let playerAssetsPreload: Promise<void> | undefined;

export async function preloadBangDreamPlayerAssets() {
  if (!playerAssetsPreload) {
    playerAssetsPreload = loadImageFromPath(
      path.join(assetsRootPath, '/BG/common.png'),
    )
      .then((image) => {
        BGDefaultImage = image;
      })
      .catch((error) => {
        playerAssetsPreload = undefined;
        throw error;
      });
  }
  await playerAssetsPreload;
}

/**
 * 在QQBot 图片视图层中绘制玩家详情。
 *
 * @param playerId - 玩家ID参数。
 * @param mainServer - 主数据服务器参数。
 * @param useEasyBG - use简易背景参数。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawPlayerDetail(
  playerId: number,
  mainServer: Server,
  useEasyBG: boolean,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  await preloadBangDreamPlayerAssets();
  const result = [];
  let player = playerRepository.create(playerId, mainServer);
  //不使用缓存查询
  await player.initFull(false, 3);
  if (player.initError) {
    result.push(`错误: 查询玩家时发生错误: ${playerId}, 正在使用可用缓存`);
    //使用缓存查询，如果失败则返回失败
    player = playerRepository.create(playerId, mainServer);
    await player.initFull(false, 0);
    if (player.initError || !player.isExist) {
      return [`错误: 查询玩家时发生错误: ${playerId}`];
    }
  }

  //检查玩家信息是否存在
  if (!player.isExist) {
    return [
      `错误: 该服务器 (${serverNameFullList[mainServer]}) 不存在该玩家ID: ${playerId}`,
    ];
  }

  const list: Array<Canvas | Image> = [];
  //卡组
  list.push(await drawPlayerCardInList(player, '卡牌信息', true));
  list.push(line);
  //综合力
  if (player.profile.publishTotalDeckPowerFlg) {
    const stat = await player.calcStat();
    list.push(await drawStatInList(stat));
    list.push(line);
  }

  //难度完成信息
  if (player.profile.publishMusicClearedFlg) {
    list.push(
      drawPlayerDifficultyDetailInList(
        player,
        'clearedMusicCount',
        '完成歌曲数',
      ),
    );
    list.push(line);
  }
  if (player.profile.publishMusicFullComboFlg) {
    list.push(
      drawPlayerDifficultyDetailInList(
        player,
        'fullComboMusicCount',
        'FullCombo 歌曲数',
      ),
    );
    list.push(line);
  }
  if (player.profile.publishMusicAllPerfectFlg) {
    list.push(
      drawPlayerDifficultyDetailInList(
        player,
        'allPerfectMusicCount',
        'AllPerfect 歌曲数',
      ),
    );
    list.push(line);
  }
  //乐队等级
  if (player.profile.publishBandRankFlg) {
    list.push(await drawPlayerBandRankInList(player, '乐队等级'));
    list.push(line);
  }
  //stageChallenge完成情况
  if (
    player.profile.publishStageChallengeAchievementConditionsFlg &&
    player.profile.publishStageChallengeFriendRankingFlg
  ) {
    list.push(
      await drawPlayerStageChallengeRankInList(player, '舞台挑战 达成情况'),
    );
    list.push(line);
  }
  //乐队编成等级
  if (player.profile.publishDeckRankFlg) {
    list.push(await drawPlayerDeckTotalRatingInList(player, '乐队编成等级'));
    list.push(line);
  }
  //hsr
  if (player.profile.publishHighScoreRatingFlg) {
    list.push(
      drawList({
        key: 'High Score Rating',
        text: player.calcHSR().toString(),
      }),
    );
    list.push(line);
  }
  //角色等级
  if (player.profile.publishCharacterRankFlg) {
    list.push(await drawCharacterRankInList(player, '角色等级'));
    list.push(line);
  }

  list.pop();
  const all: Array<Canvas | Image> = [];
  //玩家信息 顶部
  all.push(await drawPlayerDetailBlockWithIllustration(player));
  const listImage = drawDataBlock({ list });
  all.push(listImage);
  const [buffer] = await createOutputFinalImages({
    useEasyBG,
    text: ' ',
    BGimage: BGDefaultImage,
    compress,
  })(all);
  result.push(buffer);
  return result;
}
