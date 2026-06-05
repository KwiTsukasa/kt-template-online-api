import { callAPIAndCacheResponse } from '@/qqbot/plugins/bangDream/tsugu/data/get-api';
import { Image, loadImage } from 'skia-canvas';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import { Attribute } from '@/qqbot/plugins/bangDream/tsugu/domain/attribute';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/domain/character';
import {
  globalDefaultServer,
  bestdoriUrl,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { stringToNumberArray } from '@/qqbot/plugins/bangDream/tsugu/domain/utils';
import { getProbableTimeDifference } from '@/qqbot/plugins/bangDream/tsugu/layout/list/time';
import { BANGDREAM_EVENT_TYPE_NAME } from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';

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
    const eventData = mainAPI['events'][eventId.toString()];
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
  async getData(update: boolean = true) {
    const time = update ? 0 : 1 / 0;
    const eventData = await callAPIAndCacheResponse(
      `${bestdoriUrl}/api/events/${this.eventId}.json`,
      time,
    );
    return eventData;
  }
  async getBannerImage(
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    const server = getServerByPriority(this.startAt, displayedServerList);
    try {
      const BannerImageBuffer = await downloadFileCache(
        `${bestdoriUrl}/assets/${Server[server]}/event/${this.assetBundleName}/images_rip/banner.png`,
        false,
      );
      return await loadImage(BannerImageBuffer);
    } catch {
      const server = Server.jp;
      const BannerImageBuffer = await downloadFileCache(
        `${bestdoriUrl}/assets/${Server[server]}/homebanner_rip/${this.bannerAssetBundleName}.png`,
      );
      return await loadImage(BannerImageBuffer);
    }
  }
  async getEventBGImage(): Promise<Image> {
    const server = getServerByPriority(this.startAt);
    const BGImageBuffer = await downloadFileCache(
      `${bestdoriUrl}/assets/${Server[server]}/event/${this.assetBundleName}/topscreen_rip/bg_eventtop.png`,
    );
    return await loadImage(BGImageBuffer);
  }
  //活动规则轮播图
  async getEventSlideImage(tempServer: Server): Promise<Image[]> {
    const server = getServerByPriority(this.startAt, [tempServer]);
    const result: Image[] = [];
    const baseUrl = `${bestdoriUrl}/assets/${Server[server]}/event/${this.assetBundleName}/slide_rip/`;
    let ruleNumber = 1;
    while (true) {
      try {
        const url = `${baseUrl}rule${ruleNumber}.png`;
        const SlideImageBuffer = await downloadFileCache(url, false);
        result.push(await loadImage(SlideImageBuffer));
      } catch {
        break;
      }
      ruleNumber++;
    }
    return result;
  }
  //活动主界面trim
  async getEventTopscreenTrimImage(): Promise<Image> {
    const server = getServerByPriority(this.startAt);
    const url = `${bestdoriUrl}/assets/${Server[server]}/event/${this.assetBundleName}/topscreen_rip/trim_eventtop.png`;
    const TopscreenTrimImageBuffer = await downloadFileCache(url);
    return await loadImage(TopscreenTrimImageBuffer);
  }
  async getEventLogoImage(tempServer: Server): Promise<Image> {
    const server = getServerByPriority(this.startAt, [tempServer]);
    const LogoImageBuffer = await downloadFileCache(
      `${bestdoriUrl}/assets/${Server[server]}/event/${this.assetBundleName}/images_rip/logo.png`,
    );
    return await loadImage(LogoImageBuffer);
  }
  getTypeName() {
    if (typeName[this.eventType] == undefined) {
      return this.eventType;
    }
    return typeName[this.eventType];
  }
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
  async getRewardStamp(server: Server): Promise<Image> {
    const allStamps = await callAPIAndCacheResponse(
      `${bestdoriUrl}/api/stamps/all.2.json`,
    );
    const rewards = this.pointRewards.filter(Boolean)[0];
    let rewardId = -1;
    for (let i = 0; i < rewards?.length; i++) {
      if (rewards[i].rewardType == 'stamp') {
        rewardId = rewards[i].rewardId;
        break;
      }
    }
    let stampAssetName = '';
    for (const i in allStamps) {
      if (i == rewardId.toString()) {
        stampAssetName = allStamps[i]['imageName'];
      }
    }
    if (stampAssetName == '') {
      return undefined;
    }
    let serverName = 'jp';
    if (this.startAt[server] && this.startAt[server] < Date.now()) {
      serverName = Server[server];
    }
    try {
      const stampBuffer = await downloadFileCache(
        `${bestdoriUrl}/assets/${serverName}/stamp/01_rip/${stampAssetName}.png`,
      );
      return await loadImage(stampBuffer);
    } catch {
      return undefined;
    }
  }
  async getRewardDeco(server: Server): Promise<Image> {
    const allDeco = mainAPI['deco'];
    if (!this.rankingRewards[server]) {
      // Undefined处理
      return undefined;
    }
    const rewards = this.rankingRewards[server].filter(Boolean);
    let rewardId = -1;
    for (let i = 0; i < rewards?.length; i++) {
      if (rewards[i].rewardType == 'deco_pins') {
        rewardId = rewards[i].rewardId;
        break;
      }
    }
    if (rewardId == -1) return undefined;
    let decoAssetName = '';
    for (const i in allDeco) {
      if (i == rewardId.toString()) {
        decoAssetName = allDeco[i]['assetBundleName'];
      }
    }
    if (decoAssetName == '') {
      return undefined;
    }
    let serverName = 'cn';
    if (this.startAt[server] && this.startAt[server] < Date.now()) {
      serverName = Server[server];
    }
    try {
      const decoBuffer = await downloadFileCache(
        `${bestdoriUrl}/assets/${serverName}/deco/pins_rip/${decoAssetName}.png`,
      );
      return await loadImage(decoBuffer);
    } catch {
      return undefined;
    }
  }
}

//获取当前进行中的活动,如果期间没有活动，则返回上一个刚结束的活动
export function getPresentEvent(server: Server, time?: number) {
  if (!time) {
    time = Date.now();
  }
  const eventList: Array<number> = [];
  const eventListMain = mainAPI['events'];
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
            prvEvent = getProbableTimeDifference(a.eventId, presentEventCN);
          } else {
            prvEvent = a.startAt[server];
          }
          if (b.startAt[server] == null) {
            nxtEvent = getProbableTimeDifference(b.eventId, presentEventCN);
          } else {
            nxtEvent = b.startAt[server];
          }
          if (prvEvent != null || nxtEvent != null) {
            return prvEvent - nxtEvent;
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
export function getRecentEventListByEventAndServer(
  event: Event,
  server: Server,
  count: number,
  sameType: boolean = false,
) {
  const eventIdList: Array<number> = Object.keys(mainAPI['events']).map(Number);
  //对活动列表进行排序,从新到旧
  eventIdList.sort((a, b) => {
    const eventA = new Event(a);
    const eventB = new Event(b);
    if (eventA.startAt[server] == null || eventB.startAt[server] == null) {
      return 0;
    }
    return eventB.startAt[server] - eventA.startAt[server];
  });
  const tempEventList: Array<Event> = [];
  for (let i = 0; i < eventIdList.length; i++) {
    const tempEvent = new Event(eventIdList[i]);
    if (tempEvent.startAt[server] != null) {
      if (sameType && tempEvent.eventType != event.eventType) {
        continue;
      }
      if (tempEvent.startAt[server] > event.startAt[server]) {
        continue;
      }
      tempEventList.push(tempEvent);
    }
  }
  sortEventList(tempEventList, [server]);
  return tempEventList.slice(
    tempEventList.length - count,
    tempEventList.length,
  );
}
