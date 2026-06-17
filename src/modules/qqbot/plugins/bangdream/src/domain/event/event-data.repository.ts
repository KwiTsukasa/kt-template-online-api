import { Canvas, Image, loadImage } from 'skia-canvas';
import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import {
  getServerByPriority,
  Server,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';

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
  /**
   * 初始化 EventDataRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(private readonly provider = bangdreamBestdoriProvider) {}

  /**
   * 获取活动远端详情数据。
   *
   * @param eventId - 活动 ID；定位本次读取、更新、删除或关联的活动。
   * @param update - update 输入；限定 BangDream查询范围。
   */
  async getDetail(
    eventId: number,
    update = true,
  ): Promise<Record<string, any>> {
    const cacheTime = update ? 0 : 1 / 0;
    return await this.provider.getJson<Record<string, any>>(
      `/api/events/${eventId}.json`,
      { cacheTime },
    );
  }

  /**
   * 获取活动背景资源路径。
   *
   * @param event - event 输入；使用 `startAt`、`assetBundleName` 字段生成结果。
   * @param displayedServerList - displayedServerList 输入；驱动 `getServerByPriority()` 的 BangDream步骤。
   */
  getBackgroundImagePath(
    event: EventAssetContext,
    displayedServerList: Server[] = globalDefaultServer,
  ): string {
    const server = getServerByPriority(event.startAt, displayedServerList);
    return `/assets/${Server[server]}/event/${event.assetBundleName}/topscreen_rip/bg_eventtop.png`;
  }

  /**
   * 获取活动主界面裁切图资源路径。
   *
   * @param event - event 输入；使用 `startAt`、`assetBundleName` 字段生成结果。
   * @param displayedServerList - displayedServerList 输入；驱动 `getServerByPriority()` 的 BangDream步骤。
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
   *
   * @param event - event 输入；使用 `startAt`、`assetBundleName`、`bannerAssetBundleName` 字段生成结果。
   * @param displayedServerList - displayedServerList 输入；驱动 `getServerByPriority()` 的 BangDream步骤。
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
   * 获取活动背景图。
   *
   * @param event - event 输入；驱动 `provider.getAsset()`、`this.getTopscreenTrimImage()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `provider.getAsset()`、`this.getTopscreenTrimImage()` 的 BangDream步骤。
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
   * 获取活动规则轮播图列表。
   *
   * @param event - event 输入；使用 `startAt`、`assetBundleName` 字段生成结果。
   * @param tempServer - tempServer 输入；驱动 `getServerByPriority()` 的 BangDream步骤。
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
   * 获取活动主界面裁切图。
   *
   * @param event - event 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
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
   * 合并Topscreen Images。
   * @param backgroundImage - backgroundImage 输入；使用 `width`、`height` 字段生成结果。
   * @param trimImage - trimImage 输入；使用 `width`、`height` 字段生成结果。
   * @returns BangDream 插件渲染后的图片、画布或文本。
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
   * 获取活动 Logo 图。
   *
   * @param event - event 输入；使用 `startAt`、`assetBundleName` 字段生成结果。
   * @param tempServer - tempServer 输入；驱动 `getServerByPriority()` 的 BangDream步骤。
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
   * 获取活动奖励表情图；缺失或上游资源不可用时返回 undefined。
   *
   * @param event - event 输入；使用 `pointRewards`、`startAt` 字段生成结果。
   * @param server - server 输入；驱动 `this.pickReleasedServerName()` 的 BangDream步骤。
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
   * 获取活动奖励装饰图；缺失或上游资源不可用时返回 undefined。
   *
   * @param event - event 输入；使用 `rankingRewards`、`startAt` 字段生成结果。
   * @param server - server 输入；驱动 `this.pickReleasedServerName()` 的 BangDream步骤。
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
   * 执行 BangDream 插件流程。
   * @param rewardsByServer - rewardsByServer 输入；影响 pickRewardId 的返回值。
   * @param rewardType - rewardType 输入；驱动 `find()` 的 BangDream步骤。
   * @returns BangDream 插件产出的 number | undefined。
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
   * 执行 BangDream 插件流程。
   * @param startAt - startAt 输入；影响 pickReleasedServerName 的返回值。
   * @param server - server 输入；驱动 `Date.now()` 的 BangDream步骤。
   * @param fallback - 兜底值；驱动 `Date.now()` 的 BangDream步骤。
   */
  private pickReleasedServerName(
    startAt: Array<number | null>,
    server: Server,
    fallback: string,
  ) {
    return startAt[server] && startAt[server] < Date.now()
      ? Server[server]
      : fallback;
  }

  /**
   * 执行 BangDream 插件流程。
   * @param value - 待转换值；执行 `value.find()` 对应的 BangDream步骤。
   * @param server - server 输入；影响 pickServerValue 的返回值。
   * @returns BangDream 插件产出的 T | undefined。
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
