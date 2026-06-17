export const BANGDREAM_DATA_BLOCK_SPEC = {
  banner: {
    widthMax: 800,
  },
  background: {
    defaultOpacity: 0.9,
    fillExtraHeight: 100,
    fillExtraWidth: 100,
    outerExtraWidth: 200,
    radius: 25,
  },
  title: {
    backgroundColor: '#ea4e73',
    blockSize: 380,
    height: 70,
    rectExtraSize: 5,
    strokeColor: '#ffffff',
    strokeWidth: 5,
    textColor: '#ffffff',
    textInset: 5,
  },
  vertical: {
    backgroundOffsetX: 50,
    backgroundOffsetY: 0,
    contentOffsetX: 100,
    contentOffsetY: 50,
    titleCenterX: 240,
    titleRectX: 50,
    titleRectY: 0,
    titleTextY: 5,
  },
  horizontal: {
    backgroundOffsetX: 50,
    backgroundOffsetY: 0,
    contentOffsetX: 100,
    contentOffsetY: 50,
    titleCenterY: 240,
    titleRectX: 0,
    titleRectY: 50,
  },
} as const;

/**
 * 计算纵向数据块画布尺寸。
 *
 * @param options - BangDream列表；影响 calculateVerticalDataBlockSize 的返回值。
 */
export function calculateVerticalDataBlockSize({
  contentHeight,
  maxContentWidth,
  withBackground,
  withTitle,
}: {
  contentHeight: number;
  maxContentWidth: number;
  withBackground: boolean;
  withTitle: boolean;
}) {
  const bodyHeight =
    contentHeight +
    (withBackground ? BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraHeight : 0);
  return {
    height:
      bodyHeight +
      (withBackground && withTitle
        ? BANGDREAM_DATA_BLOCK_SPEC.title.height
        : 0),
    width:
      maxContentWidth +
      (withBackground
        ? BANGDREAM_DATA_BLOCK_SPEC.background.outerExtraWidth
        : BANGDREAM_DATA_BLOCK_SPEC.background.outerExtraWidth),
  };
}

/**
 * 计算横向数据块画布尺寸。
 *
 * @param options - BangDream列表；影响 calculateHorizontalDataBlockSize 的返回值。
 */
export function calculateHorizontalDataBlockSize({
  contentWidth,
  maxContentHeight,
  withBackground,
  withTitle,
}: {
  contentWidth: number;
  maxContentHeight: number;
  withBackground: boolean;
  withTitle: boolean;
}) {
  const bodyWidth =
    contentWidth +
    (withBackground ? BANGDREAM_DATA_BLOCK_SPEC.background.outerExtraWidth : 0);
  return {
    height:
      maxContentHeight + BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraHeight,
    width:
      bodyWidth +
      (withBackground && withTitle
        ? BANGDREAM_DATA_BLOCK_SPEC.title.height
        : 0),
  };
}

/**
 * 获取数据块标题文字行高。
 */
export function getDataBlockTitleLineHeight() {
  return (
    BANGDREAM_DATA_BLOCK_SPEC.title.height -
    BANGDREAM_DATA_BLOCK_SPEC.title.textInset
  );
}
