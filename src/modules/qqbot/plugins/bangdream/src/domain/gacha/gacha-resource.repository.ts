import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import {
  getServerByPriority,
  Server,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';

export interface GachaResourceSource {
  bannerAssetBundleName?: string;
  gachaId: number;
  publishedAt: Array<number | null>;
  resourceName: string;
}

export type GachaScreenImageType = 'background' | 'backgroundFallback' | 'logo';

/**
 * 将服务器枚举值转换为 Bestdori 资源路径中的服务器编码。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 当前状态对应的将服务器枚举值转换为 Bestdori 资源路径中的服务器编码，取值为 `'undefined'`；没有可用结果或提前结束时为 `undefined`。
 */
function toServerCode(server: Server | undefined): string {
  if (server == null) {
    return 'undefined';
  }
  return Server[server];
}

export class GachaResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `gachaId`，获取卡池远端详情。
   * @param gachaId - 用于精确定位卡池的标识。
   * @param update - 决定根据参数 `gachaId`，获取卡池远端详情内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 根据参数 `gachaId`，获取卡池远端详情。
   */
  async getDetail(
    gachaId: number,
    update: boolean = true,
  ): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/gacha/${gachaId}.json`,
      { cacheTime: (() => {
        if (update) {
          return 0;
        }
        return 1 / 0;
      })() },
    );
  }

  /**
   * 根据参数 `source`，获取卡池横幅资源路径。
   * @param source - 用于根据参数 `source`，获取卡池横幅资源路径的领域对象，包含 `bannerAssetBundleName` 字段。
   * @returns 按参数编码并拼接完成的根据参数 `source`，获取卡池横幅资源路径；无法解析或未命中时为 `null`。
   */
  getBannerImagePath(source: GachaResourceSource): string | null {
    if (!source.bannerAssetBundleName) return null;
    return `/assets/jp/homebanner_rip/${source.bannerAssetBundleName}.png`;
  }

  /**
   * 根据参数 `source`，获取卡池 screen 资源路径。
   * @param source - 用于根据参数 `source`，获取卡池 screen 资源路径的领域对象，包含 `publishedAt`、`resourceName` 字段。
   * @param imageType - 决定根据参数 `source`，获取卡池 screen 资源路径内容、边界或目标的 `imageType` 值。
   * @param displayedServerList - 决定根据参数 `source`，获取卡池 screen 资源路径内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 按参数编码并拼接完成的根据参数 `source`，获取卡池 screen 资源路径。
   */
  getScreenImagePath(
    source: GachaResourceSource,
    imageType: GachaScreenImageType,
    displayedServerList: Server[] = globalDefaultServer,
  ): string {
    const serverCode = toServerCode(
      getServerByPriority(source.publishedAt, displayedServerList),
    );
    const fileName =
      (() => {
        if (imageType === 'background') {
          return 'bg';
        }
        if (imageType === 'backgroundFallback') {
          return 'bg1';
        }
        return 'logo';
      })();
    return `/assets/${serverCode}/gacha/screen/${source.resourceName}_rip/${fileName}.png`;
  }

  /**
   * 下载卡池横幅资源，缺失时回退到 Logo。
   * @param source - 决定下载卡池横幅资源，缺失时回退到 Logo内容、边界或目标的 `source` 值。
   * @param displayedServerList - 决定下载卡池横幅资源，缺失时回退到 Logo内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 下载卡池横幅资源，缺失时回退到 Logo。
   */
  async getBannerImageBuffer(
    source: GachaResourceSource,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Buffer> {
    const bannerPath = this.getBannerImagePath(source);
    if (!bannerPath) {
      return await this.getLogoImageBuffer(source, displayedServerList);
    }
    try {
      return await this.provider.getAsset(bannerPath, { ignoreError: false });
    } catch {
      return await this.getLogoImageBuffer(source, displayedServerList);
    }
  }

  /**
   * 下载卡池背景资源，`bg.png` 缺失时回退到 `bg1.png`。
   * @param source - 决定下载卡池背景资源，`bg.png` 缺失时回退到 `bg1.png`内容、边界或目标的 `source` 值。
   * @param displayedServerList - 决定下载卡池背景资源，`bg.png` 缺失时回退到 `bg1.png`内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 下载卡池背景资源，`bg.png` 缺失时回退到 `bg1.png`。
   */
  async getBackgroundImageBuffer(
    source: GachaResourceSource,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Buffer> {
    try {
      return await this.provider.getAsset(
        this.getScreenImagePath(source, 'background', displayedServerList),
        { ignoreError: false },
      );
    } catch {
      return await this.provider.getAsset(
        this.getScreenImagePath(
          source,
          'backgroundFallback',
          displayedServerList,
        ),
      );
    }
  }

  /**
   * 根据卡池资源来源解析 Logo 图片路径，并从资源提供器下载二进制内容。
   * @param source - 决定Logo图片缓冲区内容、边界或目标的 `source` 值。
   * @param displayedServerList - 决定Logo图片缓冲区内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns Logo图片缓冲区。
   */
  async getLogoImageBuffer(
    source: GachaResourceSource,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Buffer> {
    return await this.provider.getAsset(
      this.getScreenImagePath(source, 'logo', displayedServerList),
    );
  }
}

export const gachaResourceRepository = new GachaResourceRepository();
