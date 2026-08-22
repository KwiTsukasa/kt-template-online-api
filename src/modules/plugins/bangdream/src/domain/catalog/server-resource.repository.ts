import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { getBangDreamAssetPath } from '@/modules/plugins/bangdream/src/theme/asset-manifest';

export class ServerResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `serverName`，获取服务器图标 SVG 资源路径。
   * @param serverName - 决定根据参数 `serverName`，获取服务器图标 SVG 资源路径内容、边界或目标的 `serverName` 值。
   * @returns 按参数编码并拼接完成的根据参数 `serverName`，获取服务器图标 SVG 资源路径。
   */
  getIconSvgPath(serverName: string): string {
    return `/res/icon/${serverName}.svg`;
  }

  /**
   * 根据当前领域状态，获取台服本地图标路径。
   * @returns 根据当前领域状态，获取台服本地图标路径。
   */
  getTwIconPath(): string {
    return getBangDreamAssetPath('twServerIcon');
  }

  /**
   * 根据参数 `serverName`，下载服务器图标 SVG 资源。
   * @param serverName - 决定根据参数 `serverName`，下载服务器图标 SVG 资源内容、边界或目标的 `serverName` 值。
   * @returns 根据参数 `serverName`，下载服务器图标 SVG 资源。
   */
  async getIconSvgBuffer(serverName: string): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconSvgPath(serverName));
  }
}

export const serverResourceRepository = new ServerResourceRepository();
