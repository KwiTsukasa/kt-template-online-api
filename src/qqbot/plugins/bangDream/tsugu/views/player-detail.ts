import { Canvas, Image } from 'skia-canvas';
import { createOutputFinalImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { Player } from '@/qqbot/plugins/bangDream/tsugu/domain/player';
import { drawPlayerDetailBlockWithIllustration } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import {
  assetsRootPath,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import * as path from 'path';
import { drawPlayerCardInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/player-card-icon-list';
import { line, drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { drawStatInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/stat';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import {
  drawPlayerBandRankInList,
  drawPlayerStageChallengeRankInList,
  drawPlayerDeckTotalRatingInList,
} from '@/qqbot/plugins/bangDream/tsugu/layout/list/band-detail';
import { drawPlayerDifficultyDetailInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/difficulty-detail';
import { drawCharacterRankInList } from '@/qqbot/plugins/bangDream/tsugu/layout/list/character-detail';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/graphics/utils';

let BGDefaultImage: Image;
async function loadImageOnce() {
  BGDefaultImage = await loadImageFromPath(
    path.join(assetsRootPath, '/BG/common.png'),
  );
}
loadImageOnce();

export async function drawPlayerDetail(
  playerId: number,
  mainServer: Server,
  useEasyBG: boolean,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const result = [];
  let player = new Player(playerId, mainServer);
  //不使用缓存查询
  await player.initFull(false, 3);
  if (player.initError) {
    result.push(`错误: 查询玩家时发生错误: ${playerId}, 正在使用可用缓存`);
    //使用缓存查询，如果失败则返回失败
    player = new Player(playerId, mainServer);
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
