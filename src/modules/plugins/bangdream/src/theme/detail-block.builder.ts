import { Canvas, Image } from 'skia-canvas';
import { drawDataBlock } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { line } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { BANGDREAM_RENDER_THEME } from '@/modules/plugins/bangdream/src/theme/render-theme';

export interface DetailBlockDataOptions {
  BG?: boolean;
  opacity?: number;
  topLeftText?: string;
}

export class DetailBlockBuilder {
  private readonly list: Array<Canvas | Image> = [];

  /**
   * 根据`block`更新`add` 对应结果。
   * @param block - 决定`add` 对应结果内容、边界或目标的 `block` 值。
   * @returns `add` 对应。
   */
  add(block: Canvas | Image): this {
    this.list.push(block);
    return this;
  }

  /**
   * 根据`block`更新内容分区。
   * @param block - 决定内容分区内容、边界或目标的 `block` 值。
   * @returns 内容分区。
   */
  addSection(block: Canvas | Image): this {
    this.list.push(block);
    this.list.push(line);
    return this;
  }

  /**
   * 按给定高度与可选宽度向详情块追加空白画布，并返回构建器以支持链式调用。
   * @param height - 决定留白块内容、边界或目标的 `height` 值。
   * @param width - 决定留白块内容、边界或目标的 `width` 值；省略时默认采用 `BANGDREAM_RENDER_THEME.layout.contentWidth`。
   * @returns 留白块。
   */
  addSpacer(
    height: number,
    width: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
  ): this {
    this.list.push(new Canvas(width, height));
    return this;
  }

  /**
   * 将当前运行态转换为`toList` 对应结果。
   * @returns 按输入顺序得到的`toList` 对应列表；没有匹配项时为空数组。
   */
  toList(): Array<Canvas | Image> {
    return [...this.list];
  }

  /**
   * 将已收集的详情区块与绘制选项交给统一布局器，并生成最终数据块画布。
   * @param options - 控制数据Block筛选、缓存或输出方式的可选项；省略时默认采用 `{}`。
   * @returns 数据Block。
   */
  toDataBlock(options: DetailBlockDataOptions = {}): Canvas {
    return drawDataBlock({ ...options, list: this.list });
  }
}
