import * as path from 'node:path';

import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { assetsRootPath } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { readBangDreamAsset } from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';

export class DeckRankResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
    private readonly localRankRootPath: string = path.join(
      assetsRootPath,
      'Rank',
    ),
  ) {}

  /**
   * 根据参数 `rankImageName`，获取本地乐队编成等级图片路径。
   * @param rankImageName - 决定根据参数 `rankImageName`，获取本地乐队编成等级图片路径内容、边界或目标的 `rankImageName` 值。
   * @returns 根据参数 `rankImageName`，获取本地乐队编成等级图片路径。
   */
  getLocalRankImagePath(rankImageName: string): string {
    return path.join(this.localRankRootPath, `${rankImageName}.png`);
  }

  /**
   * 根据参数 `rankImageName`，获取远端乐队编成等级图片路径。
   * @param rankImageName - 决定根据参数 `rankImageName`，获取远端乐队编成等级图片路径内容、边界或目标的 `rankImageName` 值。
   * @returns 按参数编码并拼接完成的根据参数 `rankImageName`，获取远端乐队编成等级图片路径。
   */
  getRemoteRankImagePath(rankImageName: string): string {
    return `/res/icon/${rankImageName}.png`;
  }

  /**
   * 读取乐队编成等级图片，优先本地素材，缺失时回退到 Bestdori 资源。
   * @param rankImageName - 决定乐队编成等级图片，优先本地素材，缺失时回退到 Bestdori 资源内容、边界或目标的 `rankImageName` 值。
   * @returns 乐队编成等级图片，优先本地素材，缺失时回退到 Bestdori 资源。
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
