import { Canvas, Image } from 'skia-canvas';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/data-block';
import { line } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-frame';
import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/theme';

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

  add(block: Canvas | Image): this {
    this.list.push(block);
    return this;
  }

  addSection(block: Canvas | Image): this {
    this.list.push(block);
    this.list.push(line);
    return this;
  }

  addSpacer(
    height: number,
    width: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
  ): this {
    this.list.push(new Canvas(width, height));
    return this;
  }

  toList(): Array<Canvas | Image> {
    return [...this.list];
  }

  toDataBlock(options: DetailBlockDataOptions = {}): Canvas {
    return drawDataBlock({ ...options, list: this.list });
  }
}
