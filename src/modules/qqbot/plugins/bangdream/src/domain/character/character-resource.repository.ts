import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { formatNumber } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';

export class CharacterResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `characterId`，获取角色远端详情。
   * @param characterId - 用于精确定位角色的标识。
   * @param update - 决定根据参数 `characterId`，获取角色远端详情内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 根据参数 `characterId`，获取角色远端详情。
   */
  async getDetail(
    characterId: number,
    update: boolean = true,
  ): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/characters/${characterId}.json`,
      { cacheTime: (() => {
        if (update) {
          return 0;
        }
        return 1 / 0;
      })() },
    );
  }

  /**
   * 根据参数 `characterId`，获取角色图标资源路径。
   * @param characterId - 用于精确定位角色的标识。
   * @returns 按参数编码并拼接完成的根据参数 `characterId`，获取角色图标资源路径。
   */
  getIconPath(characterId: number): string {
    return `/res/icon/chara_icon_${characterId}.png`;
  }

  /**
   * 根据参数 `characterId`，获取角色 KV 立绘资源路径。
   * @param characterId - 用于精确定位角色的标识。
   * @returns 按参数编码并拼接完成的根据参数 `characterId`，获取角色 KV 立绘资源路径。
   */
  getIllustrationPath(characterId: number): string {
    return `/assets/jp/ui/character_kv_image/${formatNumber(characterId, 3)}_rip/image.png`;
  }

  /**
   * 根据参数 `characterId`，获取角色名称横幅资源路径。
   * @param characterId - 用于精确定位角色的标识。
   * @returns 按参数编码并拼接完成的根据参数 `characterId`，获取角色名称横幅资源路径。
   */
  getNameBannerPath(characterId: number): string {
    return `/assets/jp/character_name_rip/name_top_chr${formatNumber(
      characterId,
      2,
    )}.png`;
  }

  /**
   * 根据参数 `characterId`，下载角色图标资源。
   * @param characterId - 用于精确定位角色的标识。
   * @returns 根据参数 `characterId`，下载角色图标资源。
   */
  async getIconBuffer(characterId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconPath(characterId));
  }

  /**
   * 根据参数 `characterId`，下载角色 KV 立绘资源。
   * @param characterId - 用于精确定位角色的标识。
   * @returns 根据参数 `characterId`，下载角色 KV 立绘资源。
   */
  async getIllustrationBuffer(characterId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getIllustrationPath(characterId));
  }

  /**
   * 根据参数 `characterId`，下载角色名称横幅资源。
   * @param characterId - 用于精确定位角色的标识。
   * @returns 根据参数 `characterId`，下载角色名称横幅资源。
   */
  async getNameBannerBuffer(characterId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getNameBannerPath(characterId));
  }
}

export const characterResourceRepository = new CharacterResourceRepository();
