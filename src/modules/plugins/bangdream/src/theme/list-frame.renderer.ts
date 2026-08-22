import { Canvas, Image } from 'skia-canvas';
import { drawRoundedRectWithText } from '@/modules/plugins/bangdream/src/theme/canvas-rect';
import {
  drawText,
  drawTextWithImages,
} from '@/modules/plugins/bangdream/src/theme/canvas-text';
import { drawDottedLine } from '@/modules/plugins/bangdream/src/theme/canvas-dotted-line';
import {
  Server,
  getServerByPriority,
  getIcon,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { stackImageHorizontal } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { BANGDREAM_RENDER_THEME } from '@/modules/plugins/bangdream/src/theme/render-theme';
import {
  createHorizontalSeparatorSpec,
  createVerticalSeparatorSpec,
} from '@/modules/plugins/bangdream/src/theme/layout';
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
} from '@/modules/plugins/bangdream/src/theme/list-frame.layout';

//表格用默认虚线
export const line: Canvas = drawDottedLine(createHorizontalSeparatorSpec());

interface ListOptions {
  key?: string;
  text?: string;
  content?: Array<string | Canvas | Image>;
  textSize?: number;
  lineHeight?: number;
  spacing?: number;
  color?: string;
  maxWidth?: number;
}

//画表格中的一行
/**
 * 根据当前运行态绘制或格式化`drawList` 对应结果；当 `key == undefined` 成立时返回 `stackImageHorizontal([ new Canvas( BANGDREA…`。
 * @returns `drawList` 对应。
 */
export function drawList({
  key,
  text,
  content,
  textSize = BANGDREAM_LIST_FRAME_SPEC.text.defaultSize,
  lineHeight = getListFrameLineHeight(textSize),
  spacing = getListFrameSpacing(textSize),
  color = BANGDREAM_RENDER_THEME.color.primaryText,
  maxWidth = BANGDREAM_RENDER_THEME.layout.contentWidth,
}: ListOptions): Canvas {
  const xmax = getListFrameTextMaxWidth(maxWidth);
  const keyImage = drawRoundedRectWithText({
    text: key,
    textSize: BANGDREAM_LIST_FRAME_SPEC.text.labelSize,
  });

  let textImage: Canvas;
  if (typeof text == 'string') {
    textImage = drawText({ text, maxWidth: xmax, lineHeight });
  } else if (content != undefined) {
    textImage = drawTextWithImages({
      content,
      maxWidth: xmax,
      lineHeight,
      textSize,
      spacing,
      color,
    });
  } else {
    textImage = new Canvas(
      BANGDREAM_LIST_FRAME_SPEC.list.emptyTextWidth,
      BANGDREAM_LIST_FRAME_SPEC.list.emptyTextHeight,
    );
  }
  if (key == undefined) {
    return stackImageHorizontal([
      new Canvas(
        BANGDREAM_RENDER_THEME.layout.listIndent,
        BANGDREAM_LIST_FRAME_SPEC.list.noKeySpacerHeight,
      ),
      textImage,
    ]);
  }
  const layout = createKeyedListFrameLayout({
    keyHeight: keyImage.height,
    maxWidth,
    textHeight: textImage.height,
  });
  const canvas = new Canvas(layout.width, layout.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(keyImage, layout.keyX, layout.keyY);
  if (textImage.height != 0) {
    ctx.drawImage(textImage, layout.textX, layout.textY);
  }
  return canvas;
}

interface tipsOptions {
  text?: string;
  content?: Array<string | Canvas | Image>;
  textSize?: number;
  lineHeight?: number;
  spacing?: number;
}
/**
 * 根据当前运行态绘制或格式化Tips；把图片、文本或图形按布局规格绘制到画布。
 * @returns 按文本或图文内容计算提示区布局并绘制完成的提示画布；无内容时使用空提示尺寸。
 */
export function drawTipsInList({
  text,
  content,
  textSize = BANGDREAM_LIST_FRAME_SPEC.tips.defaultTextSize,
  lineHeight = getListFrameLineHeight(textSize),
  spacing = getListFrameSpacing(textSize),
}: tipsOptions) {
  const layout = createTipsInListLayout(0);
  const xmax = layout.textMaxWidth;
  let textImage: Canvas;
  if (typeof text == 'string') {
    textImage = drawText({ text, textSize, maxWidth: xmax, lineHeight });
  } else if (content != undefined) {
    textImage = drawTextWithImages({
      textSize,
      content,
      maxWidth: xmax,
      lineHeight,
      spacing,
    });
  } else {
    textImage = new Canvas(
      BANGDREAM_LIST_FRAME_SPEC.tips.emptyTextWidth,
      BANGDREAM_LIST_FRAME_SPEC.tips.emptyTextHeight,
    );
  }
  const textLayout = createTipsInListLayout(textImage.height);
  const canvas = new Canvas(textLayout.width, textLayout.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BANGDREAM_RENDER_THEME.color.subtlePanel;
  ctx.fillRect(
    textLayout.backgroundX,
    textLayout.backgroundY,
    textLayout.backgroundWidth,
    textLayout.backgroundHeight,
  );
  ctx.drawImage(textImage, textLayout.textX, textLayout.textY);
  return canvas;
}

/**
 * 根据`content`、`key`、`serverList`绘制或格式化服务器；同步更新对应缓存或去重状态（`contentMap.set`）。
 * @param content - 用于服务器的领域对象，包含 `tempServer` 字段。
 * @param key - 用于读取或更新服务器的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param serverList - 用于服务器的领域对象，包含 `length`、`i` 字段；省略时默认采用 `globalDefaultServer`。
 * @param maxWidth - 决定服务器内容、边界或目标的 `maxWidth` 值；省略时默认采用 `BANGDREAM_RENDER_THEME.layout.contentWidth`。
 * @returns 服务器。
 */
export async function drawListByServerList(
  content: Array<string | null>,
  key?: string,
  serverList: Server[] = globalDefaultServer,
  maxWidth: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
) {
  const tempcontent: Array<string | Image | Canvas> = [];

  // 获取每个服务器的内容对应关系
  const contentMap = new Map<string, Server[]>();

  // 分组服务器，根据相同的内容将服务器归类
  for (let i = 0; i < serverList.length; i++) {
    const tempServer = serverList[i];
    const serverContent = content[tempServer];
    if (serverContent == null) {
      continue;
    }

    if (!contentMap.has(serverContent)) {
      contentMap.set(serverContent, []);
    }
    contentMap.get(serverContent)?.push(tempServer);
  }

  // 遍历内容分组
  for (const [serverContent, servers] of contentMap) {
    if (servers.length > 0) {
      // 对于同一组内容，只需要绘制一次图标和内容
      for (let i = 0; i < servers.length; i++) {
        tempcontent.push(await getIcon(servers[i]));
      }
      // 添加对应的内容
      tempcontent.push(serverContent);
      tempcontent.push('\n');
    }
  }

  // 如果所有服务器内容都为空，选择优先级最高的服务器
  if (tempcontent.length == 0) {
    const tempServer = getServerByPriority(content, serverList);
    tempcontent.push(await getIcon(tempServer));
    tempcontent.push(content[tempServer]);
    tempcontent.push('\n');
  }

  // 去掉最后一个换行符
  tempcontent.pop();

  const canvas = drawList({
    key: key,
    content: tempcontent,
    maxWidth,
  });

  return canvas;
}

//横向组合较短list，高度为最高的list，宽度平分
/**
 * 根据`imageList`绘制或格式化`drawListMerge` 对应结果；把图片、文本或图形按布局规格绘制到画布。
 * @param imageList - 用于`drawListMerge` 对应结果的领域对象，包含 `length`、`i` 字段。
 * @returns `drawListMerge` 对应。
 */
export function drawListMerge(imageList: Array<Canvas | Image>): Canvas {
  let maxHeight = 0;
  for (let i = 0; i < imageList.length; i++) {
    const element = imageList[i];
    if (element.height > maxHeight) {
      maxHeight = element.height;
    }
  }
  const canvas = new Canvas(
    BANGDREAM_LIST_FRAME_SPEC.merge.defaultWidth,
    maxHeight,
  );
  const ctx = canvas.getContext('2d');
  let x = 0;
  const columnWidth = getMergedListColumnWidth(imageList.length);
  for (let i = 0; i < imageList.length; i++) {
    const element = imageList[i];
    ctx.drawImage(element, x, 0);
    x += columnWidth;
  }
  return canvas;
}

//横向组合image/canvas array，居中，超过宽度则换行
/**
 * 根据`imageList`、`maxWidth`绘制或格式化图片Center；当 `imageList.length == 0` 成立时返回 `new Canvas( BANGDREAM_LIST_FRAME_SPEC.image…`。
 * @param imageList - 用于图片Center的领域对象，包含 `length` 字段。
 * @param maxWidth - 决定图片Center内容、边界或目标的 `maxWidth` 值；省略时默认采用 `BANGDREAM_RENDER_THEME.layout.contentWidth`。
 * @returns 图片Center。
 */
export function drawImageListCenter(
  imageList: Array<Canvas | Image>,
  maxWidth: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
): Canvas {
  if (imageList.length == 0) {
    return new Canvas(
      BANGDREAM_LIST_FRAME_SPEC.imageList.emptyWidth,
      BANGDREAM_LIST_FRAME_SPEC.imageList.emptyHeight,
    );
  }
  const lineList = createCenteredImageRows(imageList, maxWidth);
  const height = getCenteredImageRowsHeight(lineList);
  const canvas = new Canvas(maxWidth, height);
  const ctx = canvas.getContext('2d');
  //画每一行
  const middleWidth = maxWidth / 2;
  let y = 0;
  for (let i = 0; i < lineList.length; i++) {
    const element = lineList[i];
    let x = middleWidth - element.width / 2;
    for (let j = 0; j < element.imageList.length; j++) {
      const image = element.imageList[j];
      ctx.drawImage(image, x, y);
      x += image.width;
    }
    y += element.height;
  }
  return canvas;
}

//画左侧有竖线的排版，用于画block时展示数据
/**
 * 根据`textImageList`绘制或格式化文本行；把图片、文本或图形按布局规格绘制到画布。
 * @param textImageList - 用于文本行的领域对象，包含 `length`、`i` 字段。
 * @returns 文本行。
 */
export function drawListWithLine(textImageList: Array<Canvas | Image>): Canvas {
  let height = 0;
  for (let i = 0; i < textImageList.length; i++) {
    const element = textImageList[i];
    height += element.height;
  }
  const layout = createListWithLineLayout(height);
  const canvas = new Canvas(layout.canvasWidth, layout.canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BANGDREAM_RENDER_THEME.color.separator;
  const lineSpec = createVerticalSeparatorSpec(layout.lineHeight);
  ctx.fillRect(
    lineSpec.startX,
    layout.lineY,
    layout.lineWidth,
    layout.lineHeight,
  );
  let y = layout.contentY;
  for (let i = 0; i < textImageList.length; i++) {
    const element = textImageList[i];
    ctx.drawImage(element, layout.contentX, y);
    y += element.height;
  }
  return canvas;
}
