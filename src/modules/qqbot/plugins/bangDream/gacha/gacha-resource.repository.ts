import { bangDreamBestdoriProvider } from '@/modules/qqbot/plugins/bangDream/provider/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import {
  getServerByPriority,
  Server,
} from '@/modules/qqbot/plugins/bangDream/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangDream/config/runtime-config';

export interface GachaResourceSource {
  bannerAssetBundleName?: string;
  gachaId: number;
  publishedAt: Array<number | null>;
  resourceName: string;
}

export type GachaScreenImageType = 'background' | 'backgroundFallback' | 'logo';

/** 将服务器枚举值转换为 Bestdori 资源路径中的服务器编码。 */
function toServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class GachaResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取卡池远端详情。
   *
   * @param gachaId - 卡池 ID。
   * @param update - 是否绕过缓存。
   */
  async getDetail(
    gachaId: number,
    update: boolean = true,
  ): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/gacha/${gachaId}.json`,
      { cacheTime: update ? 0 : 1 / 0 },
    );
  }

  /**
   * 获取卡池横幅资源路径。
   *
   * @param source - 卡池资源来源字段。
   */
  getBannerImagePath(source: GachaResourceSource): string | null {
    if (!source.bannerAssetBundleName) return null;
    return `/assets/jp/homebanner_rip/${source.bannerAssetBundleName}.png`;
  }

  /**
   * 获取卡池 screen 资源路径。
   *
   * @param source - 卡池资源来源字段。
   * @param imageType - screen 图片类型。
   * @param displayedServerList - 可展示服务器优先级。
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
      imageType === 'background'
        ? 'bg'
        : imageType === 'backgroundFallback'
          ? 'bg1'
          : 'logo';
    return `/assets/${serverCode}/gacha/screen/${source.resourceName}_rip/${fileName}.png`;
  }

  /**
   * 下载卡池横幅资源，缺失时回退到 Logo。
   *
   * @param source - 卡池资源来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
   *
   * @param source - 卡池资源来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
   * 下载卡池 Logo 资源。
   *
   * @param source - 卡池资源来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
