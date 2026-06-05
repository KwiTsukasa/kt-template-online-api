import { callAPIAndCacheResponse } from '@/qqbot/plugins/bangDream/tsugu/data/get-api';
import { downloadFile } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import {
  bestdoriUrl,
  globalDefaultServer,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { Image, loadImage } from 'skia-canvas';
import { stringToNumberArray } from '@/qqbot/plugins/bangDream/tsugu/domain/utils';

export class Costume {
  costumeId: number;
  isExist: boolean = false;
  characterId: number;
  assetBundleName: string;
  description: Array<string | null>;
  publishedAt: Array<number | null>;
  data: object;
  cards: Array<number>;
  sdResourceName: string;
  isInitfull: boolean = false;
  constructor(costumeId: number) {
    this.costumeId = costumeId;
    const costumeData = mainAPI['costumes'][costumeId.toString()];
    if (costumeData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.characterId = costumeData['characterId'];
    this.assetBundleName = costumeData['assetBundleName'];
    this.description = costumeData['description'];
    this.publishedAt = stringToNumberArray(costumeData['publishedAt']);
  }
  async initFull() {
    if (this.isInitfull) {
      return;
    }
    const costumeData = await callAPIAndCacheResponse(
      `${bestdoriUrl}/api/costumes/${this.costumeId}.json`,
    );
    this.data = costumeData;
    this.isExist = true;
    this.characterId = costumeData['characterId'];
    this.assetBundleName = costumeData['assetBundleName'];
    this.description = costumeData['description'];
    this.publishedAt = stringToNumberArray(costumeData['publishedAt']);
    this.cards = costumeData['cards'];
    this.sdResourceName = costumeData['sdResourceName'];
    this.isInitfull = true;
  }
  async getSdCharacter(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    const server = getServerByPriority(this.publishedAt, displayedServerList);
    const sdCharacterBuffer = await downloadFile(
      `${bestdoriUrl}/assets/${Server[server]}/characters/livesd/${this.sdResourceName}_rip/sdchara.png`,
    );
    return await loadImage(sdCharacterBuffer);
  }
}
