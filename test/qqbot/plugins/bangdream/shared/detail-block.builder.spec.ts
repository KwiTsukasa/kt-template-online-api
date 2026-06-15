import { Canvas } from 'skia-canvas';
import { DetailBlockBuilder } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.builder';
import { line } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';

describe('DetailBlockBuilder', () => {
  it('keeps section separators centralized', () => {
    const first = new Canvas(10, 20);
    const second = new Canvas(30, 40);
    const list = new DetailBlockBuilder()
      .addSection(first)
      .add(second)
      .toList();

    expect(list).toEqual([first, line, second]);
  });

  it('creates spacers and data blocks from collected sections', () => {
    const dataBlock = new DetailBlockBuilder()
      .add(new Canvas(100, 50))
      .addSpacer(30, 100)
      .toDataBlock();

    expect(dataBlock.width).toBeGreaterThan(0);
    expect(dataBlock.height).toBeGreaterThan(0);
  });
});
