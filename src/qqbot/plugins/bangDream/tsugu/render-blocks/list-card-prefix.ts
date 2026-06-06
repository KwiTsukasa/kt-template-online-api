import { Card } from '@/qqbot/plugins/bangDream/tsugu/models/card';
import { Canvas } from 'skia-canvas';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/models/band';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/models/character';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { setFontStyle } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { drawRoundedRect } from '@/qqbot/plugins/bangDream/tsugu/canvas/rect';

let prefixBG: Canvas;
/**
 * 在图片布局层中加载图片Once。
 */
async function loadImageOnce() {
  prefixBG = drawRoundedRect({
    width: 800,
    height: 155,
    color: '#f1f1ef',
    radius: [15, 15, 0, 0],
  });
}
loadImageOnce();

/**
 * 在图片布局层中绘制卡牌PrefixIn列表。
 *
 * @param card - 卡牌参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 */
export async function drawCardPrefixInList(
  card: Card,
  displayedServerList: Server[] = globalDefaultServer,
) {
  const canvas = new Canvas(800, 155);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(prefixBG, 0, 0);

  //bandLogo
  const band = new Band(card.bandId);
  const bandLogo = await band.getLogo();
  ctx.drawImage(
    bandLogo,
    30,
    25,
    240,
    (bandLogo.height * 240) / bandLogo.width,
  );

  //prefix
  const server = getServerByPriority(card.releasedAt, displayedServerList);
  ctx.fillStyle = '#5b5b5b';
  ctx.textBaseline = 'hanging';
  ctx.textAlign = 'left';
  setFontStyle(ctx, 30, 'old');
  ctx.fillText(card.prefix[server], 300, 35, 470);

  //characterName
  const character = new Character(card.characterId);
  const tempserver = getServerByPriority(
    character.characterName,
    displayedServerList,
  );
  const characterName = character.characterName[tempserver];
  setFontStyle(ctx, 40, 'old');
  ctx.fillText(characterName, 300, 75, 470);

  return canvas;
}
