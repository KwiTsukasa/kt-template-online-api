import { Canvas, Image } from 'skia-canvas';
import { drawDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { line } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';

export interface DetailBlockDataOptions {
  BG?: boolean;
  opacity?: number;
  topLeftText?: string;
}

/**
 * 按详情页顺序收集区块，并统一处理区块分割线。
 */
export class DetailBlockBuilder {
  private readonly list: Array<Canvas | Image> = [];

  /**
   * 执行 BangDream 插件流程。
   * @param block - block 输入；驱动 `list.push()` 的 BangDream步骤。
   * @returns BangDream 插件产出的 this。
   */
  add(block: Canvas | Image): this {
    this.list.push(block);
    return this;
  }

  /**
   * 执行 BangDream 插件流程。
   * @param block - block 输入；驱动 `list.push()` 的 BangDream步骤。
   * @returns BangDream 插件产出的 this。
   */
  addSection(block: Canvas | Image): this {
    this.list.push(block);
    this.list.push(line);
    return this;
  }

  /**
   * 执行 BangDream 插件流程。
   * @param height - height 输入；驱动 `list.push()` 的 BangDream步骤。
   * @param width - width 输入；驱动 `list.push()` 的 BangDream步骤。
   * @returns BangDream 插件产出的 this。
   */
  addSpacer(
    height: number,
    width: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
  ): this {
    this.list.push(new Canvas(width, height));
    return this;
  }

  /**
   * 执行 BangDream 插件流程。
   * @returns BangDream 插件渲染后的图片、画布或文本。
   */
  toList(): Array<Canvas | Image> {
    return [...this.list];
  }

  /**
   * 执行 BangDream 插件流程。
   * @param options - BangDream列表；影响 toDataBlock 的返回值。
   * @returns BangDream 插件渲染后的图片、画布或文本。
   */
  toDataBlock(options: DetailBlockDataOptions = {}): Canvas {
    return drawDataBlock({ ...options, list: this.list });
  }
}
