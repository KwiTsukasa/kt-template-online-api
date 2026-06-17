import * as path from 'node:path';

import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { assetsRootPath } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { readBangDreamAsset } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

export class DeckRankResourceRepository {
  /**
   * 初始化 DeckRankResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   * @param localRankRootPath - BangDream路径；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
    private readonly localRankRootPath: string = path.join(
      assetsRootPath,
      'Rank',
    ),
  ) {}

  /**
   * 获取本地乐队编成等级图片路径。
   *
   * @param rankImageName - rankImageName 输入；限定 BangDream查询范围。
   */
  getLocalRankImagePath(rankImageName: string): string {
    return path.join(this.localRankRootPath, `${rankImageName}.png`);
  }

  /**
   * 获取远端乐队编成等级图片路径。
   *
   * @param rankImageName - rankImageName 输入；限定 BangDream查询范围。
   */
  getRemoteRankImagePath(rankImageName: string): string {
    return `/res/icon/${rankImageName}.png`;
  }

  /**
   * 读取乐队编成等级图片，优先本地素材，缺失时回退到 Bestdori 资源。
   *
   * @param rankImageName - rankImageName 输入；驱动 `this.getLocalRankImagePath()`、`provider.getAsset()` 的 BangDream步骤。
   */
  async getRankImageBuffer(rankImageName: string): Promise<Buffer> {
    const localImagePath = this.getLocalRankImagePath(rankImageName);
    try {
      return await readBangDreamAsset(localImagePath);
    } catch {
      return await this.provider.getAsset(
        this.getRemoteRankImagePath(rankImageName),
      );
    }
  }
}

export const deckRankResourceRepository = new DeckRankResourceRepository();
