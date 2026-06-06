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
import {
  BANGDREAM_CARD_PREFIX_SPEC,
  getCardPrefixBandLogoLayout,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-card-prefix-spec';

let prefixBG: Canvas;
/**
 * 在图片布局层中加载图片Once。
 */
async function loadImageOnce() {
  prefixBG = drawRoundedRect({
    width: BANGDREAM_CARD_PREFIX_SPEC.canvas.width,
    height: BANGDREAM_CARD_PREFIX_SPEC.canvas.height,
    color: BANGDREAM_CARD_PREFIX_SPEC.background.color,
    radius: [...BANGDREAM_CARD_PREFIX_SPEC.background.radius],
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
  const canvas = new Canvas(
    BANGDREAM_CARD_PREFIX_SPEC.canvas.width,
    BANGDREAM_CARD_PREFIX_SPEC.canvas.height,
  );
  const ctx = canvas.getContext('2d');
  ctx.drawImage(prefixBG, 0, 0);

  const band = new Band(card.bandId);
  const bandLogo = await band.getLogo();
  const bandLogoLayout = getCardPrefixBandLogoLayout(bandLogo);
  ctx.drawImage(
    bandLogo,
    bandLogoLayout.x,
    bandLogoLayout.y,
    bandLogoLayout.width,
    bandLogoLayout.height,
  );

  const server = getServerByPriority(card.releasedAt, displayedServerList);
  ctx.fillStyle = BANGDREAM_CARD_PREFIX_SPEC.text.color;
  ctx.textBaseline = BANGDREAM_CARD_PREFIX_SPEC.text.baseline;
  ctx.textAlign = BANGDREAM_CARD_PREFIX_SPEC.text.align;
  setFontStyle(
    ctx,
    BANGDREAM_CARD_PREFIX_SPEC.text.prefix.fontSize,
    BANGDREAM_CARD_PREFIX_SPEC.text.font,
  );
  ctx.fillText(
    card.prefix[server],
    BANGDREAM_CARD_PREFIX_SPEC.text.prefix.x,
    BANGDREAM_CARD_PREFIX_SPEC.text.prefix.y,
    BANGDREAM_CARD_PREFIX_SPEC.text.prefix.maxWidth,
  );

  const character = new Character(card.characterId);
  const tempserver = getServerByPriority(
    character.characterName,
    displayedServerList,
  );
  const characterName = character.characterName[tempserver];
  setFontStyle(
    ctx,
    BANGDREAM_CARD_PREFIX_SPEC.text.characterName.fontSize,
    BANGDREAM_CARD_PREFIX_SPEC.text.font,
  );
  ctx.fillText(
    characterName,
    BANGDREAM_CARD_PREFIX_SPEC.text.characterName.x,
    BANGDREAM_CARD_PREFIX_SPEC.text.characterName.y,
    BANGDREAM_CARD_PREFIX_SPEC.text.characterName.maxWidth,
  );

  return canvas;
}
