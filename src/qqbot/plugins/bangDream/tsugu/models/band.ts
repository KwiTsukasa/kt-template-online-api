import mainAPI from '@/qqbot/plugins/bangDream/tsugu/models/main-data-store';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/models/character';
import { Image, loadImage } from 'skia-canvas';
import { convertSvgToPngBuffer } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';
import { bandResourceRepository } from '@/qqbot/plugins/bangDream/tsugu/models/band-resource-repository';

export class Band {
  bandId: number;
  isExist: boolean = false;
  data: object;
  bandName: Array<string | null>;
  members: Array<Character | null>;
  hasIcon: boolean = false;
  /**
   * 构造 Band 实例，并初始化该模型的本地基础字段。
   *
   * @param bandId - 乐队 ID。
   */
  constructor(bandId: number) {
    this.bandId = bandId;
    const bandData = mainAPI['singer'][bandId.toString()];
    if (mainAPI['bands'][bandId.toString()] != undefined) {
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
   * 在 Band 模型中获取Members。
   */
  getMembers() {
    const members = [];
    const characterList = mainAPI['characters'];
    for (const characterID in characterList) {
      const character = new Character(parseInt(characterID));
      if (character.bandId == this.bandId) {
        members.push(character);
      }
    }
    this.members = members;
  }
  /**
   * 在 Band 模型中获取图标。
   *
   * @returns 异步处理结果。
   */
  async getIcon(): Promise<Image> {
    return await getBandIcon(this.bandId);
  }
  /**
   * 在 Band 模型中获取Logo。
   *
   * @returns 异步处理结果。
   */
  async getLogo(): Promise<Image> {
    const logoBuffer = await bandResourceRepository.getLogoBuffer(this.bandId);
    return await loadImage(logoBuffer);
  }
}

const bandIconCache: { [bandId: number]: Image } = {};

/**
 * 在BangDream 领域模型层中获取乐队图标。
 *
 * @param bandId - 乐队 ID。
 * @returns 异步处理结果。
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
