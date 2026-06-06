import { bangDreamMainDataRepository } from '@/qqbot/plugins/bangDream/tsugu/models/main-data-repository';
import { Image, loadImage } from 'skia-canvas';
import {
  Server,
  getServerByPriority,
  serverList,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { getPresentEvent } from '@/qqbot/plugins/bangDream/tsugu/models/event';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { BANGDREAM_GACHA_TYPE_NAME } from '@/qqbot/plugins/bangDream/tsugu/models/bangdream-constants';
import {
  isFreeGachaType,
  isPermanentJapaneseGachaPeriod,
} from '@/qqbot/plugins/bangDream/tsugu/models/gacha-policy';
import { gachaResourceRepository } from '@/qqbot/plugins/bangDream/tsugu/models/gacha-resource-repository';

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

  /**
   * 构造 Gacha 实例，并初始化该模型的本地基础字段。
   *
   * @param gachaId - 卡池 ID。
   */
  constructor(gachaId: number) {
    this.gachaId = gachaId;
    const gachaData = bangDreamMainDataRepository.getEntity<
      Record<string, any>
    >('gacha', gachaId);
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
   * 在 Gacha 模型中加载远端完整详情并标记初始化状态。
   *
   * @param useCache - use缓存参数，未传入时使用默认值。
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
   *
   * @param update - update参数，未传入时使用默认值。
   */
  async getData(update: boolean = true) {
    return await gachaResourceRepository.getDetail(this.gachaId, update);
  }
  /**
   * 在 Gacha 模型中获取横幅图片。
   *
   * @returns 异步处理结果。
   */
  async getBannerImage(): Promise<Image> {
    const bannerImageBuffer =
      await gachaResourceRepository.getBannerImageBuffer(this);
    return await loadImage(bannerImageBuffer);
  }
  /**
   * 在 Gacha 模型中获取卡池背景图片。
   *
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
   * @returns 异步处理结果。
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
   * 在 Gacha 模型中获取卡池Logo。
   *
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
   * @returns 异步处理结果。
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
   * 在 Gacha 模型中获取活动ID。
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
   * 在 Gacha 模型中获取类型名称。
   */
  getTypeName() {
    if (typeName[this.type] == undefined) {
      return this.type;
    }
    return typeName[this.type];
  }
  /**
   * 在 Gacha 模型中获取卡池PickUp卡牌ID。
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
 * 在BangDream 领域模型层中获取Present卡池列表。
 *
 * @param server - 目标服务器。
 * @param start - start参数，未传入时使用默认值。
 * @param end - end参数，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function getPresentGachaList(
  server: Server,
  start: number = Date.now(),
  end: number = Date.now(),
): Promise<Array<Gacha>> {
  const gachaList: Array<Gacha> = [];
  const gachaListMain = bangDreamMainDataRepository.getCollection('gacha');

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
