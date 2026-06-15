import { bangDreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
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

function toServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class CostumeResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取服装详情。
   *
   * @param costumeId - 服装 ID。
   */
  async getDetail(costumeId: number): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/costumes/${costumeId}.json`,
    );
  }

  /**
   * 获取 Live2D 缩略图资源路径。
   *
   * @param source - 服装资源来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
   * @param source - 服装资源来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
