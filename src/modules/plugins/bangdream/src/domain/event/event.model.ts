import { Canvas, Image } from 'skia-canvas';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { bangdreamCatalogRepository } from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';
import { Attribute } from '@/modules/plugins/bangdream/src/domain/catalog/attribute.model';
import { Character } from '@/modules/plugins/bangdream/src/domain/character/character.model';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { stringToNumberArray } from '@/modules/plugins/bangdream/src/domain/common/model-utils';
import { BANGDREAM_EVENT_TYPE_NAME } from '@/modules/plugins/bangdream/src/config/dictionary/default-dictionary';
import { eventDataRepository } from '@/modules/plugins/bangdream/src/domain/event/event-data.repository';
import { estimateCnEventStartAt } from '@/modules/plugins/bangdream/src/domain/policy/cn-event-estimate.policy';
import {
  selectRecentCutoffEventIds,
  type CutoffRecentEventCandidate,
} from '@/modules/plugins/bangdream/src/domain/policy/cutoff.policy';

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

  constructor(eventId: number) {
    this.eventId = eventId;
    const eventData = bangdreamCatalogRepository.getEntity<Record<string, any>>(
      'events',
      eventId,
    );
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
   * @param update - 决定在 Event 模型中请求当前模型的远端详情数据内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 在 Event 模型中请求当前模型的远端详情数据。
   */
  async getData(update: boolean = true) {
    return await eventDataRepository.getDetail(this.eventId, update);
  }
  /**
   * 按`displayedServerList`读取横幅图片；从 `eventDataRepository.getBannerImage` 读取横幅图片。
   * @param displayedServerList - 决定横幅图片内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 横幅图片。
   */
  async getBannerImage(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    return await eventDataRepository.getBannerImage(this, displayedServerList);
  }
  /**
   * 按`displayedServerList`读取事件BGImage；从 `eventDataRepository.getBackgroundImage` 读取事件BGImage。
   * @param displayedServerList - 决定事件BGImage内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 事件BGImage。
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
   * 按`tempServer`读取事件Slide图片；从 `eventDataRepository.getSlideImages` 读取事件Slide图片。
   * @param tempServer - 决定事件Slide图片内容、边界或目标的 `tempServer` 值。
   * @returns 按输入顺序得到的事件Slide图片列表；没有匹配项时为空数组。
   */
  async getEventSlideImage(tempServer: Server): Promise<Image[]> {
    return await eventDataRepository.getSlideImages(this, tempServer);
  }
  //活动主界面trim
  /**
   * 按`displayedServerList`读取事件顶部横幅Trim图片；从 `eventDataRepository.getTopscreenTrimImage` 读取事件顶部横幅Trim图片。
   * @param displayedServerList - 决定事件顶部横幅Trim图片内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 事件顶部横幅Trim图片。
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
   * 按`tempServer`读取事件Logo图片；从 `eventDataRepository.getLogoImage` 读取事件Logo图片。
   * @param tempServer - 决定事件Logo图片内容、边界或目标的 `tempServer` 值。
   * @returns 事件Logo图片。
   */
  async getEventLogoImage(tempServer: Server): Promise<Image> {
    return await eventDataRepository.getLogoImage(this, tempServer);
  }
  /**
   * 按当前运行态读取Type名称；当 `typeName[this.eventType] == undefined` 成立时返回 `this.eventType`。
   * @returns Type名称。
   */
  getTypeName() {
    if (typeName[this.eventType] == undefined) {
      return this.eventType;
    }
    return typeName[this.eventType];
  }
  /**
   * 按当前运行态读取卡牌属性。
   * @returns 卡牌属性。
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
   * 按当前运行态读取角色。
   * @returns 角色。
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
   * 按`server`读取奖励Stamp；从 `eventDataRepository.getRewardStampImage` 读取奖励Stamp。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 奖励Stamp。
   */
  async getRewardStamp(server: Server): Promise<Image> {
    return await eventDataRepository.getRewardStampImage(this, server);
  }
  /**
   * 按`server`读取奖励Deco；从 `eventDataRepository.getRewardDecoImage` 读取奖励Deco。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 奖励Deco。
   */
  async getRewardDeco(server: Server): Promise<Image> {
    return await eventDataRepository.getRewardDecoImage(this, server);
  }
}

//获取当前进行中的活动,如果期间没有活动，则返回上一个刚结束的活动
/**
 * 按`server`、`time`读取Present事件；当 `eventList.length == 0` 成立时返回 `null`。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param time - 决定Present事件内容、边界或目标的 `time` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 完成初始化并携带当前边界配置的Present事件；无法解析或未命中时为 `null`。
 */
export function getPresentEvent(server: Server, time?: number) {
  if (!time) {
    time = Date.now();
  }
  const eventList: Array<number> = [];
  const eventListMain = bangdreamCatalogRepository.getCollection('events');
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
 * 根据`tempEventList`、`displayedServerList`处理sort事件；从 `getPresentEvent` 读取sort事件。
 * @param tempEventList - 决定sort事件内容、边界或目标的 `tempEventList` 值。
 * @param displayedServerList - 用于sort事件的领域对象，包含 `length`、`i`、`0` 字段；省略时默认采用 `globalDefaultServer`。
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
 * 按`event`、`server`、`count`读取最近日志事件服务器；从 `bangdreamCatalogRepository.getNumericIds` 读取最近日志事件服务器。
 * @param event - 触发最近日志事件服务器的领域事件。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param count - 决定最近日志事件服务器内容、边界或目标的 `count` 值。
 * @param sameType - 决定最近日志事件服务器内容、边界或目标的 `sameType` 值；省略时默认采用 `false`。
 * @returns 最近日志事件服务器。
 */
export function getRecentEventListByEventAndServer(
  event: Event,
  server: Server,
  count: number,
  sameType: boolean = false,
) {
  const eventIdList = bangdreamCatalogRepository.getNumericIds('events');
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
