import { assetErrorImageBuffer } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import {
  BANGDREAM_DIFFICULTY_NAME_BY_ID,
  BANGDREAM_SERVER_CODES,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  getServerByPriority,
  Server,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import type { BestdoriNote } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-chart-preview.layout';

export interface SongJacketSource {
  jacketImage: Array<string>;
  publishedAt: Array<number | null>;
  songId: number;
}

const difficultyNameById: Record<number, string> =
  BANGDREAM_DIFFICULTY_NAME_BY_ID;

/**
 * 将服务器枚举值转换为 Bestdori 资源路径中的服务器编码。
 *
 * @param server - server 输入；限定 BangDream查询范围。
 */
function getServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class SongResourceRepository {
  /**
   * 初始化 SongResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取歌曲远端详情。
   *
   * @param songId - 歌曲 ID；定位本次读取、更新、删除或关联的歌曲。
   */
  async getDetail(songId: number): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/songs/${songId}.json`,
    );
  }

  /**
   * 获取歌曲谱面数据。
   *
   * @param songId - 歌曲 ID；定位本次读取、更新、删除或关联的歌曲。
   * @param difficultyId - BangDream ID；定位本次读取、更新、删除或关联的BangDream。
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
   * 获取歌曲封面资源批次。
   *
   * @param songId - 歌曲 ID；定位本次读取、更新、删除或关联的歌曲。
   */
  getSongRip(songId: number): number {
    return Math.ceil(songId / 10) * 10;
  }

  /**
   * 获取歌曲封面资源路径。
   *
   * @param source - source 输入；驱动 `this.getJacketServerAndRip()`、`this.getJacketImageName()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `this.getJacketServerAndRip()` 的 BangDream步骤。
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
   * 获取歌曲封面完整 URL。
   *
   * @param source - source 输入；驱动 `provider.resolveUrl()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `provider.resolveUrl()` 的 BangDream步骤。
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
   *
   * @param source - source 输入；驱动 `provider.getAsset()`、`for()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
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
   * 计算歌曲封面优先服务器和资源批次。
   *
   * @param source - source 输入；使用 `publishedAt`、`songId` 字段生成结果。
   * @param displayedServerList - displayedServerList 输入；驱动 `getServerByPriority()` 的 BangDream步骤。
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
   *
   * @param source - source 输入；使用 `songId` 字段生成结果。
   */
  private getFallbackJacketImagePaths(source: SongJacketSource): string[] {
    const jacketImageName = this.getJacketImageName(source);
    const songRip = this.getSongRip(source.songId);
    return BANGDREAM_SERVER_CODES.map((serverCode) =>
      this.buildJacketImagePath(serverCode, songRip, jacketImageName),
    );
  }

  /**
   * 拼接歌曲封面资源路径。
   *
   * @param serverCode - serverCode 输入；生成 BangDream对象。
   * @param songRip - songRip 输入；生成 BangDream对象。
   * @param jacketImageName - jacketImageName 输入；生成 BangDream对象。
   */
  private buildJacketImagePath(
    serverCode: string,
    songRip: number,
    jacketImageName: string,
  ): string {
    return `/assets/${serverCode}/musicjacket/musicjacket${songRip}_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket${songRip}-${jacketImageName}-jacket.png`;
  }

  /**
   * 获取歌曲封面资源名称。
   *
   * @param source - source 输入；使用 `jacketImage` 字段生成结果。
   */
  private getJacketImageName(source: SongJacketSource): string {
    return source.jacketImage[source.jacketImage.length - 1];
  }
}

export const songResourceRepository = new SongResourceRepository();
