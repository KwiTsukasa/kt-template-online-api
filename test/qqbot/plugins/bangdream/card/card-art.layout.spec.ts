import {
  BANGDREAM_CARD_ART_SPEC,
  createCardIconFramePath,
  createCardIllustrationFramePath,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.layout';

describe('BangDream card art spec', () => {
  it('creates icon frame paths with Bestdori rarity rules', () => {
    expect(createCardIconFramePath(1, 'cool')).toBe(
      '/res/image/card-1-cool.png',
    );
    expect(createCardIconFramePath(5, 'happy')).toBe('/res/image/card-5.png');
  });

  it('creates illustration frame paths with Bestdori rarity rules', () => {
    expect(createCardIllustrationFramePath(1, 'pure')).toBe(
      '/res/image/frame-1-pure.png',
    );
    expect(createCardIllustrationFramePath(4, 'powerful')).toBe(
      '/res/image/frame-4.png',
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
