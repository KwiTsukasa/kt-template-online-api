import { loadImage, Image } from 'skia-canvas';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import { bestdoriUrl } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { convertSvgToPngBuffer } from '@/qqbot/plugins/bangDream/tsugu/graphics/utils';

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

  async getIcon(): Promise<Image> {
    return getAttributeIcon(this.name);
  }
}

const attributeIconCache: { [name: string]: Image } = {};

async function getAttributeIcon(attributeName: string): Promise<Image> {
  if (attributeIconCache[attributeName]) {
    return attributeIconCache[attributeName];
  }
  const iconSvgBuffer = await downloadFileCache(
    `${bestdoriUrl}/res/icon/${attributeName}.svg`,
  );
  const iconPngBuffer = await convertSvgToPngBuffer(iconSvgBuffer);
  const image = await loadImage(iconPngBuffer);
  attributeIconCache[attributeName] = image;
  return image;
}
