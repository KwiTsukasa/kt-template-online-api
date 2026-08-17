import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';

export class AttributeResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `attributeName`，获取属性图标 SVG 资源路径。
   * @param attributeName - 决定根据参数 `attributeName`，获取属性图标 SVG 资源路径内容、边界或目标的 `attributeName` 值。
   * @returns 按参数编码并拼接完成的根据参数 `attributeName`，获取属性图标 SVG 资源路径。
   */
  getIconSvgPath(attributeName: string): string {
    return `/res/icon/${attributeName}.svg`;
  }

  /**
   * 根据参数 `attributeName`，下载属性图标 SVG 资源。
   * @param attributeName - 决定根据参数 `attributeName`，下载属性图标 SVG 资源内容、边界或目标的 `attributeName` 值。
   * @returns 根据参数 `attributeName`，下载属性图标 SVG 资源。
   */
  async getIconSvgBuffer(attributeName: string): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconSvgPath(attributeName));
  }
}

export const attributeResourceRepository = new AttributeResourceRepository();
