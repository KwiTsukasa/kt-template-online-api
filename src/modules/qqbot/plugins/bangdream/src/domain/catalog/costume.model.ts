import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import bangdreamCatalogCache from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { Image, loadImage } from 'skia-canvas';
import { stringToNumberArray } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import { costumeResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/costume-resource.repository';

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
    const costumeData = bangdreamCatalogCache['costumes'][costumeId.toString()];
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
  /**
   * 根据当前运行态处理initFull；当 `this.isInitfull` 成立时直接结束且不产生返回值。
   */
  async initFull() {
    if (this.isInitfull) {
      return;
    }
    const costumeData = await costumeResourceRepository.getDetail(
      this.costumeId,
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
  /**
   * 按`displayedServerList`读取Sd角色；从受控资源来源加载所需数据（`loadImage`）。
   * @param displayedServerList - 决定Sd角色内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns Sd角色。
   */
  async getSdCharacter(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    const sdCharacterBuffer =
      await costumeResourceRepository.getSdCharacterBuffer(
        this,
        displayedServerList,
      );
    return await loadImage(sdCharacterBuffer);
  }
}
