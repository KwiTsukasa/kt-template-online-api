import { Skill } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/skill.model';
import { Character } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character.model';
import {
  Server,
  getServerByPriority,
  serverList,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { Gacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { Image, loadImage } from 'skia-canvas';
import { bangdreamCatalogRepository } from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { stringToNumberArray } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import { BANGDREAM_CARD_TYPE_NAME } from '@/modules/qqbot/plugins/bangdream/src/config/dictionary/default-dictionary';
import { cardResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-resource.repository';

export interface Stat {
  //综合力
  performance: number;
  technique: number;
  visual: number;
}

const typeName: Record<string, string> = BANGDREAM_CARD_TYPE_NAME;

/**
 * 将本次操作写入 `stat.performance`、`stat.technique`、`stat.visual` 状态。
 * @param stat - 用于统计值的领域对象，包含 `performance`、`technique`、`visual` 字段。
 * @param add - 用于统计值的领域对象，包含 `performance`、`technique`、`visual` 字段。
 */
export function addStat(stat: Stat, add: Stat): void {
  //综合力相加函数
  stat.performance += add.performance;
  stat.technique += add.technique;
  stat.visual += add.visual;
}

/**
 * 根据`rarity`处理limitBreak排名统计值。
 * @param rarity - 决定卡牌边框、星级数量与资源名称的稀有度。
 * @returns limitBreak排名统计值。
 */
function limitBreakRankStat(rarity: number) {
  //不同稀有度突破一级增加的属性
  const tempStat: Stat = {
    performance: 50 * rarity,
    technique: 50 * rarity,
    visual: 50 * rarity,
  };
  return tempStat;
}

export class Card {
  cardId: number;
  isExist: boolean = false;

  data: object;
  characterId: number;
  rarity: number;
  type: string; //'initial'|'permanent'|'limited'|'birthday'|'event'|'others'|'dreamfes'|'kirafes';
  attribute: 'cool' | 'happy' | 'pure' | 'powerful';
  levelLimit: number;
  resourceSetName: string;
  sdResourceName: string;
  costumeId: number;
  gachaText: Array<string | null>;
  prefix: Array<string | null>;
  releasedAt: Array<number | null>;
  skillName: Array<string | null>;
  source: Array<
    | {
        [type: string]: {
          [id: string]: object;
        };
      }
    | Record<string, never>
  >;
  skillId: number;
  isInitFull: boolean = false;
  stat: object;
  bandId: number;

  //other
  skillType: string;
  scoreUpMaxValue: number;
  releaseGacha: Array<Array<number>>;
  releaseEvent: Array<Array<number>>;

  constructor(cardId: number) {
    this.cardId = cardId;
    const cardData = bangdreamCatalogRepository.getEntity<Record<string, any>>(
      'cards',
      cardId,
    );
    if (cardData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.data = cardData;
    this.characterId = cardData['characterId'];
    this.bandId = new Character(this.characterId).bandId;
    this.rarity = cardData['rarity'];
    this.type = cardData['type'];
    this.attribute = cardData['attribute'];
    this.levelLimit = cardData['levelLimit'];
    this.resourceSetName = cardData['resourceSetName'];
    this.prefix = cardData['prefix'];
    this.releasedAt = stringToNumberArray(cardData['releasedAt']);
    this.skillId = cardData['skillId'];
    this.stat = cardData['stat'];
    const skill = new Skill(this.skillId);
    this.skillType = skill.effectTypes[0];
    this.scoreUpMaxValue = skill.scoreUpMaxValue;
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
    const cardData = await this.getData(!useCache);
    this.isInitFull = true;
    this.data = cardData;
    /*
        this.characterId = cardData['characterId']
        this.rarity = cardData['rarity']
        this.type = cardData['type']
        this.attribute = cardData['attribute']
        this.levelLimit = cardData['levelLimit']
        this.resourceSetName = cardData['resourceSetName']
        this.prefix = cardData['prefix']
        this.releasedAt =  stringToNumberArray(cardData['releasedAt'])
        */
    this.sdResourceName = cardData['sdResourceName'];
    this.costumeId = cardData['costumeId'];
    this.gachaText = cardData['gachaText'];

    this.source = cardData['source'];
    //修复国服releaseAt错误问题,将国服的releaseAt改为卡池或活动的开始时间
    const Cnserver = Server.cn;
    this.getSource();
    if (this.releaseEvent[Cnserver].length != 0) {
      this.releasedAt[Cnserver] = new Event(
        this.releaseEvent[Cnserver][0],
      ).startAt[Cnserver];
    } else if (this.releaseGacha[Cnserver].length != 0) {
      const earlistGacha = new Gacha(this.releaseGacha[Cnserver][0]);
      this.releasedAt[Cnserver] = earlistGacha.publishedAt[Cnserver];
    }

    this.skillName = cardData['skillName'];
    this.skillId = cardData['skillId'];
    this.stat = cardData['stat'];

    this.isInitFull = true;
  }
  /**
   * 在 Card 模型中请求当前模型的远端详情数据。
   * @param update - 决定在 Card 模型中请求当前模型的远端详情数据内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 在 Card 模型中请求当前模型的远端详情数据。
   */
  async getData(update: boolean = true) {
    return await cardResourceRepository.getDetail(this.cardId, update);
  }

  /**
   * 根据`trainingStatus`处理在 Card 模型中处理ableToTraining；当 `this.rarity < 3` 成立时返回 `false`。
   * @param trainingStatus - 决定在 Card 模型中处理ableToTraining内容、边界或目标的 `trainingStatus` 值；为空时采用 `true` 作为兜底。
   * @returns 满足在 Card 模型中处理ableToTraining约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  ableToTraining(trainingStatus?: boolean): boolean {
    //判断是否能够进行特训
    if (this.rarity < 3) {
      return false;
    }
    if (
      this.stat['training']['performance'] == 0 &&
      this.stat['training']['technique'] == 0 &&
      this.stat['training']['visual'] == 0
    ) {
      //如果没有特训数据，因为有levelLimit，所以只能这么写
      return true;
    }
    return trainingStatus ?? true;
  }
  /**
   * 按当前运行态读取Training状态；当 `this.rarity < 3` 成立时返回 `trainingStatusList`。
   * @returns 按输入顺序得到的Training状态列表；没有匹配项时为空数组。
   */
  getTrainingStatusList(): Array<boolean> {
    //判断是否能够进行特训
    const trainingStatusList = [];
    if (this.rarity < 3) {
      trainingStatusList.push(false);
      return trainingStatusList;
    }
    if (
      this.stat['training']['performance'] == 0 &&
      this.stat['training']['technique'] == 0 &&
      this.stat['training']['visual'] == 0
    ) {
      //如果没有特训数据，因为有levelLimit，所以只能这么写
      trainingStatusList.push(true);
      return trainingStatusList;
    }
    return [false, true];
  }

  //计算综合力函数
  // async calcStat(level?: number, trainingStatus: boolean = false, limitBreakRank: number = 0, episode1: boolean = true, episode2: boolean = true, ) {
  //     if (!this.isInitFull) {
  //         //如果不是默认情况(带有level以外的参数)，加载完整数据，其中包含完整综合力数据
  //         /*
  //         if (trainingStatus != undefined || limitBreakRank != undefined || episode1 != undefined || episode2 != undefined) {
  //             await this.initFull()
  //         }
  //         */
  //         await this.initFull()

  //     }
  //     const stat: Stat = {
  //         performance: 0,
  //         technique: 0,
  //         visual: 0
  //     }

  //     let maxLevel = this.getMaxLevel()
  //     level ??= maxLevel//如果没有等级参数，则默认为最大等级
  //     if (level > maxLevel) {//等级超过上限,按上限计算
  //         level = maxLevel
  //     }
  //     if (this.ableToTraining()) {//如果能够进行特训
  //         if (level > this.levelLimit) {//如果等级超过需要特训等级，则默认已经特训
  //             trainingStatus = true
  //         }
  //     }

  //     addStat(stat, this.stat[level.toString()])//加上等级对应的属性

  //     if (trainingStatus) {//如果已经特训
  //         addStat(stat, this.stat['training'])
  //     }
  //     if (this.stat['episodes'] != undefined) {//如果有剧情
  //         if (episode1) {//如果已经阅读剧情1
  //             addStat(stat, this.stat['episodes'][0])
  //         }
  //         if (episode2) {//如果已经阅读剧情2
  //             addStat(stat, this.stat['episodes'][1])
  //         }
  //     }

  //     if (limitBreakRank > 0) {
  //         for (let i = 1; i <= limitBreakRank; i++) {
  //             addStat(stat, limitBreakRankStat(this.rarity))
  //         }
  //     }
  //     return stat
  // }
  /**
   * 根据指定或最高等级取得卡牌属性；用户卡追加潜能加成，模板卡则追加特训与剧情加成。
   * @param cardData - 用于根据指定或最高等级取得卡牌属性的领域对象，包含 `level`、`userAppendParameter` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 根据指定或最高等级取得卡牌属性。
   */
  async calcStat(cardData?) {
    if (!this.isInitFull) {
      await this.initFull();
    }
    const level = (() => {
      if (cardData) {
        return cardData.level;
      }
      return this.getMaxLevel();
    })();
    const stat = this.stat[level.toString()];
    if (cardData) {
      if (cardData.userAppendParameter) {
        const userAppend = cardData.userAppendParameter;
        const appendStat: Stat = {
          performance:
            userAppend.performance +
            (userAppend.characterPotentialPerformance || 0) +
            (userAppend.characterBonusPerformance || 0),
          technique:
            userAppend.technique +
            (userAppend.characterPotentialTechnique || 0) +
            (userAppend.characterBonusTechnique || 0),
          visual:
            userAppend.visual +
            (userAppend.characterPotentialVisual || 0) +
            (userAppend.characterBonusVisual || 0),
        };
        addStat(stat, appendStat);
      }
      return stat;
    }
    if (this.stat['training'] != undefined) {
      //如果可以特训
      addStat(stat, this.stat['training']);
    }
    if (this.stat['episodes'] != undefined) {
      //如果有剧情
      addStat(stat, this.stat['episodes'][0]);
      addStat(stat, this.stat['episodes'][1]);
    }

    return stat;
  }
  /**
   * 按当前运行态读取Skill。
   * @returns 完成初始化并携带当前边界配置的Skill。
   */
  getSkill(): Skill {
    return new Skill(this.skillId);
  }
  /**
   * 根据 `true` 判定输入是否满足条件。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 满足根据 `true` 判定输入是否满足条件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isReleased(server: Server): boolean {
    //确定是否在该服务器发布
    if (this.releasedAt[server] == null) {
      return false;
    }
    return true;
  }
  /**
   * 按`displayedServerList`读取Released服务器；从 `getServerByPriority` 读取Released服务器。
   * @param displayedServerList - 决定Released服务器内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns Released服务器。
   */
  getFirstReleasedServer(
    displayedServerList: Server[] = globalDefaultServer,
  ): Server {
    //获得确保已经发布了的服务器
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    return getServerByPriority(this.releasedAt, displayedServerList);
  }
  /**
   * 按当前运行态读取Rip；从 `cardResourceRepository.getRip` 读取Rip。
   * @returns 当前卡牌标识对应的裁切资源路径或地址。
   */
  getRip(): string {
    return cardResourceRepository.getRip(this.cardId);
  }
  /**
   * 按`trainingStatus`读取卡牌图标图片；从受控资源来源加载所需数据（`cardResourceRepository.getImageBuffer`）。
   * @param trainingStatus - 决定卡牌图标图片内容、边界或目标的 `trainingStatus` 值。
   * @returns 卡牌图标图片。
   */
  async getCardIconImage(trainingStatus: boolean): Promise<Image> {
    trainingStatus = this.ableToTraining(trainingStatus);
    const cardIconImageBuffer = await cardResourceRepository.getImageBuffer(
      this,
      'icon',
      trainingStatus,
    );
    return await loadImage(cardIconImageBuffer);
  }
  /**
   * 按`trainingStatus`读取卡牌Illustration图片；从受控资源来源加载所需数据（`cardResourceRepository.getImageBuffer`）。
   * @param trainingStatus - 决定卡牌Illustration图片内容、边界或目标的 `trainingStatus` 值。
   * @returns 卡牌Illustration图片。
   */
  async getCardIllustrationImage(trainingStatus: boolean): Promise<Image> {
    trainingStatus = this.ableToTraining(trainingStatus);
    const cardIllustrationImageBuffer =
      await cardResourceRepository.getImageBuffer(
        this,
        'illustration',
        trainingStatus,
      );
    return await loadImage(cardIllustrationImageBuffer);
  }
  /**
   * 按`trainingStatus`读取卡牌Illustration图片缓冲区；从受控资源来源加载所需数据（`cardResourceRepository.getImageBuffer`）。
   * @param trainingStatus - 决定卡牌Illustration图片缓冲区内容、边界或目标的 `trainingStatus` 值。
   * @returns 卡牌Illustration图片缓冲区。
   */
  async getCardIllustrationImageBuffer(
    trainingStatus: boolean,
  ): Promise<Buffer> {
    trainingStatus = this.ableToTraining(trainingStatus);
    return await cardResourceRepository.getImageBuffer(
      this,
      'illustration',
      trainingStatus,
    );
  }
  /**
   * 按`trainingStatus`读取卡牌Trim图片；从受控资源来源加载所需数据（`cardResourceRepository.getImageBuffer`）。
   * @param trainingStatus - 决定卡牌Trim图片内容、边界或目标的 `trainingStatus` 值。
   * @returns 卡牌Trim图片。
   */
  async getCardTrimImage(trainingStatus: boolean): Promise<Image> {
    trainingStatus = this.ableToTraining(trainingStatus);
    const cardIllustrationImageBuffer =
      await cardResourceRepository.getImageBuffer(this, 'trim', trainingStatus);
    return await loadImage(cardIllustrationImageBuffer);
  }
  /**
   * 按当前运行态读取Type名称；当 `typeName[this.type] == undefined` 成立时返回 `this.type`。
   * @returns Type名称。
   */
  getTypeName() {
    if (typeName[this.type] == undefined) {
      return this.type;
    }
    return typeName[this.type];
  }
  /**
   * 通过 `isNaN` 判断输入是否满足函数约束。
   * @returns 最大Level。
   */
  getMaxLevel(): number {
    let maxLevel = 0;
    for (const i in this.stat) {
      if (Object.prototype.hasOwnProperty.call(this.stat, i)) {
        if (!isNaN(Number(i))) {
          if (Number(i) > maxLevel) {
            maxLevel = Number(i);
          }
        }
      }
    }
    return maxLevel;
  }
  /**
   * 按当前运行态读取来源。
   */
  async getSource() {
    if (!this.isInitFull) {
      await this.initFull();
    }
    const releaseEvent: Array<Array<number>> = [];
    const releaseGacha: Array<Array<number>> = [];
    for (let k = 0; k < serverList.length; k++) {
      const server = serverList[k];
      const sourceOfServer = this.source[server];
      if (sourceOfServer['event'] != undefined) {
        releaseEvent.push(Object.keys(sourceOfServer['event']).map(Number));
      } else {
        releaseEvent.push([]);
      }
      if (sourceOfServer['gacha'] != undefined) {
        releaseGacha.push(Object.keys(sourceOfServer['gacha']).map(Number));
      } else {
        releaseGacha.push([]);
      }
    }
    this.releaseEvent = releaseEvent;
    this.releaseGacha = releaseGacha;
  }
}

export { limitBreakRankStat };
