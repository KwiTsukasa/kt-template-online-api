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

/** 将服务器枚举值转换为 Bestdori 资源路径中的服务器编码。 */
function toServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class GachaResourceRepository {
  /**
   * 初始化 GachaResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取卡池远端详情。
   *
   * @param gachaId - 卡池 ID；定位本次读取、更新、删除或关联的卡池。
   * @param update - update 输入；限定 BangDream查询范围。
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
   * @param source - source 输入；使用 `bannerAssetBundleName` 字段生成结果。
   */
  getBannerImagePath(source: GachaResourceSource): string | null {
    if (!source.bannerAssetBundleName) return null;
    return `/assets/jp/homebanner_rip/${source.bannerAssetBundleName}.png`;
  }

  /**
   * 获取卡池 screen 资源路径。
   *
   * @param source - source 输入；使用 `publishedAt`、`resourceName` 字段生成结果。
   * @param imageType - imageType 输入；限定 BangDream查询范围。
   * @param displayedServerList - displayedServerList 输入；驱动 `toServerCode()` 的 BangDream步骤。
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
   * @param source - source 输入；驱动 `this.getBannerImagePath()`、`this.getLogoImageBuffer()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `this.getLogoImageBuffer()` 的 BangDream步骤。
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
   * @param source - source 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
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
   * @param source - source 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
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
