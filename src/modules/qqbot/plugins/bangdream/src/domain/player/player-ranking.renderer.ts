import { Canvas, loadImage } from 'skia-canvas';

import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { drawCardIcon } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.renderer';
import { drawDegree } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/degree-badge.renderer';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { Degree } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/degree.model';
import { drawText } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { playerRankingResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-ranking.repository';
import {
  BANGDREAM_PLAYER_RANKING_SPEC,
  createRankingDegreeLayout,
  isMedalRanking,
  stripPlayerRankingTextTags,
} from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-ranking.layout';

interface User {
  uid: number;
  name: string;
  introduction: string;
  rank: number;
  sid: number;
  strained: number;
  degrees: number[];
  ranking: number;
  currentPt: number;
}

/**
 * 在图片布局层中绘制玩家RankingIn列表。
 *
 * @param user - user 输入；使用 `ranking`、`sid`、`strained`、`name` 字段生成结果。
 * @param backgroudColor - backgroudColor 输入；影响 drawPlayerRankingInList 的返回值。
 * @param server - server 输入；驱动 `playerRankingResourceRepository.getRankImageBuffer()`、`drawDegree()` 的 BangDream步骤。
 * @returns 异步处理结果。
 */
export async function drawPlayerRankingInList(
  user: User,
  backgroudColor: string = BANGDREAM_PLAYER_RANKING_SPEC.backgroundColor,
  server: Server,
): Promise<Canvas> {
  const canvas = new Canvas(
    BANGDREAM_PLAYER_RANKING_SPEC.canvas.width,
    BANGDREAM_PLAYER_RANKING_SPEC.canvas.height,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = backgroudColor;
  ctx.fillRect(
    0,
    0,
    BANGDREAM_PLAYER_RANKING_SPEC.canvas.width,
    BANGDREAM_PLAYER_RANKING_SPEC.canvas.height,
  );

  //排名
  let rankingImage;
  if (user.ranking == undefined) {
    return;
  } else if (isMedalRanking(user.ranking)) {
    const rankIamgeBuffer =
      await playerRankingResourceRepository.getRankImageBuffer(
        server,
        user.ranking,
      );
    rankingImage = await loadImage(rankIamgeBuffer);
    ctx.drawImage(
      rankingImage,
      BANGDREAM_PLAYER_RANKING_SPEC.ranking.x,
      BANGDREAM_PLAYER_RANKING_SPEC.ranking.y,
      BANGDREAM_PLAYER_RANKING_SPEC.ranking.imageWidth,
      BANGDREAM_PLAYER_RANKING_SPEC.ranking.imageHeight,
    );
  } else {
    rankingImage = drawText({
      text: '#' + user.ranking.toString(),
      textSize: BANGDREAM_PLAYER_RANKING_SPEC.ranking.textSize,
      maxWidth: BANGDREAM_PLAYER_RANKING_SPEC.ranking.fallbackMaxWidth,
    });
    ctx.drawImage(
      rankingImage,
      BANGDREAM_PLAYER_RANKING_SPEC.ranking.x,
      BANGDREAM_PLAYER_RANKING_SPEC.ranking.y,
    );
  }

  //头像
  const headShotImage = await drawCardIcon({
    card: new Card(user.sid),
    trainingStatus: user.strained == 0 ? false : true,
    cardIdVisible: false,
    skillTypeVisible: false,
    cardTypeVisible: false,
  });
  ctx.drawImage(
    headShotImage,
    BANGDREAM_PLAYER_RANKING_SPEC.headShot.x,
    BANGDREAM_PLAYER_RANKING_SPEC.headShot.y,
    BANGDREAM_PLAYER_RANKING_SPEC.headShot.width,
    BANGDREAM_PLAYER_RANKING_SPEC.headShot.height,
  );

  //玩家昵称
  const playerNameImage = drawText({
    text: stripPlayerRankingTextTags(user.name),
    textSize: BANGDREAM_PLAYER_RANKING_SPEC.text.nameSize,
    maxWidth: BANGDREAM_PLAYER_RANKING_SPEC.text.nameMaxWidth,
  });
  ctx.drawImage(
    playerNameImage,
    BANGDREAM_PLAYER_RANKING_SPEC.text.nameX,
    BANGDREAM_PLAYER_RANKING_SPEC.text.nameY,
  );

  //牌子
  for (let i = 0; i < user.degrees.length; i++) {
    const degreeImage = await drawDegree(new Degree(user.degrees[i]), server);
    const degreeLayout = createRankingDegreeLayout({
      height: degreeImage.height,
      index: i,
      width: degreeImage.width,
    });
    ctx.drawImage(
      degreeImage,
      degreeLayout.x,
      degreeLayout.y,
      degreeLayout.width,
      degreeLayout.height,
    );
  }

  //简介
  const playerIntroductionImage = drawText({
    text: stripPlayerRankingTextTags(user.introduction),
    textSize: BANGDREAM_PLAYER_RANKING_SPEC.text.introductionSize,
    maxWidth: BANGDREAM_PLAYER_RANKING_SPEC.text.introductionMaxWidth,
  });
  ctx.drawImage(
    playerIntroductionImage,
    BANGDREAM_PLAYER_RANKING_SPEC.text.introductionX,
    BANGDREAM_PLAYER_RANKING_SPEC.text.introductionY,
  );

  //等级
  const playerRankImage = drawText({
    text: '等级 ' + user.rank.toString(),
    textSize: BANGDREAM_PLAYER_RANKING_SPEC.text.rankSize,
    maxWidth: BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.maxWidth,
  });
  ctx.drawImage(
    playerRankImage,
    BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.edgeX - playerRankImage.width,
    BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.rankY,
  );

  //id
  const idImage = drawText({
    text: '#' + user.uid,
    textSize: BANGDREAM_PLAYER_RANKING_SPEC.text.idSize,
    maxWidth: BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.maxWidth,
  });
  ctx.drawImage(
    idImage,
    BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.edgeX - idImage.width,
    BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.idY,
  );

  //pt
  const ptImage = drawText({
    text: user.currentPt.toString() + '分',
    textSize: BANGDREAM_PLAYER_RANKING_SPEC.text.pointSize,
    maxWidth: BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.maxWidth,
  });
  ctx.drawImage(
    ptImage,
    BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.edgeX - ptImage.width,
    BANGDREAM_PLAYER_RANKING_SPEC.rightColumn.pointY,
  );

  return canvas;
}
