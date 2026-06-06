import {
  BANGDREAM_CARD_PREFIX_SPEC,
  getCardPrefixBandLogoLayout,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-card-prefix-spec';
import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/theme';

describe('BangDream card prefix spec', () => {
  it('keeps the card prefix canvas and background stable', () => {
    expect(BANGDREAM_CARD_PREFIX_SPEC.canvas).toEqual({
      height: 155,
      width: 800,
    });
    expect(BANGDREAM_CARD_PREFIX_SPEC.background).toEqual({
      color: '#f1f1ef',
      radius: [15, 15, 0, 0],
    });
  });

  it('keeps the historical prefix and character text layout', () => {
    expect(BANGDREAM_CARD_PREFIX_SPEC.text.color).toBe(
      BANGDREAM_RENDER_THEME.color.labelBackground,
    );
    expect(BANGDREAM_CARD_PREFIX_SPEC.text.prefix).toEqual({
      fontSize: 30,
      maxWidth: 470,
      x: 300,
      y: 35,
    });
    expect(BANGDREAM_CARD_PREFIX_SPEC.text.characterName).toEqual({
      fontSize: 40,
      maxWidth: 470,
      x: 300,
      y: 75,
    });
  });

  it('scales the band logo by the fixed display width', () => {
    expect(getCardPrefixBandLogoLayout({ height: 120, width: 360 })).toEqual({
      height: 80,
      width: 240,
      x: 30,
      y: 25,
    });
  });
});
