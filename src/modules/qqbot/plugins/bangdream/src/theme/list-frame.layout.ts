import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';

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
 * 按`textSize`读取列表文本默认行高。
 * @param textSize - 限制列表文本默认行高数量、尺寸、等级或重试边界的数值。
 * @returns 列表文本默认行高。
 */
export function getListFrameLineHeight(textSize: number) {
  return textSize * BANGDREAM_LIST_FRAME_SPEC.text.lineHeightRatio;
}

/**
 * 按`textSize`读取列表文本和图片之间的默认间距。
 * @param textSize - 限制列表文本和图片之间的默认间距数量、尺寸、等级或重试边界的数值。
 * @returns 列表文本和图片之间的默认间距。
 */
export function getListFrameSpacing(textSize: number) {
  return textSize * BANGDREAM_LIST_FRAME_SPEC.text.spacingRatio;
}

/**
 * 按`maxWidth`读取列表正文最大宽度。
 * @param maxWidth - 决定列表正文最大宽度内容、边界或目标的 `maxWidth` 值；省略时默认采用 `BANGDREAM_RENDER_THEME.layout.contentWidth`。
 * @returns 列表正文最大宽度。
 */
export function getListFrameTextMaxWidth(
  maxWidth: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
) {
  return maxWidth - BANGDREAM_LIST_FRAME_SPEC.list.textHorizontalInset;
}

/**
 * 计算带字段标签的列表行布局，并输出固定投影 `height`、`keyX`、`keyY`、`textX`、`textY` 字段。
 * @returns 包含 `height`、`keyX`、`keyY`、`textX`、`textY` 字段的Keyed边框布局。
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
 * 计算 tips 行布局，并输出固定投影 `backgroundHeight`、`backgroundWidth`、`backgroundX`、`backgroundY`、`height` 字段。
 * @param textHeight - 决定Tips布局内容、边界或目标的 `textHeight` 值。
 * @returns 包含 `backgroundHeight`、`backgroundWidth`、`backgroundX`、`backgroundY`、`height` 字段的Tips布局。
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
 * 按`itemCount`读取横向合并列表的列宽。
 * @param itemCount - 限制横向合并列表的列宽数量、尺寸、等级或重试边界的数值。
 * @returns 当前状态对应的横向合并列表的列宽，取值为 `0`。
 */
export function getMergedListColumnWidth(itemCount: number) {
  if (itemCount <= 0) return 0;
  return BANGDREAM_LIST_FRAME_SPEC.merge.defaultWidth / itemCount;
}

/**
 * 根据参数 `imageList`，计算居中图片列表的换行结果。
 * @param imageList - 决定根据参数 `imageList`，计算居中图片列表的换行结果内容、边界或目标的 `imageList` 值。
 * @param maxWidth - 决定根据参数 `imageList`，计算居中图片列表的换行结果内容、边界或目标的 `maxWidth` 值；省略时默认采用 `BANGDREAM_RENDER_THEME.layout.contentWidth`。
 * @returns 按输入顺序得到的根据参数 `imageList`，计算居中图片列表的换行列表；没有匹配项时为空数组。
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
 * 按`lineList`读取居中图片列表总高度。
 * @param lineList - 决定居中图片列表总高度内容、边界或目标的 `lineList` 值。
 * @returns 居中图片列表总高度。
 */
export function getCenteredImageRowsHeight(
  lineList: Array<ListFrameImageRow<ImageLike>>,
) {
  return lineList.reduce((total, element) => total + element.height, 0);
}

/**
 * 计算左侧竖线列表布局，并输出固定投影 `canvasHeight`、`canvasWidth`、`contentX`、`contentY`、`lineHeight` 字段。
 * @param contentHeight - 决定文本行布局内容、边界或目标的 `contentHeight` 值。
 * @returns 包含 `canvasHeight`、`canvasWidth`、`contentX`、`contentY`、`lineHeight` 字段的文本行布局。
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
