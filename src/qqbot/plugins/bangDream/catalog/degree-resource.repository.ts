import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/provider/bestdori.provider';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';

const LEGACY_ANIMATED_TEXTURE_NAMES = new Set([
  'ani_degree_bilibili_day1',
  'ani_degree_bilibili_092701',
  'ani_degree_bilibili_collabo',
  'ani_degree_bilibili_6years',
]);

export class DegreeResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取称号缩略图资源路径。
   *
   * @param baseImageName - 称号基础图片名。
   * @param server - 目标服务器。
   */
  getThumbnailPath(baseImageName: string, server: Server): string {
    return `/assets/${Server[server]}/thumb/degree_rip/${baseImageName}.png`;
  }

  /**
   * 获取新版称号缩略图兜底资源路径。
   *
   * @param baseImageName - 称号基础图片名。
   * @param server - 目标服务器。
   */
  getFallbackThumbnailPath(baseImageName: string, server: Server): string {
    return `/assets/${Server[server]}/thumb/degree_rip/assets-star-forassetbundle-startapp-thumbnail-degree-${baseImageName}.png`;
  }

  /**
   * 获取称号框资源路径。
   *
   * @param frameName - 称号框资源名。
   * @param server - 目标服务器。
   */
  getFramePath(frameName: string, server: Server): string {
    return `/assets/${Server[server]}/thumb/degree_rip/${frameName}.png`;
  }

  /**
   * 获取称号图标资源路径。
   *
   * @param iconName - 称号图标资源名。
   * @param server - 目标服务器。
   */
  getIconPath(iconName: string, server: Server): string {
    return `/assets/${Server[server]}/thumb/degree_rip/${iconName}.png`;
  }

  /**
   * 获取动态称号脚本资源路径。
   *
   * @param baseImageName - 称号基础图片名。
   * @param server - 目标服务器。
   */
  getAnimatedScriptPath(baseImageName: string, server: Server): string {
    return `/assets/${Server[server]}/${baseImageName}_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-${baseImageName}-${baseImageName}.asset`;
  }

  /**
   * 获取动态称号纹理资源路径。
   *
   * @param baseImageName - 称号基础图片名。
   * @param server - 目标服务器。
   */
  getAnimatedTexturePath(baseImageName: string, server: Server): string {
    const fileName = LEGACY_ANIMATED_TEXTURE_NAMES.has(baseImageName)
      ? `${baseImageName}.png`
      : `assets-star-forassetbundle-startapp-thumbnail-animedegree-${baseImageName}-${baseImageName}.png`;
    return `/assets/${Server[server]}/${baseImageName}_rip/${fileName}`;
  }

  /**
   * 下载称号缩略图资源，缺失时回退到新版统一路径。
   *
   * @param baseImageName - 称号基础图片名。
   * @param server - 目标服务器。
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
   * 下载称号框资源。
   *
   * @param frameName - 称号框资源名。
   * @param server - 目标服务器。
   */
  async getFrameBuffer(frameName: string, server: Server): Promise<Buffer> {
    return await this.provider.getAsset(this.getFramePath(frameName, server));
  }

  /**
   * 下载称号图标资源。
   *
   * @param iconName - 称号图标资源名。
   * @param server - 目标服务器。
   */
  async getIconBuffer(iconName: string, server: Server): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconPath(iconName, server));
  }

  /**
   * 下载动态称号脚本资源。
   *
   * @param baseImageName - 称号基础图片名。
   * @param server - 目标服务器。
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
   * 下载动态称号纹理资源。
   *
   * @param baseImageName - 称号基础图片名。
   * @param server - 目标服务器。
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
