import {
  BANGDREAM_TEXT_SPEC,
  createTextCanvasSize,
  getInlineImageWidth,
  getInlineImageY,
  getTextBaselineY,
  getTextInlineSpacing,
  getTextLineHeight,
} from '@/qqbot/plugins/bangDream/theme/canvas-text.layout';

describe('BangDream text spec', () => {
  it('keeps text line and spacing ratios stable', () => {
    expect(BANGDREAM_TEXT_SPEC.font.defaultSize).toBe(40);
    expect(getTextLineHeight(30)).toBe(40);
    expect(getTextInlineSpacing(30)).toBe(10);
    expect(getTextBaselineY(60, 30)).toBe(40);
  });

  it('keeps inline image scaling stable', () => {
    const image = { height: 20, width: 40 };

    expect(getInlineImageWidth(image, 30)).toBe(60);
    expect(getInlineImageY(40, 30)).toBe(15);
  });

  it('creates canvas sizes with historical empty, single and multiline rules', () => {
    expect(
      createTextCanvasSize({
        lineHeight: 50,
        maxWidth: 200,
        numberOfLines: 0,
      }),
    ).toEqual({ height: 50, width: 1 });

    expect(
      createTextCanvasSize({
        lineHeight: 50,
        maxWidth: 200,
        numberOfLines: 1,
        singleLineWidth: 123,
      }),
    ).toEqual({ height: 50, width: 123 });

    expect(
      createTextCanvasSize({
        lineHeight: 50,
        maxWidth: 200,
        numberOfLines: 3,
      }),
    ).toEqual({ height: 150, width: 200 });
  });
});
