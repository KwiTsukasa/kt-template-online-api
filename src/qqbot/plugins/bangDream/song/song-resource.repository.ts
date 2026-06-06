import { assetErrorImageBuffer } from '@/qqbot/plugins/bangDream/theme/canvas-image';
import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/provider/bestdori.provider';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import {
  BANGDREAM_DIFFICULTY_NAME_BY_ID,
  BANGDREAM_SERVER_CODES,
} from '@/qqbot/plugins/bangDream/shared/bangdream-constants';
import {
  getServerByPriority,
  Server,
} from '@/qqbot/plugins/bangDream/catalog/server.model';
import type { BestdoriNote } from '@/qqbot/plugins/bangDream/song/song-chart-preview.layout';

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
 * @param server - 服务器枚举值。
 */
function getServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class SongResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取歌曲远端详情。
   *
   * @param songId - 歌曲 ID。
   */
  async getDetail(songId: number): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/songs/${songId}.json`,
    );
  }

  /**
   * 获取歌曲谱面数据。
   *
   * @param songId - 歌曲 ID。
   * @param difficultyId - 难度 ID。
   */
  async getChart(songId: number, difficultyId: number): Promise<BestdoriNote[]> {
    return await this.provider.getJson<BestdoriNote[]>(
      `/api/charts/${songId}/${difficultyNameById[difficultyId]}.json`,
    );
  }

  /**
   * 获取歌曲封面资源批次。
   *
   * @param songId - 歌曲 ID。
   */
  getSongRip(songId: number): number {
    return Math.ceil(songId / 10) * 10;
  }

  /**
   * 获取歌曲封面资源路径。
   *
   * @param source - 歌曲封面来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
   * @param source - 歌曲封面来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
   * @param source - 歌曲封面来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
   * @param source - 歌曲封面来源字段。
   * @param displayedServerList - 可展示服务器优先级。
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
   * @param source - 歌曲封面来源字段。
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
   * @param serverCode - Bestdori 服务器编码。
   * @param songRip - 歌曲资源批次。
   * @param jacketImageName - 封面资源名称。
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
   * @param source - 歌曲封面来源字段。
   */
  private getJacketImageName(source: SongJacketSource): string {
    return source.jacketImage[source.jacketImage.length - 1];
  }
}

export const songResourceRepository = new SongResourceRepository();
