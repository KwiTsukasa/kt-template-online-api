import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/theme/render-theme';

export interface CardPrefixBandLogoSource {
  height: number;
  width: number;
}

export const BANGDREAM_CARD_PREFIX_SPEC = {
  background: {
    color: '#f1f1ef',
    radius: [15, 15, 0, 0],
  },
  bandLogo: {
    width: 240,
    x: 30,
    y: 25,
  },
  canvas: {
    height: 155,
    width: 800,
  },
  text: {
    align: 'left',
    baseline: 'hanging',
    characterName: {
      fontSize: 40,
      maxWidth: 470,
      x: 300,
      y: 75,
    },
    color: BANGDREAM_RENDER_THEME.color.labelBackground,
    font: BANGDREAM_RENDER_THEME.font.body,
    prefix: {
      fontSize: 30,
      maxWidth: 470,
      x: 300,
      y: 35,
    },
  },
} as const;

/**
 * 计算卡牌标题块乐队 Logo 的等比缩放布局。
 *
 * @param source - 原始 Logo 尺寸。
 */
export function getCardPrefixBandLogoLayout(source: CardPrefixBandLogoSource) {
  const { width, x, y } = BANGDREAM_CARD_PREFIX_SPEC.bandLogo;

  return {
    height: (source.height * width) / source.width,
    width,
    x,
    y,
  };
}
