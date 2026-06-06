import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/theme';

interface ImageLike {
  height: number;
  width: number;
}

interface KeyedListLayoutOptions {
  keyHeight: number;
  maxWidth?: number;
  textHeight: number;
}

export interface ListFrameImageRow<T extends ImageLike> {
  height: number;
  imageList: T[];
  width: number;
}

export const BANGDREAM_LIST_FRAME_SPEC = {
  imageList: {
    emptyHeight: 10,
    emptyWidth: 1,
  },
  list: {
    emptyTextHeight: 0,
    emptyTextWidth: 0,
    keyGapHeight: 10,
    noKeySpacerHeight: 1,
    textHorizontalInset: 40,
  },
  merge: {
    defaultWidth: BANGDREAM_RENDER_THEME.layout.contentWidth,
  },
  text: {
    defaultSize: 40,
    labelSize: 30,
    lineHeightRatio: 1.5,
    spacingRatio: 1 / 3,
  },
  tips: {
    backgroundOffsetY: 10,
    defaultTextSize: 30,
    emptyTextHeight: 1,
    emptyTextWidth: 1,
  },
  withLine: {
    canvasExtraHeight: 10,
    contentX: 10,
    contentY: 10,
    lineExtraHeight: 20,
    lineWidth: 5,
  },
} as const;

/**
 * 计算列表文本默认行高。
 *
 * @param textSize - 文本字号。
 */
export function getListFrameLineHeight(textSize: number) {
  return textSize * BANGDREAM_LIST_FRAME_SPEC.text.lineHeightRatio;
}

/**
 * 计算列表文本和图片之间的默认间距。
 *
 * @param textSize - 文本字号。
 */
export function getListFrameSpacing(textSize: number) {
  return textSize * BANGDREAM_LIST_FRAME_SPEC.text.spacingRatio;
}

/**
 * 计算列表正文最大宽度。
 *
 * @param maxWidth - 列表总宽度。
 */
export function getListFrameTextMaxWidth(
  maxWidth: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
) {
  return maxWidth - BANGDREAM_LIST_FRAME_SPEC.list.textHorizontalInset;
}

/**
 * 计算带字段标签的列表行布局。
 *
 * @param options - 标签高度、正文高度和总宽度。
 */
export function createKeyedListFrameLayout({
  keyHeight,
  maxWidth = BANGDREAM_RENDER_THEME.layout.contentWidth,
  textHeight,
}: KeyedListLayoutOptions) {
  const textY = keyHeight + BANGDREAM_LIST_FRAME_SPEC.list.keyGapHeight;
  return {
    height: textHeight + textY,
    keyX: 0,
    keyY: 0,
    textX: BANGDREAM_RENDER_THEME.layout.listIndent,
    textY,
    width: maxWidth,
  };
}

/**
 * 计算 tips 行布局。
 *
 * @param textHeight - tips 文本高度。
 */
export function createTipsInListLayout(textHeight: number) {
  return {
    backgroundHeight: textHeight,
    backgroundWidth: BANGDREAM_RENDER_THEME.layout.contentWidth,
    backgroundX: 0,
    backgroundY: BANGDREAM_LIST_FRAME_SPEC.tips.backgroundOffsetY,
    height: textHeight + BANGDREAM_LIST_FRAME_SPEC.tips.backgroundOffsetY,
    textMaxWidth:
      BANGDREAM_RENDER_THEME.layout.contentWidth -
      BANGDREAM_RENDER_THEME.layout.listIndent * 2,
    textX: BANGDREAM_RENDER_THEME.layout.listIndent,
    textY: BANGDREAM_LIST_FRAME_SPEC.tips.backgroundOffsetY,
    width: BANGDREAM_RENDER_THEME.layout.contentWidth,
  };
}

/**
 * 计算横向合并列表的列宽。
 *
 * @param itemCount - 合并项数量。
 */
export function getMergedListColumnWidth(itemCount: number) {
  if (itemCount <= 0) return 0;
  return BANGDREAM_LIST_FRAME_SPEC.merge.defaultWidth / itemCount;
}

/**
 * 计算居中图片列表的换行结果。
 *
 * @param imageList - 图片或画布尺寸列表。
 * @param maxWidth - 每行最大宽度。
 */
export function createCenteredImageRows<T extends ImageLike>(
  imageList: T[],
  maxWidth: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
): ListFrameImageRow<T>[] {
  const lineList: ListFrameImageRow<T>[] = [];
  let tempWidth = 0;
  let tempHeight = 0;
  let tempImageList: T[] = [];

  const newLine = () => {
    lineList.push({
      height: tempHeight,
      imageList: tempImageList,
      width: tempWidth,
    });
    tempWidth = 0;
    tempHeight = 0;
    tempImageList = [];
  };

  for (const element of imageList) {
    if (element.width > maxWidth) {
      newLine();
      tempImageList.push(element);
      continue;
    }
    if (tempWidth + element.width > maxWidth) {
      newLine();
    }
    tempWidth += element.width;
    if (element.height > tempHeight) {
      tempHeight = element.height;
    }
    tempImageList.push(element);
  }
  if (tempImageList.length > 0) {
    newLine();
  }

  return lineList;
}

/**
 * 计算居中图片列表总高度。
 *
 * @param lineList - 居中图片行。
 */
export function getCenteredImageRowsHeight(
  lineList: Array<ListFrameImageRow<ImageLike>>,
) {
  return lineList.reduce((total, element) => total + element.height, 0);
}

/**
 * 计算左侧竖线列表布局。
 *
 * @param contentHeight - 内容总高度。
 */
export function createListWithLineLayout(contentHeight: number) {
  return {
    canvasHeight:
      contentHeight + BANGDREAM_LIST_FRAME_SPEC.withLine.canvasExtraHeight,
    canvasWidth: BANGDREAM_RENDER_THEME.layout.contentWidth,
    contentX: BANGDREAM_LIST_FRAME_SPEC.withLine.contentX,
    contentY: BANGDREAM_LIST_FRAME_SPEC.withLine.contentY,
    lineHeight:
      contentHeight + BANGDREAM_LIST_FRAME_SPEC.withLine.lineExtraHeight,
    lineWidth: BANGDREAM_LIST_FRAME_SPEC.withLine.lineWidth,
    lineY: BANGDREAM_LIST_FRAME_SPEC.withLine.contentY,
  };
}
