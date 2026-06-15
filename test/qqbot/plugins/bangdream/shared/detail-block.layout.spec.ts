import {
  BANGDREAM_DETAIL_BLOCK_SPEC,
  getRelativeMetaPercent,
} from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.layout';

describe('BangDream detail block spec', () => {
  it('keeps song detail dimensions stable', () => {
    expect(BANGDREAM_DETAIL_BLOCK_SPEC.songDetail.jacketMaxWidth).toBe(400);
    expect(BANGDREAM_DETAIL_BLOCK_SPEC.songDetail.textMaxWidth).toBe(365);
    expect(BANGDREAM_DETAIL_BLOCK_SPEC.songDetail.difficultyX).toBe(435);
    expect(BANGDREAM_DETAIL_BLOCK_SPEC.songDetail.detailSeparator.endX).toBe(
      360,
    );
  });

  it('keeps character and player detail dimensions stable', () => {
    expect(BANGDREAM_DETAIL_BLOCK_SPEC.characterHalf.width).toBe(250);
    expect(BANGDREAM_DETAIL_BLOCK_SPEC.characterHalf.height).toBe(800);
    expect(BANGDREAM_DETAIL_BLOCK_SPEC.playerDetail.illustrationWidth).toBe(
      1000,
    );
    expect(BANGDREAM_DETAIL_BLOCK_SPEC.playerDetail.dataBlockY).toBe(900);
  });

  it('rounds relative meta percent with the historical precision', () => {
    expect(getRelativeMetaPercent(333, 400)).toBe(83.25);
    expect(getRelativeMetaPercent(1, 3)).toBe(33.33);
  });
});
