import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

const LEGACY_ANIMATED_TEXTURE_NAMES = new Set([
  'ani_degree_bilibili_day1',
  'ani_degree_bilibili_092701',
  'ani_degree_bilibili_collabo',
  'ani_degree_bilibili_6years',
]);

export class DegreeResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `baseImageName`，获取称号缩略图资源路径。
   * @param baseImageName - 决定根据参数 `baseImageName`，获取称号缩略图资源路径内容、边界或目标的 `baseImageName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 按参数编码并拼接完成的根据参数 `baseImageName`，获取称号缩略图资源路径。
   */
  getThumbnailPath(baseImageName: string, server: Server): string {
    return `/assets/${Server[server]}/thumb/degree_rip/${baseImageName}.png`;
  }

  /**
   * 根据参数 `baseImageName`，获取新版称号缩略图兜底资源路径。
   * @param baseImageName - 决定根据参数 `baseImageName`，获取新版称号缩略图兜底资源路径内容、边界或目标的 `baseImageName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 按参数编码并拼接完成的根据参数 `baseImageName`，获取新版称号缩略图兜底资源路径。
   */
  getFallbackThumbnailPath(baseImageName: string, server: Server): string {
    return `/assets/${Server[server]}/thumb/degree_rip/assets-star-forassetbundle-startapp-thumbnail-degree-${baseImageName}.png`;
  }

  /**
   * 根据参数 `frameName`，获取称号框资源路径。
   * @param frameName - 决定根据参数 `frameName`，获取称号框资源路径内容、边界或目标的 `frameName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 按参数编码并拼接完成的根据参数 `frameName`，获取称号框资源路径。
   */
  getFramePath(frameName: string, server: Server): string {
    return `/assets/${Server[server]}/thumb/degree_rip/${frameName}.png`;
  }

  /**
   * 根据参数 `iconName`，获取称号图标资源路径。
   * @param iconName - 决定根据参数 `iconName`，获取称号图标资源路径内容、边界或目标的 `iconName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 按参数编码并拼接完成的根据参数 `iconName`，获取称号图标资源路径。
   */
  getIconPath(iconName: string, server: Server): string {
    return `/assets/${Server[server]}/thumb/degree_rip/${iconName}.png`;
  }

  /**
   * 根据参数 `baseImageName`，获取动态称号脚本资源路径。
   * @param baseImageName - 决定根据参数 `baseImageName`，获取动态称号脚本资源路径内容、边界或目标的 `baseImageName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 按参数编码并拼接完成的根据参数 `baseImageName`，获取动态称号脚本资源路径。
   */
  getAnimatedScriptPath(baseImageName: string, server: Server): string {
    return `/assets/${Server[server]}/${baseImageName}_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-${baseImageName}-${baseImageName}.asset`;
  }

  /**
   * 根据参数 `baseImageName`，获取动态称号纹理资源路径。
   * @param baseImageName - 决定根据参数 `baseImageName`，获取动态称号纹理资源路径内容、边界或目标的 `baseImageName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 按参数编码并拼接完成的根据参数 `baseImageName`，获取动态称号纹理资源路径。
   */
  getAnimatedTexturePath(baseImageName: string, server: Server): string {
    const fileName = (() => {
      if (LEGACY_ANIMATED_TEXTURE_NAMES.has(baseImageName)) {
        return `${baseImageName}.png`;
      }
      return `assets-star-forassetbundle-startapp-thumbnail-animedegree-${baseImageName}-${baseImageName}.png`;
    })();
    return `/assets/${Server[server]}/${baseImageName}_rip/${fileName}`;
  }

  /**
   * 下载称号缩略图资源，缺失时回退到新版统一路径。
   * @param baseImageName - 决定下载称号缩略图资源，缺失时回退到新版统一路径内容、边界或目标的 `baseImageName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 下载称号缩略图资源，缺失时回退到新版统一路径。
   */
  async getThumbnailBuffer(
    baseImageName: string,
    server: Server,
  ): Promise<Buffer> {
    try {
      return await this.provider.getAsset(
        this.getThumbnailPath(baseImageName, server),
        { ignoreError: false, memoryCache: false },
      );
    } catch {
      return await this.provider.getAsset(
        this.getFallbackThumbnailPath(baseImageName, server),
        { memoryCache: false },
      );
    }
  }

  /**
   * 根据称号框名称解析资源路径，并从资源提供器下载二进制内容。
   * @param frameName - 决定边框缓冲区内容、边界或目标的 `frameName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 边框缓冲区。
   */
  async getFrameBuffer(frameName: string, server: Server): Promise<Buffer> {
    return await this.provider.getAsset(this.getFramePath(frameName, server));
  }

  /**
   * 根据参数 `iconName`，下载称号图标资源。
   * @param iconName - 决定根据参数 `iconName`，下载称号图标资源内容、边界或目标的 `iconName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 根据参数 `iconName`，下载称号图标资源。
   */
  async getIconBuffer(iconName: string, server: Server): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconPath(iconName, server));
  }

  /**
   * 根据参数 `baseImageName`，下载动态称号脚本资源。
   * @param baseImageName - 决定根据参数 `baseImageName`，下载动态称号脚本资源内容、边界或目标的 `baseImageName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 根据参数 `baseImageName`，下载动态称号脚本资源。
   */
  async getAnimatedScriptBuffer(
    baseImageName: string,
    server: Server,
  ): Promise<Buffer> {
    return await this.provider.getAsset(
      this.getAnimatedScriptPath(baseImageName, server),
    );
  }

  /**
   * 根据参数 `baseImageName`，下载动态称号纹理资源。
   * @param baseImageName - 决定根据参数 `baseImageName`，下载动态称号纹理资源内容、边界或目标的 `baseImageName` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 根据参数 `baseImageName`，下载动态称号纹理资源。
   */
  async getAnimatedTextureBuffer(
    baseImageName: string,
    server: Server,
  ): Promise<Buffer> {
    return await this.provider.getAsset(
      this.getAnimatedTexturePath(baseImageName, server),
    );
  }
}

export const degreeResourceRepository = new DegreeResourceRepository();
