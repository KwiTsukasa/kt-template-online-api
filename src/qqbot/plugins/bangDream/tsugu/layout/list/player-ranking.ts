import { Canvas, loadImage } from 'skia-canvas';

import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { drawCardIcon } from '@/qqbot/plugins/bangDream/tsugu/layout/card';
import { drawDegree } from '@/qqbot/plugins/bangDream/tsugu/layout/degree';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { Degree } from '@/qqbot/plugins/bangDream/tsugu/domain/degree';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/graphics/text';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import { bestdoriUrl } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';

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

export async function drawPlayerRankingInList(
  user: User,
  backgroudColor: string = 'white',
  server: Server,
): Promise<Canvas> {
  const canvas = new Canvas(800, 110);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = backgroudColor;
  ctx.fillRect(0, 0, 800, 110);

  function removeBraces(text: string): string {
    const newText = text.replace(/\[[^\]]*\]/g, '');
    return newText;
  }

  //排名
  let rankingImage;
  if (user.ranking == undefined) {
    return;
  } else if (user.ranking > 0 && user.ranking <= 3) {
    const rankIamgeBuffer = await downloadFileCache(
      `${bestdoriUrl}/res/image/${Server[server]}_${user.ranking}.png`,
    );
    rankingImage = await loadImage(rankIamgeBuffer);
    ctx.drawImage(rankingImage, 12, 45, 45, 21);
  } else {
    rankingImage = drawText({
      text: '#' + user.ranking.toString(),
      textSize: 21,
      maxWidth: 100,
    });
    ctx.drawImage(rankingImage, 12, 45);
  }

  //头像
  const headShotImage = await drawCardIcon({
    card: new Card(user.sid),
    trainingStatus: user.strained == 0 ? false : true,
    cardIdVisible: false,
    skillTypeVisible: false,
    cardTypeVisible: false,
  });
  ctx.drawImage(headShotImage, 85, 10, 90, 90);

  //玩家昵称
  const playerNameImage = drawText({
    text: removeBraces(user.name),
    textSize: 23,
    maxWidth: 450,
  });
  ctx.drawImage(playerNameImage, 210, 10);

  //牌子
  for (let i = 0; i < user.degrees.length; i++) {
    const degreeImage = await drawDegree(new Degree(user.degrees[i]), server);
    ctx.drawImage(
      degreeImage,
      210 + (degreeImage.width / 2 + 10) * i,
      46,
      degreeImage.width / 2,
      degreeImage.height / 2,
    );
  }

  //简介
  const playerIntroductionImage = drawText({
    text: removeBraces(user.introduction),
    textSize: 20,
    maxWidth: 450,
  });
  ctx.drawImage(playerIntroductionImage, 210, 75);

  //等级
  const playerRankImage = drawText({
    text: '等级 ' + user.rank.toString(),
    textSize: 23,
    maxWidth: 150,
  });
  ctx.drawImage(playerRankImage, 790 - playerRankImage.width, 10);

  //id
  const idImage = drawText({
    text: '#' + user.uid,
    textSize: 20,
    maxWidth: 150,
  });
  ctx.drawImage(idImage, 790 - idImage.width, 45);

  //pt
  const ptImage = drawText({
    text: user.currentPt.toString() + '分',
    textSize: 23,
    maxWidth: 150,
  });
  ctx.drawImage(ptImage, 790 - ptImage.width, 70);

  return canvas;
}
