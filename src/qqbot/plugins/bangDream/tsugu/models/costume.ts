import { callAPIAndCacheResponse } from '@/qqbot/plugins/bangDream/tsugu/data-clients/api-cache-client';
import { downloadFile } from '@/qqbot/plugins/bangDream/tsugu/data-clients/asset-cache-client';
import {
  bestdoriUrl,
  globalDefaultServer,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/models/main-data-store';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { Image, loadImage } from 'skia-canvas';
import { stringToNumberArray } from '@/qqbot/plugins/bangDream/tsugu/models/model-utils';

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
   * @param costumeId - 服装ID参数。
   */
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
  /**
   * 在 Costume 模型中加载远端完整详情并标记初始化状态。
   */
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
  /**
   * 在 Costume 模型中获取SD角色。
   *
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
   * @returns 异步处理结果。
   */
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
