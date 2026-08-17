import bangdreamCatalogCache from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import { Character } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character.model';
import { Image, loadImage } from 'skia-canvas';
import { convertSvgToPngBuffer } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { bandResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/band-resource.repository';

export class Band {
  bandId: number;
  isExist: boolean = false;
  data: object;
  bandName: Array<string | null>;
  members: Array<Character | null>;
  hasIcon: boolean = false;
  constructor(bandId: number) {
    this.bandId = bandId;
    const bandData = bangdreamCatalogCache['singer'][bandId.toString()];
    if (bangdreamCatalogCache['bands'][bandId.toString()] != undefined) {
      this.hasIcon = true;
    }
    if (bandData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.data = bandData;
    this.bandName = this.data['bandName'];
    this.getMembers();
  }
  /**
   * 按当前运行态读取Members。
   */
  getMembers() {
    const members = [];
    const characterList = bangdreamCatalogCache['characters'];
    for (const characterID in characterList) {
      const character = new Character(parseInt(characterID));
      if (character.bandId == this.bandId) {
        members.push(character);
      }
    }
    this.members = members;
  }
  /**
   * 按当前运行态读取图标；从 `getBandIcon` 读取图标。
   * @returns 图标。
   */
  async getIcon(): Promise<Image> {
    return await getBandIcon(this.bandId);
  }
  /**
   * 按当前运行态读取Logo；从受控资源来源加载所需数据（`loadImage`）。
   * @returns 从乐队资源 Buffer 解码得到的 Logo 图片。
   */
  async getLogo(): Promise<Image> {
    const logoBuffer = await bandResourceRepository.getLogoBuffer(this.bandId);
    return await loadImage(logoBuffer);
  }
}

const bandIconCache: { [bandId: number]: Image } = {};

/**
 * 按`bandId`读取Band图标；当 `bandIconCache[bandId]` 成立时返回 `bandIconCache[bandId]`。
 * @param bandId - 用于精确定位band的标识。
 * @returns Band图标。
 */
export async function getBandIcon(bandId: number): Promise<Image> {
  if (bandIconCache[bandId]) {
    return bandIconCache[bandId];
  }
  const iconSvgBuffer = await bandResourceRepository.getIconSvgBuffer(bandId);
  const iconPngBuffer = await convertSvgToPngBuffer(iconSvgBuffer);
  const image = await loadImage(iconPngBuffer);
  bandIconCache[bandId] = image;
  return image;
}
