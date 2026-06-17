import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';

export class ServerResourceRepository {
  /**
   * 初始化 ServerResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取服务器图标 SVG 资源路径。
   *
   * @param serverName - serverName 输入；限定 BangDream查询范围。
   */
  getIconSvgPath(serverName: string): string {
    return `/res/icon/${serverName}.svg`;
  }

  /**
   * 获取台服本地图标路径。
   */
  getTwIconPath(): string {
    return getBangDreamAssetPath('twServerIcon');
  }

  /**
   * 下载服务器图标 SVG 资源。
   *
   * @param serverName - serverName 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   */
  async getIconSvgBuffer(serverName: string): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconSvgPath(serverName));
  }
}

export const serverResourceRepository = new ServerResourceRepository();
