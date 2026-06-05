import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/domain/character';
import { Image, loadImage } from 'skia-canvas';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import { formatNumber } from '@/qqbot/plugins/bangDream/tsugu/domain/utils';
import { bestdoriUrl } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { convertSvgToPngBuffer } from '@/qqbot/plugins/bangDream/tsugu/graphics/utils';

export class Band {
  bandId: number;
  isExist: boolean = false;
  data: object;
  bandName: Array<string | null>;
  members: Array<Character | null>;
  hasIcon: boolean = false;
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
  async getIcon(): Promise<Image> {
    return await getBandIcon(this.bandId);
  }
  async getLogo(): Promise<Image> {
    const logoBuffer = await downloadFileCache(
      `${bestdoriUrl}/assets/jp/band/logo/${formatNumber(this.bandId, 3)}_rip/logoL.png`,
    );
    return await loadImage(logoBuffer);
  }
}

const bandIconCache: { [bandId: number]: Image } = {};

export async function getBandIcon(bandId: number): Promise<Image> {
  if (bandIconCache[bandId]) {
    return bandIconCache[bandId];
  }
  const iconSvgBuffer = await downloadFileCache(
    `${bestdoriUrl}/res/icon/band_${bandId}.svg`,
  );
  const iconPngBuffer = await convertSvgToPngBuffer(iconSvgBuffer);
  const image = await loadImage(iconPngBuffer);
  bandIconCache[bandId] = image;
  return image;
}
