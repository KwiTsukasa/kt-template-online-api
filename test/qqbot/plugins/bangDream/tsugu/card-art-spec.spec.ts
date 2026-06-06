import {
  BANGDREAM_CARD_ART_SPEC,
  createCardIconFrameUrl,
  createCardIllustrationFrameUrl,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/card-art-spec';

describe('BangDream card art spec', () => {
  it('creates icon frame urls with Bestdori rarity rules', () => {
    const baseUrl = 'https://bestdori.com';

    expect(createCardIconFrameUrl(baseUrl, 1, 'cool')).toBe(
      'https://bestdori.com/res/image/card-1-cool.png',
    );
    expect(createCardIconFrameUrl(baseUrl, 5, 'happy')).toBe(
      'https://bestdori.com/res/image/card-5.png',
    );
  });

  it('creates illustration frame urls with Bestdori rarity rules', () => {
    const baseUrl = 'https://bestdori.com';

    expect(createCardIllustrationFrameUrl(baseUrl, 1, 'pure')).toBe(
      'https://bestdori.com/res/image/frame-1-pure.png',
    );
    expect(createCardIllustrationFrameUrl(baseUrl, 4, 'powerful')).toBe(
      'https://bestdori.com/res/image/frame-4.png',
    );
  });

  it('keeps icon and illustration dimensions stable', () => {
    expect(BANGDREAM_CARD_ART_SPEC.icon.width).toBe(180);
    expect(BANGDREAM_CARD_ART_SPEC.icon.heightWithId).toBe(210);
    expect(BANGDREAM_CARD_ART_SPEC.illustration.width).toBe(1360);
    expect(BANGDREAM_CARD_ART_SPEC.illustration.innerWidth).toBe(1334);
    expect(BANGDREAM_CARD_ART_SPEC.illustration.listWidth).toBe(800);
  });
});
