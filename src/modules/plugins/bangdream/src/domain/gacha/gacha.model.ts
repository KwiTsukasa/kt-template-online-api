import { bangdreamCatalogRepository } from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';
import { Image, loadImage } from 'skia-canvas';
import {
  Server,
  getServerByPriority,
  serverList,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { getPresentEvent } from '@/modules/plugins/bangdream/src/domain/event/event.model';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { BANGDREAM_GACHA_TYPE_NAME } from '@/modules/plugins/bangdream/src/config/dictionary/default-dictionary';
import {
  isFreeGachaType,
  isPermanentJapaneseGachaPeriod,
} from '@/modules/plugins/bangdream/src/domain/policy/gacha.policy';
import { gachaResourceRepository } from '@/modules/plugins/bangdream/src/domain/gacha/gacha-resource.repository';

const gachaDataCache = {};

const typeName: Record<string, string> = BANGDREAM_GACHA_TYPE_NAME;

export class Gacha {
  gachaId: number;
  isExist = false;
  data: object;
  resourceName: string;
  bannerAssetBundleName: string;
  gachaName: Array<string | null>;
  publishedAt: Array<number | null>;
  closedAt: Array<number | null>;
  type: string;
  newCards: Array<number | null>;

  //other
  details: Array<{
    [cardId: string]: {
      rarityIndex: number;
      weight: number;
      pickUp: boolean;
    };
  } | null>;
  rates: Array<{
    [rarity: string]: {
      rate: number;
      weightTotal: number;
    };
  }>;
  paymentMethods: Array<{
    paymentMethod: string;
    gachaId: number;
    paymentType: string;
    quantity: number;
    paymentMethodId: number;
    count: number;
    behavior: string;
    pickup: boolean;
    maxSpinLimit: number;
    costItemQuantity: number;
    discountType: number;
    ticketId: number;
  }>;
  description: Array<string | null>;
  annotation: Array<string | null>;
  gachaPeriod: Array<string | null>;
  gachaType: string;
  information: {
    description: Array<string | null>;
    term: Array<string | null>;
    newMemberInfo: Array<string | null>;
    notice: Array<string | null>;
  };
  //用于计算
  pickUpCardId: Array<number>;
  isInitFull = false;

  constructor(gachaId: number) {
    this.gachaId = gachaId;
    const gachaData = bangdreamCatalogRepository.getEntity<Record<string, any>>(
      'gacha',
      gachaId,
    );
    if (gachaData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.data = gachaData;
    this.resourceName = gachaData['resourceName'];
    this.bannerAssetBundleName = gachaData['bannerAssetBundleName'];
    this.gachaName = gachaData['gachaName'];
    this.publishedAt = gachaData['publishedAt'];
    this.closedAt = gachaData['closedAt'];
    this.type = gachaData['type'];
    this.newCards = gachaData['newCards'];
  }
  /**
   * 通过 `gachaId.toString` 收敛领域表示。
   * @param useCache - 决定是否启用“use缓存”分支的布尔选项；省略时默认采用 `true`。
   */
  async initFull(useCache: boolean = true) {
    if (this.isInitFull) {
      return;
    }
    if (this.isExist == false) {
      return;
    }
    let gachaData: object;
    if (gachaDataCache[this.gachaId.toString()] != undefined && !useCache) {
      gachaData = gachaDataCache[this.gachaId.toString()];
    } else {
      gachaData = await this.getData(useCache);
      gachaDataCache[this.gachaId.toString()] = gachaData;
    }

    this.isExist = true;
    this.resourceName = gachaData['resourceName'];
    this.bannerAssetBundleName = gachaData['bannerAssetBundleName'];
    this.gachaName = gachaData['gachaName'];
    this.publishedAt = gachaData['publishedAt'];
    this.closedAt = gachaData['closedAt'];
    this.type = gachaData['type'];
    this.newCards = gachaData['newCards'];

    //other
    this.details = gachaData['details'];
    this.rates = gachaData['rates'];
    this.paymentMethods = gachaData['paymentMethods'];
    this.description = gachaData['description'];
    this.annotation = gachaData['annotation'];
    this.gachaPeriod = gachaData['gachaPeriod'];
    this.gachaType = gachaData['gachaType'];
    this.information = gachaData['information'];
    //加载pickUpCardId
    this.getGachaPickUpCardId();
    this.isInitFull = true;
  }
  /**
   * 在 Gacha 模型中请求当前模型的远端详情数据。
   * @param update - 决定在 Gacha 模型中请求当前模型的远端详情数据内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 在 Gacha 模型中请求当前模型的远端详情数据。
   */
  async getData(update: boolean = true) {
    return await gachaResourceRepository.getDetail(this.gachaId, update);
  }
  /**
   * 按当前运行态读取横幅图片；从受控资源来源加载所需数据（`loadImage`）。
   * @returns 横幅图片。
   */
  async getBannerImage(): Promise<Image> {
    const bannerImageBuffer =
      await gachaResourceRepository.getBannerImageBuffer(this);
    return await loadImage(bannerImageBuffer);
  }
  /**
   * 按`displayedServerList`读取卡池BGImage；从受控资源来源加载所需数据（`loadImage`）。
   * @param displayedServerList - 决定卡池BGImage内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 卡池BGImage。
   */
  async getGachaBGImage(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    const backgroundImageBuffer =
      await gachaResourceRepository.getBackgroundImageBuffer(
        this,
        displayedServerList,
      );
    return await loadImage(backgroundImageBuffer);
  }
  /**
   * 按`displayedServerList`读取卡池Logo；从受控资源来源加载所需数据（`loadImage`）。
   * @param displayedServerList - 决定卡池Logo内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 卡池Logo。
   */
  async getGachaLogo(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    const logoImageBuffer = await gachaResourceRepository.getLogoImageBuffer(
      this,
      displayedServerList,
    );
    return await loadImage(logoImageBuffer);
  }
  /**
   * 按当前运行态读取事件标识；从 `getPresentEvent` 读取事件标识。
   * @returns 事件标识。
   */
  getEventId() {
    const eventList: Array<number> = [];
    for (let i = 0; i < serverList.length; i++) {
      const server = serverList[i];
      const tempEvent = getPresentEvent(server, this.publishedAt[server]);
      if (tempEvent != null) {
        eventList.push(tempEvent.eventId);
      } else {
        eventList.push(null);
      }
    }
    return eventList;
  }
  /**
   * 按当前运行态读取Type名称；当 `typeName[this.type] == undefined` 成立时返回 `this.type`。
   * @returns Type名称。
   */
  getTypeName() {
    if (typeName[this.type] == undefined) {
      return this.type;
    }
    return typeName[this.type];
  }
  /**
   * 按当前运行态读取卡池Up卡牌标识；从 `getServerByPriority` 读取卡池Up卡牌标识。
   */
  getGachaPickUpCardId() {
    this.pickUpCardId = [];
    const server = getServerByPriority(this.publishedAt);
    const details = this.details[server];
    for (const i in details) {
      if (Object.prototype.hasOwnProperty.call(details, i)) {
        const element = details[i];
        if (element['pickup']) {
          this.pickUpCardId.push(Number(i));
        }
      }
    }
  }
}

//获取当前进行中的卡池
/**
 * 按`server`、`start`、`end`读取Present卡池；从 `bangdreamCatalogRepository.getCollection` 读取Present卡池。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param start - 决定Present卡池内容、边界或目标的 `start` 值；省略时默认采用 `Date.now()`。
 * @param end - 决定Present卡池内容、边界或目标的 `end` 值；省略时默认采用 `Date.now()`。
 * @returns 按输入顺序得到的Present卡池列表；没有匹配项时为空数组。
 */
export async function getPresentGachaList(
  server: Server,
  start: number = Date.now(),
  end: number = Date.now(),
): Promise<Array<Gacha>> {
  const gachaList: Array<Gacha> = [];
  const gachaListMain = bangdreamCatalogRepository.getCollection('gacha');

  for (const gachaId in gachaListMain) {
    if (Object.prototype.hasOwnProperty.call(gachaListMain, gachaId)) {
      const gacha = new Gacha(parseInt(gachaId));

      // 检查卡池持续时间是否与start和end有交集
      if (gacha.publishedAt[server] == null) {
        continue;
      }
      if (gacha.publishedAt[server] <= end && gacha.closedAt[server] >= start) {
        if (isFreeGachaType(gacha.type)) {
          continue;
        }
        if (gacha.gachaName[Server.jp] != null) {
          await gacha.initFull(false);
          if (isPermanentJapaneseGachaPeriod(gacha.gachaPeriod[Server.jp])) {
            continue;
          }
        }
        gachaList.push(gacha);
      }
    }
  }

  return gachaList;
}
