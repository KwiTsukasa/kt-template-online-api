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
 * 计算纵向数据块画布尺寸，并输出固定投影 `height`、`width` 字段。
 * @returns 包含 `height`、`width` 字段的calculate垂直数据BlockSize。
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
    ((() => {
      if (withBackground) {
        return BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraHeight;
      }
      return 0;
    })());
  return {
    height:
      bodyHeight +
      ((() => {
        if (withBackground && withTitle) {
          return BANGDREAM_DATA_BLOCK_SPEC.title.height;
        }
        return 0;
      })()),
    width:
      maxContentWidth +
      ((() => {
        if (withBackground) {
          return BANGDREAM_DATA_BLOCK_SPEC.background.outerExtraWidth;
        }
        return BANGDREAM_DATA_BLOCK_SPEC.background.outerExtraWidth;
      })()),
  };
}

/**
 * 计算横向数据块画布尺寸，并输出固定投影 `height`、`width` 字段。
 * @returns 包含 `height`、`width` 字段的calculateHorizontal数据BlockSize。
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
    ((() => {
      if (withBackground) {
        return BANGDREAM_DATA_BLOCK_SPEC.background.outerExtraWidth;
      }
      return 0;
    })());
  return {
    height:
      maxContentHeight + BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraHeight,
    width:
      bodyWidth +
      ((() => {
        if (withBackground && withTitle) {
          return BANGDREAM_DATA_BLOCK_SPEC.title.height;
        }
        return 0;
      })()),
  };
}

/**
 * 根据当前领域状态，获取数据块标题文字行高。
 * @returns 根据当前领域状态，获取数据块标题文字行高。
 */
export function getDataBlockTitleLineHeight() {
  return (
    BANGDREAM_DATA_BLOCK_SPEC.title.height -
    BANGDREAM_DATA_BLOCK_SPEC.title.textInset
  );
}
