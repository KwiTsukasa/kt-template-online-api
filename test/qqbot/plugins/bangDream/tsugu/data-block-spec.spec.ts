import {
  BANGDREAM_DATA_BLOCK_SPEC,
  calculateHorizontalDataBlockSize,
  calculateVerticalDataBlockSize,
  getDataBlockTitleLineHeight,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/data-block-spec';

describe('BangDream data block spec', () => {
  it('keeps the historical title and banner specs stable', () => {
    expect(BANGDREAM_DATA_BLOCK_SPEC.title).toMatchObject({
      backgroundColor: '#ea4e73',
      blockSize: 380,
      height: 70,
      strokeColor: '#ffffff',
      textColor: '#ffffff',
    });
    expect(BANGDREAM_DATA_BLOCK_SPEC.banner.widthMax).toBe(800);
    expect(getDataBlockTitleLineHeight()).toBe(65);
  });

  it('calculates vertical canvas size like the original renderer', () => {
    expect(
      calculateVerticalDataBlockSize({
        contentHeight: 300,
        maxContentWidth: 500,
        withBackground: true,
        withTitle: true,
      }),
    ).toEqual({ height: 470, width: 700 });
    expect(
      calculateVerticalDataBlockSize({
        contentHeight: 300,
        maxContentWidth: 500,
        withBackground: false,
        withTitle: false,
      }),
    ).toEqual({ height: 300, width: 700 });
  });

  it('calculates horizontal canvas size like the original renderer', () => {
    expect(
      calculateHorizontalDataBlockSize({
        contentWidth: 600,
        maxContentHeight: 220,
        withBackground: true,
        withTitle: true,
      }),
    ).toEqual({ height: 320, width: 870 });
    expect(
      calculateHorizontalDataBlockSize({
        contentWidth: 600,
        maxContentHeight: 220,
        withBackground: false,
        withTitle: false,
      }),
    ).toEqual({ height: 320, width: 600 });
  });
});
