import { assetErrorImageBuffer } from '@/modules/plugins/bangdream/src/theme/canvas-image';
import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import {
  BANGDREAM_DIFFICULTY_NAME_BY_ID,
  BANGDREAM_SERVER_CODES,
} from '@/modules/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  getServerByPriority,
  Server,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import type { BestdoriNote } from '@/modules/plugins/bangdream/src/domain/song/song-chart-preview.layout';

export interface SongJacketSource {
  jacketImage: Array<string>;
  publishedAt: Array<number | null>;
  songId: number;
}

const difficultyNameById: Record<number, string> =
  BANGDREAM_DIFFICULTY_NAME_BY_ID;

/**
 * 将服务器枚举值转换为 Bestdori 资源路径中的服务器编码。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 当前状态对应的将服务器枚举值转换为 Bestdori 资源路径中的服务器编码，取值为 `'undefined'`；没有可用结果或提前结束时为 `undefined`。
 */
function getServerCode(server: Server | undefined): string {
  if (server == null) {
    return 'undefined';
  }
  return Server[server];
}

export class SongResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `songId`，获取歌曲远端详情。
   * @param songId - 用于精确定位歌曲的标识。
   * @returns 根据参数 `songId`，获取歌曲远端详情。
   */
  async getDetail(songId: number): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/songs/${songId}.json`,
    );
  }

  /**
   * 根据参数 `songId`，获取歌曲谱面数据。
   * @param songId - 用于精确定位歌曲的标识。
   * @param difficultyId - 用于精确定位难度的标识。
   * @returns 按输入顺序得到的根据参数 `songId`，获取歌曲谱面数据列表；没有匹配项时为空数组。
   */
  async getChart(
    songId: number,
    difficultyId: number,
  ): Promise<BestdoriNote[]> {
    return await this.provider.getJson<BestdoriNote[]>(
      `/api/charts/${songId}/${difficultyNameById[difficultyId]}.json`,
    );
  }

  /**
   * 根据参数 `songId`，获取歌曲封面资源批次。
   * @param songId - 用于精确定位歌曲的标识。
   * @returns 根据参数 `songId`，获取歌曲封面资源批次。
   */
  getSongRip(songId: number): number {
    return Math.ceil(songId / 10) * 10;
  }

  /**
   * 根据参数 `source`，获取歌曲封面资源路径。
   * @param source - 决定根据参数 `source`，获取歌曲封面资源路径内容、边界或目标的 `source` 值。
   * @param displayedServerList - 决定根据参数 `source`，获取歌曲封面资源路径内容、边界或目标的 `displayedServerList` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 根据参数 `source`，获取歌曲封面资源路径。
   */
  getJacketImagePath(
    source: SongJacketSource,
    displayedServerList?: Server[],
  ): string {
    const { server, songRip } = this.getJacketServerAndRip(
      source,
      displayedServerList,
    );
    const jacketImageName = this.getJacketImageName(source).toLowerCase();
    return this.buildJacketImagePath(
      getServerCode(server),
      songRip,
      jacketImageName,
    );
  }

  /**
   * 根据参数 `source`，获取歌曲封面完整 URL。
   * @param source - 决定根据参数 `source`，获取歌曲封面完整 URL内容、边界或目标的 `source` 值。
   * @param displayedServerList - 决定根据参数 `source`，获取歌曲封面完整 URL内容、边界或目标的 `displayedServerList` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 根据参数 `source`，获取歌曲封面完整 URL。
   */
  resolveJacketImageUrl(
    source: SongJacketSource,
    displayedServerList?: Server[],
  ): string {
    return this.provider.resolveUrl(
      this.getJacketImagePath(source, displayedServerList),
    );
  }

  /**
   * 下载歌曲封面 Buffer，并在缺失时按服务器顺序回退。
   * @param source - 决定Jacket图片缓冲区内容、边界或目标的 `source` 值。
   * @param displayedServerList - 决定Jacket图片缓冲区内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `[Server.jp, Server.cn]`。
   * @returns Jacket图片缓冲区。
   */
  async getJacketImageBuffer(
    source: SongJacketSource,
    displayedServerList: Server[] = [Server.jp, Server.cn],
  ): Promise<Buffer> {
    let jacketImageBuffer = await this.provider.getAsset(
      this.getJacketImagePath(source, displayedServerList),
      { memoryCache: false },
    );
    if (!jacketImageBuffer.equals(assetErrorImageBuffer)) {
      return jacketImageBuffer;
    }

    for (const retryPath of this.getFallbackJacketImagePaths(source)) {
      jacketImageBuffer = await this.provider.getAsset(retryPath, {
        ignoreError: true,
        memoryCache: false,
        retryCount: 1,
      });
      if (!jacketImageBuffer.equals(assetErrorImageBuffer)) break;
    }
    return jacketImageBuffer;
  }

  /**
   * 根据参数 `source`，计算歌曲封面优先服务器和资源批次。
   * @param source - 用于根据参数 `source`，计算歌曲封面优先服务器和资源批次的领域对象，包含 `publishedAt`、`songId` 字段。
   * @param displayedServerList - 决定根据参数 `source`，计算歌曲封面优先服务器和资源批次内容、边界或目标的 `displayedServerList` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 包含 `server`、`songRip` 字段的根据参数 `source`，计算歌曲封面优先服务器和资源批次。
   */
  private getJacketServerAndRip(
    source: SongJacketSource,
    displayedServerList?: Server[],
  ): { server: Server | undefined; songRip: number } {
    let server = getServerByPriority(source.publishedAt, displayedServerList);
    let songRip = this.getSongRip(source.songId);
    if (source.songId === 13 || source.songId === 40) {
      songRip = 30;
    } else if (source.songId === 273) {
      server = Server.cn;
    }
    return { server, songRip };
  }

  /**
   * 获取歌曲封面缺失时的服务器回退路径列表。
   * @param source - 用于歌曲封面缺失时的服务器回退路径列表的领域对象，包含 `songId` 字段。
   * @returns 按输入顺序得到的歌曲封面缺失时的服务器回退路径列表；没有匹配项时为空数组。
   */
  private getFallbackJacketImagePaths(source: SongJacketSource): string[] {
    const jacketImageName = this.getJacketImageName(source);
    const songRip = this.getSongRip(source.songId);
    return BANGDREAM_SERVER_CODES.map((serverCode) =>
      this.buildJacketImagePath(serverCode, songRip, jacketImageName),
    );
  }

  /**
   * 根据参数 `serverCode`，拼接歌曲封面资源路径。
   * @param serverCode - 决定根据参数 `serverCode`，拼接歌曲封面资源路径内容、边界或目标的 `serverCode` 值。
   * @param songRip - 决定根据参数 `serverCode`，拼接歌曲封面资源路径内容、边界或目标的 `songRip` 值。
   * @param jacketImageName - 决定根据参数 `serverCode`，拼接歌曲封面资源路径内容、边界或目标的 `jacketImageName` 值。
   * @returns 按参数编码并拼接完成的根据参数 `serverCode`，拼接歌曲封面资源路径。
   */
  private buildJacketImagePath(
    serverCode: string,
    songRip: number,
    jacketImageName: string,
  ): string {
    return `/assets/${serverCode}/musicjacket/musicjacket${songRip}_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket${songRip}-${jacketImageName}-jacket.png`;
  }

  /**
   * 根据参数 `source`，获取歌曲封面资源名称。
   * @param source - 用于根据参数 `source`，获取歌曲封面资源名称的领域对象，包含 `jacketImage` 字段。
   * @returns 根据参数 `source`，获取歌曲封面资源名称。
   */
  private getJacketImageName(source: SongJacketSource): string {
    return source.jacketImage[source.jacketImage.length - 1];
  }
}

export const songResourceRepository = new SongResourceRepository();
