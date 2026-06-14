import { Skill } from '@/modules/qqbot/plugins/bangDream/catalog/skill.model';
import { Character } from '@/modules/qqbot/plugins/bangDream/character/character.model';
import {
  Server,
  getServerByPriority,
  serverList,
} from '@/modules/qqbot/plugins/bangDream/catalog/server.model';
import { Gacha } from '@/modules/qqbot/plugins/bangDream/gacha/gacha.model';
import { Event } from '@/modules/qqbot/plugins/bangDream/event/event.model';
import { Image, loadImage } from 'skia-canvas';
import { bangDreamMainDataRepository } from '@/modules/qqbot/plugins/bangDream/shared/main-data.repository';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangDream/config/runtime-config';
import { stringToNumberArray } from '@/modules/qqbot/plugins/bangDream/shared/model-utils';
import { BANGDREAM_CARD_TYPE_NAME } from '@/modules/qqbot/plugins/bangDream/shared/bangdream-constants';
import { cardResourceRepository } from '@/modules/qqbot/plugins/bangDream/card/card-resource.repository';

export interface Stat {
  //综合力
  performance: number;
  technique: number;
  visual: number;
}

const typeName: Record<string, string> = BANGDREAM_CARD_TYPE_NAME;

/**
 * 在BangDream 领域模型层中追加数值。
 *
 * @param stat - 数值参数。
 * @param add - add参数。
 */
export function addStat(stat: Stat, add: Stat): void {
  //综合力相加函数
  stat.performance += add.performance;
  stat.technique += add.technique;
  stat.visual += add.visual;
}

/**
 * 在BangDream 领域模型层中处理limitBreakRank数值。
 *
 * @param rarity - rarity参数。
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

  /**
   * 构造 Card 实例，并初始化该模型的本地基础字段。
   *
   * @param cardId - 卡牌 ID。
   */
  constructor(cardId: number) {
    this.cardId = cardId;
    const cardData = bangDreamMainDataRepository.getEntity<Record<string, any>>(
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
   * 在 Card 模型中加载远端完整详情并标记初始化状态。
   *
   * @param useCache - use缓存参数，未传入时使用默认值。
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
   *
   * @param update - update参数，未传入时使用默认值。
   */
  async getData(update: boolean = true) {
    return await cardResourceRepository.getDetail(this.cardId, update);
  }

  /**
   * 在 Card 模型中处理ableToTraining。
   *
   * @param trainingStatus - training状态参数，未传入时使用默认值。
   * @returns 判断结果。
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
   * 在 Card 模型中获取Training状态列表。
   *
   * @returns 判断结果。
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
   * 在 Card 模型中计算数值。
   *
   * @param cardData - 卡牌数据参数，未传入时使用默认值。
   */
  async calcStat(cardData?) {
    if (!this.isInitFull) {
      await this.initFull();
    }
    const level = cardData ? cardData.level : this.getMaxLevel();
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
   * 在 Card 模型中获取技能。
   *
   * @returns 处理结果。
   */
  getSkill(): Skill {
    return new Skill(this.skillId);
  }
  /**
   * 在 Card 模型中判断Released。
   *
   * @param server - 目标服务器。
   * @returns 判断结果。
   */
  isReleased(server: Server): boolean {
    //确定是否在该服务器发布
    if (this.releasedAt[server] == null) {
      return false;
    }
    return true;
  }
  /**
   * 在 Card 模型中获取FirstReleased服务器。
   *
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
   * @returns 处理结果。
   */
  getFirstReleasedServer(
    displayedServerList: Server[] = globalDefaultServer,
  ): Server {
    //获得确保已经发布了的服务器
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    return getServerByPriority(this.releasedAt, displayedServerList);
  }
  /**
   * 在 Card 模型中获取资源批次。
   *
   * @returns 格式化后的文本。
   */
  getRip(): string {
    return cardResourceRepository.getRip(this.cardId);
  }
  /**
   * 在 Card 模型中获取卡牌图标图片。
   *
   * @param trainingStatus - training状态参数。
   * @returns 异步处理结果。
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
   * 在 Card 模型中获取卡牌Illustration图片。
   *
   * @param trainingStatus - training状态参数。
   * @returns 异步处理结果。
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
   * 在 Card 模型中获取卡牌Illustration图片缓冲区。
   *
   * @param trainingStatus - training状态参数。
   * @returns 异步处理结果。
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
   * 在 Card 模型中获取卡牌Trim图片。
   *
   * @param trainingStatus - training状态参数。
   * @returns 异步处理结果。
   */
  async getCardTrimImage(trainingStatus: boolean): Promise<Image> {
    trainingStatus = this.ableToTraining(trainingStatus);
    const cardIllustrationImageBuffer =
      await cardResourceRepository.getImageBuffer(this, 'trim', trainingStatus);
    return await loadImage(cardIllustrationImageBuffer);
  }
  /**
   * 在 Card 模型中获取类型名称。
   */
  getTypeName() {
    if (typeName[this.type] == undefined) {
      return this.type;
    }
    return typeName[this.type];
  }
  /**
   * 在 Card 模型中获取Max等级。
   *
   * @returns 计算后的数值。
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
   * 在 Card 模型中获取来源。
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
