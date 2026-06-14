import { bangDreamBestdoriProvider } from '@/modules/qqbot/plugins/bangDream/provider/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { formatNumber } from '@/modules/qqbot/plugins/bangDream/shared/model-utils';

export class CharacterResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取角色远端详情。
   *
   * @param characterId - 角色 ID。
   * @param update - 是否绕过缓存。
   */
  async getDetail(
    characterId: number,
    update: boolean = true,
  ): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/characters/${characterId}.json`,
      { cacheTime: update ? 0 : 1 / 0 },
    );
  }

  /**
   * 获取角色图标资源路径。
   *
   * @param characterId - 角色 ID。
   */
  getIconPath(characterId: number): string {
    return `/res/icon/chara_icon_${characterId}.png`;
  }

  /**
   * 获取角色 KV 立绘资源路径。
   *
   * @param characterId - 角色 ID。
   */
  getIllustrationPath(characterId: number): string {
    return `/assets/jp/ui/character_kv_image/${formatNumber(characterId, 3)}_rip/image.png`;
  }

  /**
   * 获取角色名称横幅资源路径。
   *
   * @param characterId - 角色 ID。
   */
  getNameBannerPath(characterId: number): string {
    return `/assets/jp/character_name_rip/name_top_chr${formatNumber(
      characterId,
      2,
    )}.png`;
  }

  /**
   * 下载角色图标资源。
   *
   * @param characterId - 角色 ID。
   */
  async getIconBuffer(characterId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getIconPath(characterId));
  }

  /**
   * 下载角色 KV 立绘资源。
   *
   * @param characterId - 角色 ID。
   */
  async getIllustrationBuffer(characterId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getIllustrationPath(characterId));
  }

  /**
   * 下载角色名称横幅资源。
   *
   * @param characterId - 角色 ID。
   */
  async getNameBannerBuffer(characterId: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getNameBannerPath(characterId));
  }
}

export const characterResourceRepository = new CharacterResourceRepository();
