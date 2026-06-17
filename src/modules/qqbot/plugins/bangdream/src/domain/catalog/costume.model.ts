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
  /**
   * 构造 Costume 实例，并初始化该模型的本地基础字段。
   *
   * @param costumeId - BangDream ID；定位本次读取、更新、删除或关联的BangDream。
   */
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
   * 在 Costume 模型中加载远端完整详情并标记初始化状态。
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
   * 查询 BangDream 插件数据。
   *
   * @param displayedServerList - displayedServerList 输入；驱动 `costumeResourceRepository.getSdCharacterBuffer()` 的 BangDream步骤。
   * @returns 异步处理结果。
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
