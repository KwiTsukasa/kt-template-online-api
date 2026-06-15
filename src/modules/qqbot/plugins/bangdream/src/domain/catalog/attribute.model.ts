import { loadImage, Image } from 'skia-canvas';
import { convertSvgToPngBuffer } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { attributeResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/attribute-resource.repository';

const attributeColor = {
  happy: '#ff6600',
  cool: '#4057e3',
  pure: '#44c527',
  powerful: '#ff345a',
};

export class Attribute {
  name: 'cool' | 'happy' | 'pure' | 'powerful';
  color: string;
  /**
   * 构造 Attribute 实例，并初始化该模型的本地基础字段。
   *
   * @param name - 名称参数。
   */
  constructor(name: string) {
    if (['cool', 'happy', 'pure', 'powerful'].includes(name as this['name'])) {
      this.name = name as this['name'];
      this.color = attributeColor[name as this['name']];
    } else {
      throw new Error('Invalid attribute name.');
    }
  }

  /**
   * 在 Attribute 模型中获取图标。
   *
   * @returns 异步处理结果。
   */
  async getIcon(): Promise<Image> {
    return getAttributeIcon(this.name);
  }
}

const attributeIconCache: { [name: string]: Image } = {};

/**
 * 在BangDream 领域模型层中获取属性图标。
 *
 * @param attributeName - 属性名称参数。
 * @returns 异步处理结果。
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
