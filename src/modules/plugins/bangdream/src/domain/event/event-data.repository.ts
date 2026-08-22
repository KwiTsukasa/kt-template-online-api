import { Canvas, Image, loadImage } from 'skia-canvas';
import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import {
  getServerByPriority,
  Server,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';

export interface EventAssetContext {
  assetBundleName: string;
  bannerAssetBundleName?: string;
  startAt: Array<number | null>;
}

export interface EventRewardContext {
  pointRewards?: Array<Array<{
    point: string;
    rewardType: string;
    rewardId?: number;
    rewardQuantity: number;
  }> | null>;
  rankingRewards?: Array<Array<{
    fromRank: number;
    toRank: number;
    rewardType: string;
    rewardId: number;
    rewardQuantity: number;
  }> | null>;
  startAt: Array<number | null>;
}

type RewardWithId = {
  rewardId?: number;
  rewardType: string;
};

export class EventDataRepository {
  constructor(private readonly provider = bangdreamBestdoriProvider) {}

  /**
   * 根据参数 `eventId`，获取活动远端详情数据。
   * @param eventId - 用于精确定位事件的标识。
   * @param update - 决定根据参数 `eventId`，获取活动远端详情数据内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 根据参数 `eventId`，获取活动远端详情数据。
   */
  async getDetail(
    eventId: number,
    update = true,
  ): Promise<Record<string, any>> {
    const cacheTime = (() => {
      if (update) {
        return 0;
      }
      return 1 / 0;
    })();
    return await this.provider.getJson<Record<string, any>>(
      `/api/events/${eventId}.json`,
      { cacheTime },
    );
  }

  /**
   * 根据参数 `event`，获取活动背景资源路径。
   * @param event - 触发根据参数 `event`，获取活动背景资源路径的领域事件，包含 `startAt`、`assetBundleName` 字段。
   * @param displayedServerList - 决定根据参数 `event`，获取活动背景资源路径内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 按参数编码并拼接完成的根据参数 `event`，获取活动背景资源路径。
   */
  getBackgroundImagePath(
    event: EventAssetContext,
    displayedServerList: Server[] = globalDefaultServer,
  ): string {
    const server = getServerByPriority(event.startAt, displayedServerList);
    return `/assets/${Server[server]}/event/${event.assetBundleName}/topscreen_rip/bg_eventtop.png`;
  }

  /**
   * 根据参数 `event`，获取活动主界面裁切图资源路径。
   * @param event - 触发根据参数 `event`，获取活动主界面裁切图资源路径的领域事件，包含 `startAt`、`assetBundleName` 字段。
   * @param displayedServerList - 决定根据参数 `event`，获取活动主界面裁切图资源路径内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 按参数编码并拼接完成的根据参数 `event`，获取活动主界面裁切图资源路径。
   */
  getTopscreenTrimImagePath(
    event: EventAssetContext,
    displayedServerList: Server[] = globalDefaultServer,
  ): string {
    const server = getServerByPriority(event.startAt, displayedServerList);
    return `/assets/${Server[server]}/event/${event.assetBundleName}/topscreen_rip/trim_eventtop.png`;
  }

  /**
   * 获取活动横幅图，优先活动资源，失败时回退 homebanner。
   * @param event - 触发活动横幅图，优先活动资源，失败时回退 homebanner的领域事件，包含 `startAt`、`assetBundleName`、`bannerAssetBundleName` 字段。
   * @param displayedServerList - 决定活动横幅图，优先活动资源，失败时回退 homebanner内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 活动横幅图，优先活动资源，失败时回退 homebanner。
   */
  async getBannerImage(
    event: EventAssetContext,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    const server = getServerByPriority(event.startAt, displayedServerList);
    try {
      const bannerImageBuffer = await this.provider.getAsset(
        `/assets/${Server[server]}/event/${event.assetBundleName}/images_rip/banner.png`,
        { ignoreError: false },
      );
      return await loadImage(bannerImageBuffer);
    } catch {
      const bannerImageBuffer = await this.provider.getAsset(
        `/assets/jp/homebanner_rip/${event.bannerAssetBundleName}.png`,
      );
      return await loadImage(bannerImageBuffer);
    }
  }

  /**
   * 按活动与服务器下载背景图；顶部裁切图可用时合并两层图片，加载失败时回退到原背景。
   * @param event - 触发按活动与服务器下载背景图的领域事件。
   * @param displayedServerList - 决定按活动与服务器下载背景图内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 按活动与服务器下载背景图。
   */
  async getBackgroundImage(
    event: EventAssetContext,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image | Canvas> {
    const bgImageBuffer = await this.provider.getAsset(
      this.getBackgroundImagePath(event, displayedServerList),
    );
    const backgroundImage = await loadImage(bgImageBuffer);
    try {
      const trimImage = await this.getTopscreenTrimImage(
        event,
        displayedServerList,
      );
      return this.mergeTopscreenImages(backgroundImage, trimImage);
    } catch {
      return backgroundImage;
    }
  }

  /**
   * 根据参数 `event`，获取活动规则轮播图列表。
   * @param event - 触发根据参数 `event`，获取活动规则轮播图列表的领域事件，包含 `startAt`、`assetBundleName` 字段。
   * @param tempServer - 决定根据参数 `event`，获取活动规则轮播图列表内容、边界或目标的 `tempServer` 值。
   * @returns 按输入顺序得到的根据参数 `event`，获取活动规则轮播图列表；没有匹配项时为空数组。
   */
  async getSlideImages(
    event: EventAssetContext,
    tempServer: Server,
  ): Promise<Image[]> {
    const server = getServerByPriority(event.startAt, [tempServer]);
    const result: Image[] = [];
    const basePath = `/assets/${Server[server]}/event/${event.assetBundleName}/slide_rip/`;
    let ruleNumber = 1;
    while (true) {
      try {
        const slideImageBuffer = await this.provider.getAsset(
          `${basePath}rule${ruleNumber}.png`,
          { ignoreError: false },
        );
        result.push(await loadImage(slideImageBuffer));
      } catch {
        break;
      }
      ruleNumber++;
    }
    return result;
  }

  /**
   * 根据参数 `event`，获取活动主界面裁切图。
   * @param event - 触发根据参数 `event`，获取活动主界面裁切图的领域事件。
   * @param displayedServerList - 决定根据参数 `event`，获取活动主界面裁切图内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 根据参数 `event`，获取活动主界面裁切图。
   */
  async getTopscreenTrimImage(
    event: EventAssetContext,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    const topscreenTrimImageBuffer = await this.provider.getAsset(
      this.getTopscreenTrimImagePath(event, displayedServerList),
    );
    return await loadImage(topscreenTrimImageBuffer);
  }

  /**
   * 根据`backgroundImage`、`trimImage`更新顶部横幅Images；把图片、文本或图形按布局规格绘制到画布。
   * @param backgroundImage - 用于顶部横幅Images的领域对象，包含 `width`、`height` 字段。
   * @param trimImage - 用于顶部横幅Images的领域对象，包含 `width`、`height` 字段。
   * @returns 顶部横幅Images。
   */
  private mergeTopscreenImages(
    backgroundImage: Image,
    trimImage: Image,
  ): Canvas {
    const canvas = new Canvas(backgroundImage.width, backgroundImage.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(backgroundImage, 0, 0);

    const scale = Math.min(
      backgroundImage.width / trimImage.width,
      backgroundImage.height / trimImage.height,
      1,
    );
    const width = trimImage.width * scale;
    const height = trimImage.height * scale;
    ctx.drawImage(
      trimImage,
      (backgroundImage.width - width) / 2,
      backgroundImage.height - height,
      width,
      height,
    );
    return canvas;
  }

  /**
   * 根据参数 `event`，查询并返回活动 Logo 图。
   * @param event - 触发根据参数 `event`，查询并返回活动 Logo 图的领域事件，包含 `startAt`、`assetBundleName` 字段。
   * @param tempServer - 决定根据参数 `event`，查询并返回活动 Logo 图内容、边界或目标的 `tempServer` 值。
   * @returns 根据参数 `event`，查询并返回活动 Logo 图。
   */
  async getLogoImage(
    event: EventAssetContext,
    tempServer: Server,
  ): Promise<Image> {
    const server = getServerByPriority(event.startAt, [tempServer]);
    const logoImageBuffer = await this.provider.getAsset(
      `/assets/${Server[server]}/event/${event.assetBundleName}/images_rip/logo.png`,
    );
    return await loadImage(logoImageBuffer);
  }

  /**
   * 按`event`、`server`读取活动奖励表情图；从受控资源来源加载所需数据（`provider.getJson`）。
   * @param event - 触发活动奖励表情图的领域事件，包含 `pointRewards`、`startAt` 字段。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 活动奖励表情图；没有可用结果或提前结束时为 `undefined`。
   */
  async getRewardStampImage(
    event: EventRewardContext,
    server: Server,
  ): Promise<Image | undefined> {
    const allStamps = await this.provider.getJson<Record<string, any>>(
      '/api/stamps/all.2.json',
    );
    const rewardId = this.pickRewardId(event.pointRewards, 'stamp');
    if (rewardId === undefined) return undefined;

    const stampAssetName = this.pickServerValue<string>(
      allStamps[rewardId]?.imageName,
      server,
    );
    if (!stampAssetName) return undefined;

    const serverName = this.pickReleasedServerName(event.startAt, server, 'jp');
    try {
      const stampBuffer = await this.provider.getAsset(
        `/assets/${serverName}/stamp/01_rip/${stampAssetName}.png`,
        { ignoreError: false },
      );
      return await loadImage(stampBuffer);
    } catch {
      return undefined;
    }
  }

  /**
   * 按`event`、`server`读取活动奖励装饰图；从受控资源来源加载所需数据（`loadImage`）。
   * @param event - 触发活动奖励装饰图的领域事件，包含 `rankingRewards`、`startAt` 字段。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 活动奖励装饰图；没有可用结果或提前结束时为 `undefined`。
   */
  async getRewardDecoImage(
    event: EventRewardContext,
    server: Server,
  ): Promise<Image | undefined> {
    if (!event.rankingRewards?.[server]) return undefined;

    const rewardId = this.pickRewardId(event.rankingRewards, 'deco_pins');
    if (rewardId === undefined) return undefined;

    const { bangdreamCatalogRepository } =
      await import('../../application/catalog/bangdream-catalog-repository');
    const allDeco =
      bangdreamCatalogRepository.getCollection<Record<string, any>>('deco');
    const decoAssetName = allDeco[rewardId]?.assetBundleName;
    if (!decoAssetName) return undefined;

    const serverName = this.pickReleasedServerName(event.startAt, server, 'cn');
    try {
      const decoBuffer = await this.provider.getAsset(
        `/assets/${serverName}/deco/pins_rip/${decoAssetName}.png`,
        { ignoreError: false },
      );
      return await loadImage(decoBuffer);
    } catch {
      return undefined;
    }
  }

  /**
   * 通过 `rewardsByServer.filter` 筛选匹配数据。
   * @param rewardsByServer - 决定奖励标识内容、边界或目标的 `rewardsByServer` 值。
   * @param rewardType - 决定奖励标识内容、边界或目标的 `rewardType` 值。
   * @returns 奖励标识。
   */
  private pickRewardId(
    rewardsByServer: Array<Array<RewardWithId> | null> | undefined,
    rewardType: string,
  ): number | undefined {
    const rewards = rewardsByServer?.filter(Boolean)[0];
    return rewards?.find((reward) => reward.rewardType === rewardType)
      ?.rewardId;
  }

  /**
   * 从`startAt`、`server`、`fallback`筛选Released服务器名称，并保持保留项的原有顺序与键名；当 `startAt[server] && startAt[server] < Date.now()` 成立时返回 `Server[server]`。
   * @param startAt - 用于过期、排序或租约判定的时间基准。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns Released服务器名称。
   */
  private pickReleasedServerName(
    startAt: Array<number | null>,
    server: Server,
    fallback: string,
  ) {
    if (startAt[server] && startAt[server] < Date.now()) {
      return Server[server];
    }
    return fallback;
  }

  /**
   * 从`value`、`server`筛选服务器值，并保持保留项的原有顺序与键名；当 `Array.isArray(value)` 成立时返回 `value[server] ?? value[Server.jp] ?? value.…`。
   * @param value - 参与服务器值比较、格式化或输出的候选值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 规范化后的服务器值；主值为空时采用 `undefined` 兜底；没有可用结果或提前结束时为 `undefined`。
   */
  private pickServerValue<T>(
    value: T | T[] | undefined | null,
    server: Server,
  ): T | undefined {
    if (Array.isArray(value)) {
      return value[server] ?? value[Server.jp] ?? value.find(Boolean);
    }
    return value ?? undefined;
  }
}

export const eventDataRepository = new EventDataRepository();
