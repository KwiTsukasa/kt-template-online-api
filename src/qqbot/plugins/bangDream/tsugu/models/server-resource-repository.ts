import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/bestdori-provider';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/data-provider';
import { getBangDreamAssetPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/asset-manifest';

export class ServerResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取服务器图标 SVG 资源路径。
   *
   * @param serverName - 服务器代码。
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
   * @param serverName - 服务器代码。
   */
  async getIconSvgBuffer(serverName: string): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconSvgPath(serverName));
  }
}

export const serverResourceRepository = new ServerResourceRepository();
