import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { Canvas } from 'skia-canvas';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { Band } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/band.model';
import { Character } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character.model';
import {
  Server,
  getServerByPriority,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { setFontStyle } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { drawRoundedRect } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-rect';
import {
  BANGDREAM_CARD_PREFIX_SPEC,
  getCardPrefixBandLogoLayout,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-prefix.layout';

const prefixBG: Canvas = drawRoundedRect({
  width: BANGDREAM_CARD_PREFIX_SPEC.canvas.width,
  height: BANGDREAM_CARD_PREFIX_SPEC.canvas.height,
  color: BANGDREAM_CARD_PREFIX_SPEC.background.color,
  radius: [...BANGDREAM_CARD_PREFIX_SPEC.background.radius],
});

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
