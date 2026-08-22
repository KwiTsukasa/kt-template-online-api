import { loadImage, Image } from 'skia-canvas';
import { convertSvgToPngBuffer } from '@/modules/plugins/bangdream/src/theme/canvas-image';
import { attributeResourceRepository } from '@/modules/plugins/bangdream/src/domain/catalog/attribute-resource.repository';

const attributeColor = {
  happy: '#ff6600',
  cool: '#4057e3',
  pure: '#44c527',
  powerful: '#ff345a',
};

export class Attribute {
  name: 'cool' | 'happy' | 'pure' | 'powerful';
  color: string;
  constructor(name: string) {
    if (['cool', 'happy', 'pure', 'powerful'].includes(name as this['name'])) {
      this.name = name as this['name'];
      this.color = attributeColor[name as this['name']];
    } else {
      throw new Error('Invalid attribute name.');
    }
  }

  /**
   * 按当前运行态读取图标；从 `getAttributeIcon` 读取图标。
   * @returns 图标。
   */
  async getIcon(): Promise<Image> {
    return getAttributeIcon(this.name);
  }
}

const attributeIconCache: { [name: string]: Image } = {};

/**
 * 按`attributeName`读取卡牌属性图标；当 `attributeIconCache[attributeName]` 成立时返回 `attributeIconCache[attributeName]`。
 * @param attributeName - 决定卡牌属性图标内容、边界或目标的 `attributeName` 值。
 * @returns 卡牌属性图标。
 */
async function getAttributeIcon(attributeName: string): Promise<Image> {
  if (attributeIconCache[attributeName]) {
    return attributeIconCache[attributeName];
  }
  const iconSvgBuffer =
    await attributeResourceRepository.getIconSvgBuffer(attributeName);
  const iconPngBuffer = await convertSvgToPngBuffer(iconSvgBuffer);
  const image = await loadImage(iconPngBuffer);
  attributeIconCache[attributeName] = image;
  return image;
}
