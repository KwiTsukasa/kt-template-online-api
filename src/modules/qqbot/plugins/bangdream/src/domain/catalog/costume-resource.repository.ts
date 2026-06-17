import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import {
  getServerByPriority,
  Server,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';

export interface CostumeSdResourceSource {
  publishedAt: Array<number | null>;
  sdResourceName: string;
}

/**
 * 执行 BangDream 插件流程。
 * @param server - server 输入；影响 toServerCode 的返回值。
 * @returns BangDream 插件渲染后的图片、画布或文本。
 */
function toServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class CostumeResourceRepository {
  /**
   * 初始化 CostumeResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取服装详情。
   *
   * @param costumeId - BangDream ID；定位本次读取、更新、删除或关联的BangDream。
   */
  async getDetail(costumeId: number): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/costumes/${costumeId}.json`,
    );
  }

  /**
   * 获取 Live2D 缩略图资源路径。
   *
   * @param source - source 输入；使用 `publishedAt`、`sdResourceName` 字段生成结果。
   * @param displayedServerList - displayedServerList 输入；驱动 `toServerCode()` 的 BangDream步骤。
   */
  getSdCharacterPath(
    source: CostumeSdResourceSource,
    displayedServerList: Server[] = globalDefaultServer,
  ): string {
    const serverCode = toServerCode(
      getServerByPriority(source.publishedAt, displayedServerList),
    );
    return `/assets/${serverCode}/characters/livesd/${source.sdResourceName}_rip/sdchara.png`;
  }

  /**
   * 下载 Live2D 缩略图资源。
   *
   * @param source - source 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   */
  async getSdCharacterBuffer(
    source: CostumeSdResourceSource,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Buffer> {
    return await this.provider.getAsset(
      this.getSdCharacterPath(source, displayedServerList),
      { memoryCache: false },
    );
  }
}

export const costumeResourceRepository = new CostumeResourceRepository();
