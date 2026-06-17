import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';

export class AttributeResourceRepository {
  /**
   * 初始化 AttributeResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取属性图标 SVG 资源路径。
   *
   * @param attributeName - attributeName 输入；限定 BangDream查询范围。
   */
  getIconSvgPath(attributeName: string): string {
    return `/res/icon/${attributeName}.svg`;
  }

  /**
   * 下载属性图标 SVG 资源。
   *
   * @param attributeName - attributeName 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   */
  async getIconSvgBuffer(attributeName: string): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconSvgPath(attributeName));
  }
}

export const attributeResourceRepository = new AttributeResourceRepository();
