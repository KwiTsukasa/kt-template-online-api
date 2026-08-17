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
 * 将`server`转换为服务器代码；当 `server == null` 成立时返回 `'undefined'`。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 当前状态对应的服务器代码，取值为 `'undefined'`；没有可用结果或提前结束时为 `undefined`。
 */
function toServerCode(server: Server | undefined): string {
  if (server == null) {
    return 'undefined';
  }
  return Server[server];
}

export class CostumeResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `costumeId`，查询并返回服装详情。
   * @param costumeId - 用于精确定位costume的标识。
   * @returns 根据参数 `costumeId`，查询并返回服装详情。
   */
  async getDetail(costumeId: number): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/costumes/${costumeId}.json`,
    );
  }

  /**
   * 根据参数 `source`，获取 Live2D 缩略图资源路径。
   * @param source - 用于根据参数 `source`，获取 Live2D 缩略图资源路径的领域对象，包含 `publishedAt`、`sdResourceName` 字段。
   * @param displayedServerList - 决定根据参数 `source`，获取 Live2D 缩略图资源路径内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 按参数编码并拼接完成的根据参数 `source`，获取 Live2D 缩略图资源路径。
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
   * 根据服装资源来源解析 Live2D 缩略图路径，并从资源提供器下载二进制内容。
   * @param source - 决定Sd角色缓冲区内容、边界或目标的 `source` 值。
   * @param displayedServerList - 决定Sd角色缓冲区内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns Sd角色缓冲区。
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
