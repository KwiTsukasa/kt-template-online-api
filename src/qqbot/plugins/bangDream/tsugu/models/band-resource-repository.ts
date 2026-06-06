import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/bestdori-provider';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/data-provider';
import { formatNumber } from '@/qqbot/plugins/bangDream/tsugu/models/model-utils';

export class BandResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取乐队 Logo 资源路径。
   *
   * @param bandId - 乐队 ID。
   */
  getLogoPath(bandId: number): string {
    return `/assets/jp/band/logo/${formatNumber(bandId, 3)}_rip/logoL.png`;
  }

  /**
   * 获取乐队图标 SVG 资源路径。
   *
   * @param bandId - 乐队 ID。
   */
  getIconSvgPath(bandId: number): string {
    return `/res/icon/band_${bandId}.svg`;
  }

  /**
   * 下载乐队 Logo 资源。
   *
   * @param bandId - 乐队 ID。
   */
  async getLogoBuffer(bandId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getLogoPath(bandId));
  }

  /**
   * 下载乐队图标 SVG 资源。
   *
   * @param bandId - 乐队 ID。
   */
  async getIconSvgBuffer(bandId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconSvgPath(bandId));
  }
}

export const bandResourceRepository = new BandResourceRepository();
