import bangdreamCatalogCache from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import { Image, loadImage } from 'skia-canvas';
import { characterResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character-resource.repository';

export class Character {
  characterId: number;
  data: object;
  characterType: string;
  characterName: Array<string | null>;
  firstName: Array<string | null>;
  lastName: Array<string | null>;
  nickname: Array<string | null>;
  bandId: number;
  colorCode: string;
  sdAssetBundleName: string;
  defaultCostumeId: number;
  ruby: Array<string | null>;
  isExist: boolean = false;
  profile: {
    characterVoice: Array<string | null>;
    favoriteFood: Array<string | null>;
    hatedFood: Array<string | null>;
    hobby: Array<string | null>;
    selfIntroduction: Array<string | null>;
    school: Array<string | null>;
    schoolCls: Array<string | null>;
    schoolYear: string[];
    part: string;
    birthday: string;
    constellation: string;
    height: number;
  };
  isInitFull: boolean = false;

  constructor(characterId: number) {
    const characterData =
      bangdreamCatalogCache['characters'][characterId.toString()];
    if (characterData == undefined) {
      this.isExist = false;
      return;
    }

    this.characterId = characterId;
    this.data = characterData;
    this.characterName = this.data['characterName'];
    this.firstName = this.data['firstName'];
    this.lastName = this.data['lastName'];
    this.nickname = this.data['nickname'];
    this.bandId = this.data['bandId'];

    this.isExist = true;
  }
  /**
   * 根据`useCache`处理initFull；当 `this.isInitFull` 成立时直接结束且不产生返回值。
   * @param useCache - 决定是否启用“use缓存”分支的布尔选项；省略时默认采用 `true`。
   */
  async initFull(useCache: boolean = true) {
    if (this.isInitFull) {
      return;
    }
    if (this.isExist == false) {
      return;
    }
    this.isExist = true;
    const characterData = await this.getData(!useCache);
    this.data = characterData;
    this.characterType = characterData['characterType'];
    this.characterName = characterData['characterName'];
    this.firstName = characterData['firstName'];
    this.lastName = characterData['lastName'];
    this.nickname = characterData['nickname'];
    this.bandId = characterData['bandId'];
    this.colorCode = characterData['colorCode'];
    this.sdAssetBundleName = characterData['sdAssetBundleName'];
    this.defaultCostumeId = characterData['defaultCostumeId'];
    this.ruby = characterData['ruby'];
    this.profile = characterData['profile'];
    //修复学年类型错误
    for (let i = 0; i < this.profile.schoolYear.length; i++) {
      if (this.profile.schoolYear[i] != null) {
        this.profile.schoolYear[i] = this.profile.schoolYear[i].toString();
      }
    }

    this.isInitFull = true;
  }
  /**
   * 在 Character 模型中请求当前模型的远端详情数据。
   * @param update - 决定在 Character 模型中请求当前模型的远端详情数据内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 在 Character 模型中请求当前模型的远端详情数据。
   */
  async getData(update: boolean = true) {
    return await characterResourceRepository.getDetail(
      this.characterId,
      update,
    );
  }
  /**
   * 按当前运行态读取图标；从受控资源来源加载所需数据（`loadImage`）。
   * @returns 图标。
   */
  async getIcon(): Promise<Image> {
    const iconBuffer = await characterResourceRepository.getIconBuffer(
      this.characterId,
    );
    return await loadImage(iconBuffer);
  }
  /**
   * 按当前运行态读取Illustration；从受控资源来源加载所需数据（`loadImage`）。
   * @returns 从角色资源 Buffer 解码得到的角色立绘图片。
   */
  async getIllustration(): Promise<Image> {
    const illustrationBuffer =
      await characterResourceRepository.getIllustrationBuffer(this.characterId);
    return await loadImage(illustrationBuffer);
  }
  /**
   * 按当前运行态读取名称横幅；从受控资源来源加载所需数据（`loadImage`）。
   * @returns 名称横幅。
   */
  async getNameBanner(): Promise<Image> {
    const nameBannerBuffer =
      await characterResourceRepository.getNameBannerBuffer(this.characterId);
    return await loadImage(nameBannerBuffer);
  }
  /**
   * 按当前运行态读取角色名称。
   * @returns 按输入顺序得到的角色名称列表；没有匹配项时为空数组。
   */
  getCharacterName(): Array<string | null> {
    const characterNameList = [];
    for (let i = 0; i < this.characterName.length; i++) {
      const element = this.characterName[i];
      if (this.nickname[i] != null) {
        characterNameList.push(`${this.nickname[i]} (${element})`);
      } else {
        characterNameList.push(element);
      }
    }
    return characterNameList;
  }
}
