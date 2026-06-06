import {
  BANGDREAM_LIST_FRAME_SPEC,
  createCenteredImageRows,
  createKeyedListFrameLayout,
  createListWithLineLayout,
  createTipsInListLayout,
  getCenteredImageRowsHeight,
  getListFrameLineHeight,
  getListFrameSpacing,
  getListFrameTextMaxWidth,
  getMergedListColumnWidth,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-frame-spec';

describe('BangDream list frame spec', () => {
  it('keeps text sizing and content width stable', () => {
    expect(BANGDREAM_LIST_FRAME_SPEC.text.defaultSize).toBe(40);
    expect(BANGDREAM_LIST_FRAME_SPEC.text.labelSize).toBe(30);
    expect(getListFrameLineHeight(40)).toBe(60);
    expect(getListFrameSpacing(30)).toBe(10);
    expect(getListFrameTextMaxWidth(800)).toBe(760);
  });

  it('creates keyed list and tips layouts with historical offsets', () => {
    expect(
      createKeyedListFrameLayout({
        keyHeight: 30,
        maxWidth: 800,
        textHeight: 120,
      }),
    ).toEqual({
      height: 160,
      keyX: 0,
      keyY: 0,
      textX: 20,
      textY: 40,
      width: 800,
    });

    expect(createTipsInListLayout(90)).toEqual({
      backgroundHeight: 90,
      backgroundWidth: 800,
      backgroundX: 0,
      backgroundY: 10,
      height: 100,
      textMaxWidth: 760,
      textX: 20,
      textY: 10,
      width: 800,
    });
  });

  it('keeps merge column width and centered image rows deterministic', () => {
    expect(getMergedListColumnWidth(2)).toBe(400);

    const rows = createCenteredImageRows(
      [
        { height: 20, width: 300 },
        { height: 30, width: 500 },
        { height: 40, width: 200 },
      ],
      800,
    );

    expect(rows).toEqual([
      {
        height: 30,
        imageList: [
          { height: 20, width: 300 },
          { height: 30, width: 500 },
        ],
        width: 800,
      },
      {
        height: 40,
        imageList: [{ height: 40, width: 200 }],
        width: 200,
      },
    ]);
    expect(getCenteredImageRowsHeight(rows)).toBe(70);
  });

  it('keeps left-line list dimensions stable', () => {
    expect(createListWithLineLayout(120)).toEqual({
      canvasHeight: 130,
      canvasWidth: 800,
      contentX: 10,
      contentY: 10,
      lineHeight: 140,
      lineWidth: 5,
      lineY: 10,
    });
  });
});
