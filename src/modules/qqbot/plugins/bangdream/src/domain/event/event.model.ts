import { Canvas, Image } from 'skia-canvas';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { bangDreamMainDataRepository } from '@/modules/qqbot/plugins/bangdream/src/application/main-data.repository';
import { Attribute } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/attribute.model';
import { Character } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { stringToNumberArray } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import { BANGDREAM_EVENT_TYPE_NAME } from '@/modules/qqbot/plugins/bangdream/src/config/dictionary/default-dictionary';
import { eventDataRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-data.repository';
import { estimateCnEventStartAt } from '@/modules/qqbot/plugins/bangdream/src/domain/policy/cn-event-estimate.policy';
import {
  selectRecentCutoffEventIds,
  type CutoffRecentEventCandidate,
} from '@/modules/qqbot/plugins/bangdream/src/domain/policy/cutoff.policy';

const typeName: Record<string, string> = BANGDREAM_EVENT_TYPE_NAME;

export class Event {
  eventId: number;
  isExist: boolean = false;
  isInitFull = false;
  eventType: string;
  eventName: Array<string | null>;
  bannerAssetBundleName: string;
  startAt: Array<number | null>;
  endAt: Array<number | null>;
  attributes: Array<{
    attribute: 'happy' | 'cool' | 'powerful' | 'pure';
    percent: number;
  }>;
  characters: Array<{
    characterId: number;
    percent: number;
  }>;
  eventAttributeAndCharacterBonus: {
    pointPercent: number;
    parameterPercent: number;
  };
  musics?: Array<Array<{
    musicId: number;
    musicRankingRewards?: Array<{
      fromRank: number;
      toRank: number;
      resourceType: string;
      resourceId: number;
      quantity: number;
    }>;
  }> | null>;
  rewardCards: Array<number>;

  //other
  //enableFlag: Array<null>;
  assetBundleName: string;
  publicStartAt: Array<number | null>;
  publicEndAt: Array<number | null>;
  /*
    distributionStartAt: Array<number | null>;
    distributionEndAt: Array<number | null>;
    bgmAssetBundleName: string;
    bgmFileName: string;
    aggregateEndAt: Array<number | null>;
    exchangeEndAt: Array<number | null>;
    */
  pointRewards: Array<Array<{
    point: string;
    rewardType: string;
    rewardId?: number;
    rewardQuantity: number;
  }> | null>;
  rankingRewards: Array<Array<{
    fromRank: number;
    toRank: number;
    rewardType: string;
    rewardId: number;
    rewardQuantity: number;
  }> | null>;
  eventCharacterParameterBonus?: {
    //偏科
    performance?: number;
    technique?: number;
    visual?: number;
  } = {};

  //以下用于模糊搜索
  characterId: number[];
  attribute: string[];
  bandId: number[];

  isInitfull: boolean = false;

  /**
   * 构造 Event 实例，并初始化该模型的本地基础字段。
   *
   * @param eventId - 活动 ID。
   */
  constructor(eventId: number) {
    this.eventId = eventId;
    const eventData = bangDreamMainDataRepository.getEntity<
      Record<string, any>
    >('events', eventId);
    if (eventData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.assetBundleName = eventData['assetBundleName'];
    this.eventType = eventData['eventType'];
    this.eventName = eventData['eventName'];
    this.bannerAssetBundleName = eventData['bannerAssetBundleName'];
    this.startAt = stringToNumberArray(eventData['startAt']);
    this.endAt = stringToNumberArray(eventData['endAt']);
    this.attributes = eventData['attributes'];
    this.characters = eventData['characters'];
    this.rewardCards = eventData['rewardCards'];
    //用于模糊搜索
    this.characterId = [];
    for (let i = 0; i < this.characters.length; i++) {
      const element = this.characters[i];
      this.characterId.push(element.characterId);
    }
    this.attribute = [];
    for (let i = 0; i < this.attributes.length; i++) {
      const element = this.attributes[i];
      this.attribute.push(element.attribute);
    }
    //如果所有character来自同一个band，则bandId为该bandId
    this.bandId = [];
    let isSameBand = true;
    for (let i = 0; i < this.characters.length; i++) {
      if (
        new Character(this.characters[i].characterId).bandId !=
        new Character(this.characters[0].characterId).bandId
      ) {
        isSameBand = false;
        break;
      }
    }
    if (isSameBand) {
      this.bandId.push(new Character(this.characters[0].characterId).bandId);
    } else {
      this.bandId.push(0);
    }
  }
  /**
   * 在 Event 模型中加载远端完整详情并标记初始化状态。
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
    const eventData = await this.getData(!useCache);
    this.isInitFull = true;
    this.eventType = eventData['eventType'];
    this.eventName = eventData['eventName'];
    this.assetBundleName = eventData['assetBundleName'];
    this.bannerAssetBundleName = eventData['bannerAssetBundleName'];
    this.startAt = stringToNumberArray(eventData['startAt']);
    this.endAt = stringToNumberArray(eventData['endAt']);
    this.attributes = eventData['attributes'];
    this.characters = eventData['characters'];
    this.eventAttributeAndCharacterBonus =
      eventData['eventAttributeAndCharacterBonus'];
    this.musics = eventData['musics'];
    this.rewardCards = eventData['rewardCards'];
    //other
    //this.enableFlag = eventData['enableFlag'];
    this.publicStartAt = stringToNumberArray(eventData['publicStartAt']);
    this.publicEndAt = stringToNumberArray(eventData['publicEndAt']);
    this.pointRewards = eventData['pointRewards'];
    this.rankingRewards = eventData['rankingRewards'];
    /*
        this.distributionStartAt = eventData['distributionStartAt'];
        this.distributionEndAt = eventData['distributionEndAt'];
        this.bgmAssetBundleName = eventData['bgmAssetBundleName'];
        this.bgmFileName = eventData['bgmFileName'];
        this.aggregateEndAt = eventData['aggregateEndAt'];
        this.exchangeEndAt = eventData['exchangeEndAt'];
        */
    if (eventData['eventCharacterParameterBonus'] != undefined) {
      this.eventCharacterParameterBonus =
        eventData['eventCharacterParameterBonus'];
    }

    this.isInitfull = true;
  }
  /**
   * 在 Event 模型中请求当前模型的远端详情数据。
   *
   * @param update - update参数，未传入时使用默认值。
   */
  async getData(update: boolean = true) {
    return await eventDataRepository.getDetail(this.eventId, update);
  }
  /**
   * 在 Event 模型中获取横幅图片。
   *
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
   * @returns 异步处理结果。
   */
  async getBannerImage(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    return await eventDataRepository.getBannerImage(this, displayedServerList);
  }
  /**
   * 在 Event 模型中获取活动背景图片。
   *
   * @returns 异步处理结果。
   */
  async getEventBGImage(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image | Canvas> {
    return await eventDataRepository.getBackgroundImage(
      this,
      displayedServerList,
    );
  }
  //活动规则轮播图
  /**
   * 在 Event 模型中获取活动Slide图片。
   *
   * @param tempServer - temp服务器参数。
   * @returns 异步处理结果。
   */
  async getEventSlideImage(tempServer: Server): Promise<Image[]> {
    return await eventDataRepository.getSlideImages(this, tempServer);
  }
  //活动主界面trim
  /**
   * 在 Event 模型中获取活动TopscreenTrim图片。
   *
   * @returns 异步处理结果。
   */
  async getEventTopscreenTrimImage(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    return await eventDataRepository.getTopscreenTrimImage(
      this,
      displayedServerList,
    );
  }
  /**
   * 在 Event 模型中获取活动Logo图片。
   *
   * @param tempServer - temp服务器参数。
   * @returns 异步处理结果。
   */
  async getEventLogoImage(tempServer: Server): Promise<Image> {
    return await eventDataRepository.getLogoImage(this, tempServer);
  }
  /**
   * 在 Event 模型中获取类型名称。
   */
  getTypeName() {
    if (typeName[this.eventType] == undefined) {
      return this.eventType;
    }
    return typeName[this.eventType];
  }
  /**
   * 在 Event 模型中获取属性列表。
   */
  getAttributeList() {
    //反向排序加成，返回{percent:[attribute]}
    const attribute = this.attributes;
    const attributeList: { [percent: string]: Array<Attribute> } = {};
    for (const i in attribute) {
      if (Object.prototype.hasOwnProperty.call(attribute, i)) {
        const element = attribute[i];
        const percent = element.percent;
        if (attributeList[percent.toString()] == undefined) {
          attributeList[percent.toString()] = [];
        }
        attributeList[percent.toString()].push(
          new Attribute(element.attribute),
        );
      }
    }
    return attributeList;
  }
  /**
   * 在 Event 模型中获取角色列表。
   */
  getCharacterList() {
    const character = this.characters;
    const characterList: { [percent: string]: Array<Character> } = {};
    for (const i in character) {
      if (Object.prototype.hasOwnProperty.call(character, i)) {
        const element = character[i];
        const percent = element.percent;
        if (characterList[percent.toString()] == undefined) {
          characterList[percent.toString()] = [];
        }
        characterList[percent.toString()].push(
          new Character(element.characterId),
        );
      }
    }
    return characterList;
  }
  /**
   * 在 Event 模型中获取奖励Stamp。
   *
   * @param server - 目标服务器。
   * @returns 异步处理结果。
   */
  async getRewardStamp(server: Server): Promise<Image> {
    return await eventDataRepository.getRewardStampImage(this, server);
  }
  /**
   * 在 Event 模型中获取奖励Deco。
   *
   * @param server - 目标服务器。
   * @returns 异步处理结果。
   */
  async getRewardDeco(server: Server): Promise<Image> {
    return await eventDataRepository.getRewardDecoImage(this, server);
  }
}

//获取当前进行中的活动,如果期间没有活动，则返回上一个刚结束的活动
/**
 * 在BangDream 领域模型层中获取Present活动。
 *
 * @param server - 目标服务器。
 * @param time - 谱面时间点，未传入时使用默认值。
 */
export function getPresentEvent(server: Server, time?: number) {
  if (!time) {
    time = Date.now();
  }
  const eventList: Array<number> = [];
  const eventListMain = bangDreamMainDataRepository.getCollection('events');
  for (const key in eventListMain) {
    const event = new Event(parseInt(key));
    //如果在活动进行时
    if (event.startAt[server] != null && event.endAt[server] != null) {
      if (
        event.startAt[server] - 1000 * 60 * 60 * 24 <= time &&
        event.endAt[server] >= time
      ) {
        //提前一天
        eventList.push(parseInt(key));
      }
    }
  }
  let eventEndAtFlags: number = 0;
  //如果没有活动进行中，则返回上一个刚结束的活动
  if (eventList.length == 0) {
    for (const key in eventListMain) {
      const event = new Event(parseInt(key));
      //如果在活动进行时
      if (event.startAt[server] != null && event.endAt[server] != null) {
        if (event.endAt[server] <= time) {
          if (event.endAt[server] > eventEndAtFlags) {
            eventList.push(parseInt(key));
            eventEndAtFlags = event.endAt[server];
          }
        }
      }
    }
  }

  //如果没有活动，则返回null
  if (eventList.length == 0) {
    return null;
  }

  //如果有多个活动，则返回最后一个
  return new Event(eventList[eventList.length - 1]);
}

//根据服务器，将活动列表排序
/**
 * 在BangDream 领域模型层中排序活动列表。
 *
 * @param tempEventList - temp活动列表参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 */
export function sortEventList(
  tempEventList: Event[],
  displayedServerList: Server[] = globalDefaultServer,
) {
  const presentEventCN = getPresentEvent(Server.cn);
  tempEventList.sort((a, b) => {
    for (let i = 0; i < displayedServerList.length; i++) {
      const server = displayedServerList[i];
      if (a.startAt[server] == null || b.startAt[server] == null) {
        if (displayedServerList[0] == Server.cn) {
          // 再尝试通过预估时间排序
          let prvEvent = null;
          let nxtEvent = null;
          if (a.startAt[server] == null) {
            prvEvent = estimateCnEventStartAt(a.eventId, presentEventCN);
          } else {
            prvEvent = a.startAt[server];
          }
          if (b.startAt[server] == null) {
            nxtEvent = estimateCnEventStartAt(b.eventId, presentEventCN);
          } else {
            nxtEvent = b.startAt[server];
          }
          if (prvEvent != null || nxtEvent != null) {
            return (prvEvent ?? 0) - (nxtEvent ?? 0);
          }
        }
        continue;
      }
      if (a.startAt[server] != b.startAt[server]) {
        return a.startAt[server] - b.startAt[server];
      }
    }
  });
}

//通过活动与服务器，获得活动类型相同的 前5期活动
/**
 * 在BangDream 领域模型层中获取最近活动列表By活动And服务器。
 *
 * @param event - 活动参数。
 * @param server - 目标服务器。
 * @param count - count参数。
 * @param sameType - same类型参数，未传入时使用默认值。
 */
export function getRecentEventListByEventAndServer(
  event: Event,
  server: Server,
  count: number,
  sameType: boolean = false,
) {
  const eventIdList = bangDreamMainDataRepository.getNumericIds('events');
  const candidates: CutoffRecentEventCandidate[] = eventIdList
    .map((eventId) => new Event(eventId))
    .map((candidate) => ({
      eventId: candidate.eventId,
      eventType: candidate.eventType,
      startAt: candidate.startAt,
    }));
  return selectRecentCutoffEventIds({
    candidates,
    count,
    event,
    sameType,
    server,
  }).map((eventId) => new Event(eventId));
}
