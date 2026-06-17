import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import {
  Card,
  addStat,
  Stat,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { AreaItem } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/area-item.model';
import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { difficultyNameList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import {
  playerDataRepository,
  type PlayerDataRepository,
  type PlayerDetailMode,
} from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-data.repository';

/*
- mode=0 只从缓存取，无需等待队列立即返回缓存数据
- mode=1 同上立即返回缓存数据，但同时再放入队列请求服务器后台更新
- mode=2 放入队列等待新鲜数据，如果耗时过长就返回缓存数据
- mode=3 放入队列持续等待新鲜数据
*/

export class Player {
  playerId: number;
  isExist: boolean = false;
  initError: boolean = false;
  cache: boolean;
  time: number;
  profile: {
    userId: string;
    userName: string;
    rank: number;
    degree: number;
    introduction: string;
    publishTotalDeckPowerFlg: boolean;
    publishBandRankFlg: boolean;
    publishMusicClearedFlg: boolean;
    publishMusicFullComboFlg: boolean;
    publishHighScoreRatingFlg: boolean;
    publishUserIdFlg: boolean;
    searchableFlg: boolean;
    publishUpdatedAtFlg: boolean;
    friendApplicableFlg: boolean;
    publishMusicAllPerfectFlg: boolean;
    publishDeckRankFlg: boolean;
    publishStageChallengeAchievementConditionsFlg: boolean;
    publishStageChallengeFriendRankingFlg: boolean;
    publishCharacterRankFlg: boolean;
    mainDeckUserSituations: {
      entries: Array<{
        userId: string;
        situationId: number;
        level: number;
        exp: number;
        createdAt: string;
        addExp: number;
        trainingStatus: 'not_doing' | 'done';
        duplicateCount: number;
        illust: 'after_training' | 'normal';
        skillExp: number;
        skillLevel: number;
        userAppendParameter: {
          userId: string;
          situationId: number;
          performance: number;
          technique: number;
          visual: number;
          characterPotentialPerformance: number;
          characterPotentialTechnique: number;
          characterPotentialVisual: number;
          characterBonusPerformance?: number;
          characterBonusTechnique?: number;
          characterBonusVisual?: number;
        };
        limitBreakRank: number;
      }>;
    };
    enabledUserAreaItems: {
      entries: Array<{
        userId: string;
        areaItemId: number;
        areaItemCategory: number;
        level: number;
      }>;
    };
    bandRankMap: {
      entries: {
        [bandId: number]: number;
      };
    };
    userHighScoreRating: {
      [bandHighScoreRatingName: string]: {
        entries: Array<{
          musicId: number;
          difficulty: string;
          rating: number;
        }>;
      };
    };
    mainUserDeck: {
      deckId: number;
      deckName: string;
      leader: number;
      member1: number;
      member2: number;
      member3: number;
      member4: number;
      deckType: string;
    };
    userProfileSituation: {
      userId: string;
      situationId: number;
      illust: 'after_training' | 'normal';
      viewProfileSituationStatus: 'deck_leader' | 'profile_situation';
    };
    userProfileDegreeMap: {
      entries: {
        first: {
          userId: string;
          profileDegreeType: string;
          degreeId: number;
        };
        second: {
          userId: string;
          profileDegreeType: string;
          degreeId: number;
        };
      };
    };
    userTwitter?: {
      twitterId: string;
      twitterName: string;
      screenName: string;
      url: string;
      profileImageUrl: string;
    };
    userDeckTotalRatingMap: {
      entries: {
        [bandId: number]: {
          rank: string;
          score: number;
          level: number;
          lowerRating: number;
          upperRating: number;
        };
      };
    };
    stageChallengeAchievementConditionsMap: {
      entries: {
        [bandId: number]: number;
      };
    };
    userMusicClearInfoMap: {
      entries: {
        [difficultyName: string]: {
          clearedMusicCount: number;
          fullComboMusicCount: number;
          allPerfectMusicCount: number;
        };
      };
    };
    userCharacterRankMap: {
      entries: {
        [characterId: number]: {
          rank: number;
          exp: number;
          addExp: number;
          nextExp: number;
          totalExp: number;
          releasedPotentialLevel: number;
        };
      };
    };

    //其他
    //卡牌列表
    cardList: Card[];
    //插画
    userIllustration: { cardId: number; trainingStatus: boolean };
  };
  server: Server;

  isInitfull: boolean = false;

  /**
   * 构造 Player 实例，并初始化该模型的本地基础字段。
   *
   * @param playerId - 玩家 ID；定位本次读取、更新、删除或关联的玩家。
   * @param server - server 输入；影响 constructor 的返回值。
   */
  constructor(
    playerId: number,
    server: Server,
    private readonly dataRepository: PlayerDataRepository = playerDataRepository,
  ) {
    this.playerId = playerId;
    this.server = server;
  }
  /**
   * 在 Player 模型中加载远端完整详情并标记初始化状态。
   *
   * @param useCache - useCache 输入；驱动 `dataRepository.getDetail()` 的 BangDream步骤。
   * @param mode - mode 输入；驱动 `dataRepository.getDetail()` 的 BangDream步骤。
   */
  async initFull(useCache: boolean = false, mode: PlayerDetailMode = 2) {
    if (this.isInitfull) {
      return;
    }

    let playerData;
    try {
      playerData = await this.dataRepository.getDetail(
        this.playerId,
        this.server,
        useCache,
        mode,
      );
    } catch {
      this.isExist = false;
      this.initError = true;
      return;
    }
    const responseData = playerData.data;
    if (!playerData.result || responseData?.profile == null) {
      this.isExist = false;
      this.initError = true;
      return;
    }
    this.isExist = true;
    this.cache = responseData.cache as boolean;
    this.time = responseData.time as number;
    this.profile = responseData.profile as typeof this.profile;
    //卡牌列表
    this.profile.cardList = [];
    for (
      let i = 0;
      i < this.profile.mainDeckUserSituations.entries.length;
      i++
    ) {
      const cardData = this.profile.mainDeckUserSituations.entries[i];
      const card = new Card(cardData.situationId);
      this.profile.cardList.push(card);
    }
    //插画
    this.profile.userIllustration = this.getUserIllustration();

    //修复新旧API难度信息不兼容问题
    if (this.profile.userMusicClearInfoMap == undefined) {
      this.profile.userMusicClearInfoMap = { entries: {} };
      for (let i = 0; i < difficultyNameList.length; i++) {
        const difficultyName = difficultyNameList[i];
        this.profile.userMusicClearInfoMap.entries[difficultyName] = {
          clearedMusicCount: 0,
          fullComboMusicCount: 0,
          allPerfectMusicCount: 0,
        };
      }
      if (this.profile['clearedMusicCountMap']?.['entries'] != undefined) {
        for (let i = 0; i < difficultyNameList.length; i++) {
          const difficultyName = difficultyNameList[i];
          const number =
            this.profile['clearedMusicCountMap']['entries'][difficultyName] ||
            0;
          this.profile.userMusicClearInfoMap.entries[difficultyName][
            'clearedMusicCount'
          ] = number;
        }
      }
      if (this.profile['fullComboMusicCountMap']?.['entries'] != undefined) {
        for (let i = 0; i < difficultyNameList.length; i++) {
          const difficultyName = difficultyNameList[i];
          const number =
            this.profile['fullComboMusicCountMap']['entries'][difficultyName] ||
            0;
          this.profile.userMusicClearInfoMap.entries[difficultyName][
            'fullComboMusicCount'
          ] = number;
        }
      }
      if (this.profile['allPerfectMusicCountMap']?.['entries'] != undefined) {
        for (let i = 0; i < difficultyNameList.length; i++) {
          const difficultyName = difficultyNameList[i];
          const number =
            this.profile['allPerfectMusicCountMap']['entries'][
              difficultyName
            ] || 0;
          this.profile.userMusicClearInfoMap.entries[difficultyName][
            'allPerfectMusicCount'
          ] = number;
        }
      }
    }
    this.isInitfull = true;
  }
  /**
   * 在 Player 模型中计算数值。
   *
   * @param event - event 输入；使用 `characters`、`attributes`、`eventAttributeAndCharacterBonus` 字段生成结果。
   * @returns 异步处理结果。
   */
  async calcStat(event?: Event): Promise<Stat> {
    if (this.profile.publishTotalDeckPowerFlg == false) {
      return {
        performance: 0,
        technique: 0,
        visual: 0,
      };
    }
    //计算卡牌本身属性
    const cardDataList = this.profile.mainDeckUserSituations.entries;
    const cardStatList = [];
    const cardStat: Stat = {
      //所有卡牌的属性总和
      performance: 0,
      technique: 0,
      visual: 0,
    };
    for (let i = 0; i < cardDataList.length; i++) {
      const cardData = cardDataList[i];
      const card = new Card(cardData.situationId);
      const tempStat = await card.calcStat(cardData);
      addStat(cardStat, tempStat);
      cardStatList.push(tempStat);
    }
    //计算区域道具属性
    const extraStat: Stat = {
      //所有卡牌的额外属性总和
      performance: 0,
      technique: 0,
      visual: 0,
    };
    const areaItemList = this.profile.enabledUserAreaItems.entries;
    for (let i = 0; i < areaItemList.length; i++) {
      const element = areaItemList[i];
      const areaItem = new AreaItem(element.areaItemCategory);
      const areaItemLevel = element.level;
      for (let j = 0; j < cardStatList.length; j++) {
        const cardStat = cardStatList[j];
        const card = this.profile.cardList[j];
        const tempStat = areaItem.calcStat(
          card,
          areaItemLevel,
          cardStat,
          this.server,
        );
        addStat(extraStat, tempStat);
      }
    }
    const eventStat: Stat = {
      //所有卡牌的额外属性总和
      performance: 0,
      technique: 0,
      visual: 0,
    };
    if (event != undefined) {
      for (let i = 0; i < cardStatList.length; i++) {
        const cardStat = cardStatList[i];
        const card = this.profile.cardList[i];
        let isCharacter = false;
        let isAttribute = false;
        for (let j = 0; i < event.characters.length; j++) {
          const characterPercent = event.characters[j];
          if (card.characterId == characterPercent.characterId) {
            const tempStat = {
              performance:
                (cardStat.performance * characterPercent.percent) / 100,
              technique: (cardStat.technique * characterPercent.percent) / 100,
              visual: (cardStat.visual * characterPercent.percent) / 100,
            };
            addStat(eventStat, tempStat);
            isCharacter = true;
          }
        }
        for (let j = 0; j < event.attributes.length; j++) {
          const attributePercent = event.attributes[j];
          if (card.attribute == attributePercent.attribute) {
            const tempStat = {
              performance:
                (cardStat.performance * attributePercent.percent) / 100,
              technique: (cardStat.technique * attributePercent.percent) / 100,
              visual: (cardStat.visual * attributePercent.percent) / 100,
            };
            addStat(eventStat, tempStat);
            isAttribute = true;
          }
        }
        if (
          isCharacter &&
          isAttribute &&
          event.eventAttributeAndCharacterBonus != undefined
        ) {
          if (event.eventAttributeAndCharacterBonus.parameterPercent != 0) {
            const tempStat = {
              performance:
                (cardStat.performance *
                  event.eventAttributeAndCharacterBonus.parameterPercent) /
                100,
              technique:
                (cardStat.technique *
                  event.eventAttributeAndCharacterBonus.parameterPercent) /
                100,
              visual:
                (cardStat.visual *
                  event.eventAttributeAndCharacterBonus.parameterPercent) /
                100,
            };
            addStat(eventStat, tempStat);
          }
        }
      }
      addStat(extraStat, eventStat);
    }
    //相加
    addStat(cardStat, extraStat);
    //将cardStat所有参数向下取整
    cardStat.performance = cardStat.performance;
    cardStat.technique = cardStat.technique;
    cardStat.visual = cardStat.visual;

    return cardStat;
  }
  /**
   * 在 Player 模型中计算HSR。
   *
   * @returns 计算后的数值。
   */
  calcHSR(): number {
    let hsr = 0;
    const userHighScoreRating = this.profile.userHighScoreRating;
    for (const i in userHighScoreRating) {
      if (Object.prototype.hasOwnProperty.call(userHighScoreRating, i)) {
        const userBandHighScoreRating = userHighScoreRating[i].entries;
        for (let j = 0; j < userBandHighScoreRating.length; j++) {
          const element = userBandHighScoreRating[j];
          hsr += element.rating;
        }
      }
    }
    return hsr;
  }
  /**
   * 查询 BangDream 插件数据。
   *
   * @returns 判断结果。
   */
  getUserIllustration(): { cardId: number; trainingStatus: boolean } {
    let illustrationCardId: number;
    let trainingStatus: boolean;
    let viewProfileSituationStatus: string;
    if (Object.keys(this.profile.userProfileSituation).length != 0) {
      viewProfileSituationStatus =
        this.profile.userProfileSituation.viewProfileSituationStatus;
    } else {
      viewProfileSituationStatus = 'deck_leader';
    }
    if (viewProfileSituationStatus == 'deck_leader') {
      illustrationCardId =
        this.profile.mainDeckUserSituations.entries[0].situationId;
      trainingStatus =
        this.profile.mainDeckUserSituations.entries[0].illust ===
        'after_training'
          ? true
          : false;
    } else {
      illustrationCardId = this.profile.userProfileSituation.situationId;
      trainingStatus =
        this.profile.userProfileSituation.illust === 'after_training'
          ? true
          : false;
    }
    return { cardId: illustrationCardId, trainingStatus: trainingStatus };
  }
}
