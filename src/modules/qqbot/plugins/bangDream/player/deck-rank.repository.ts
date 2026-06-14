import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import { bangDreamBestdoriProvider } from '@/modules/qqbot/plugins/bangDream/provider/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { assetsRootPath } from '@/modules/qqbot/plugins/bangDream/config/runtime-config';

export class DeckRankResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
    private readonly localRankRootPath: string = path.join(
      assetsRootPath,
      'Rank',
    ),
  ) {}

  /**
   * 获取本地乐队编成等级图片路径。
   *
   * @param rankImageName - Rank 图片名称。
   */
  getLocalRankImagePath(rankImageName: string): string {
    return path.join(this.localRankRootPath, `${rankImageName}.png`);
  }

  /**
   * 获取远端乐队编成等级图片路径。
   *
   * @param rankImageName - Rank 图片名称。
   */
  getRemoteRankImagePath(rankImageName: string): string {
    return `/res/icon/${rankImageName}.png`;
  }

  /**
   * 读取乐队编成等级图片，优先本地素材，缺失时回退到 Bestdori 资源。
   *
   * @param rankImageName - Rank 图片名称。
   */
  async getRankImageBuffer(rankImageName: string): Promise<Buffer> {
    const localImagePath = this.getLocalRankImagePath(rankImageName);
    if (existsSync(localImagePath)) {
      return readFileSync(localImagePath);
    }
    return await this.provider.getAsset(
      this.getRemoteRankImagePath(rankImageName),
    );
  }
}

export const deckRankResourceRepository = new DeckRankResourceRepository();
