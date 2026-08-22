import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { formatNumber } from '@/modules/plugins/bangdream/src/domain/common/model-utils';

export class BandResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `bandId`，获取乐队 Logo 资源路径。
   * @param bandId - 用于精确定位band的标识。
   * @returns 按参数编码并拼接完成的根据参数 `bandId`，获取乐队 Logo 资源路径。
   */
  getLogoPath(bandId: number): string {
    return `/assets/jp/band/logo/${formatNumber(bandId, 3)}_rip/logoL.png`;
  }

  /**
   * 根据参数 `bandId`，获取乐队图标 SVG 资源路径。
   * @param bandId - 用于精确定位band的标识。
   * @returns 按参数编码并拼接完成的根据参数 `bandId`，获取乐队图标 SVG 资源路径。
   */
  getIconSvgPath(bandId: number): string {
    return `/res/icon/band_${bandId}.svg`;
  }

  /**
   * 根据乐队标识解析 Logo 路径，并从资源提供器下载二进制内容。
   * @param bandId - 用于精确定位band的标识。
   * @returns Logo缓冲区。
   */
  async getLogoBuffer(bandId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getLogoPath(bandId));
  }

  /**
   * 根据参数 `bandId`，下载乐队图标 SVG 资源。
   * @param bandId - 用于精确定位band的标识。
   * @returns 根据参数 `bandId`，下载乐队图标 SVG 资源。
   */
  async getIconSvgBuffer(bandId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconSvgPath(bandId));
  }
}

export const bandResourceRepository = new BandResourceRepository();
