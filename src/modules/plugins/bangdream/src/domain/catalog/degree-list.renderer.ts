import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { Canvas } from 'skia-canvas';
import { drawDegree } from '@/modules/plugins/bangdream/src/domain/catalog/degree-badge.renderer';
import { Degree } from '@/modules/plugins/bangdream/src/domain/catalog/degree.model';
import {
  Server,
  getServerByPriority,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { Event } from '@/modules/plugins/bangdream/src/domain/event/event.model';
import { stackImage } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import {
  BANGDREAM_DEGREE_LIST_SPEC,
  isDegreeRewardType,
  shouldCollectMusicRankingDegreeRewards,
  shouldStopAfterFirstMusicRewardGroup,
} from '@/modules/plugins/bangdream/src/domain/catalog/degree-list.layout';

interface DegreeListInListOptions {
  key?: string;
  degreeList: Array<Degree>;
  server?: Server;
  displayedServerList?: Server[];
}

/**
 * 根据当前运行态绘制或格式化称号。
 * @returns 称号。
 */
export async function drawDegreeListInList({
  degreeList,
  server,
  key,
}: DegreeListInListOptions): Promise<Canvas> {
  const list: Array<Canvas> = [];
  for (let i = 0; i < degreeList.length; i++) {
    const element = degreeList[i];
    const degreeImage = await drawDegree(element, server);
    list.push(degreeImage);
  }
  return drawList({
    key: key,
    content: list,
    textSize: BANGDREAM_DEGREE_LIST_SPEC.list.textSize,
  });
}

/**
 * 根据`event`、`displayedServerList`绘制或格式化称号事件；从 `getServerByPriority` 读取称号事件。
 * @param event - 触发称号事件的领域事件，包含 `initFull`、`rankingRewards`、`eventType`、`musics` 字段。
 * @param displayedServerList - 决定称号事件内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @returns 称号事件。
 */
export async function drawDegreeListOfEvent(
  event: Event,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  event.initFull();
  const list = [];
  const tempDegreeList = [];
  const server = getServerByPriority(event.rankingRewards, displayedServerList);
  const rankingRewards = event.rankingRewards[server];
  for (let i = 0; i < rankingRewards.length; i++) {
    if (isDegreeRewardType(rankingRewards[i].rewardType)) {
      tempDegreeList.push(new Degree(rankingRewards[i].rewardId));
      if (
        tempDegreeList.length >=
        BANGDREAM_DEGREE_LIST_SPEC.eventRewards.maxDegreeCount
      )
        break;
    }
  }
  list.push(
    await drawDegreeListInList({
      key: '活动奖励',
      degreeList: tempDegreeList,
      server: server,
      displayedServerList: displayedServerList,
    }),
  );
  if (shouldCollectMusicRankingDegreeRewards(event.eventType)) {
    const rewards = event.musics[server];
    for (let i = 0; i < rewards.length; i++) {
      const tempDegreeList = [];
      for (let n = 0; n < rewards[i].musicRankingRewards.length; n++) {
        if (
          isDegreeRewardType(rewards[i].musicRankingRewards[n].resourceType)
        ) {
          tempDegreeList.push(
            new Degree(rewards[i].musicRankingRewards[n].resourceId),
          );
          if (
            tempDegreeList.length >=
            BANGDREAM_DEGREE_LIST_SPEC.eventRewards.maxDegreeCount
          )
            break;
        }
      }
      list.push(
        await drawDegreeListInList({
          degreeList: tempDegreeList,
          server: server,
          displayedServerList: displayedServerList,
        }),
      );
      if (shouldStopAfterFirstMusicRewardGroup(event.eventType)) {
        break;
      }
    }
  } else if (event.eventType == 'live_try') {
    const tempDegreeList = [];
    const data = await event.getData();
    const rewards = data['masterLiveTryLevelRewardDifficultyMap'][0]['entries'];
    for (const i in rewards) {
      if (Object.prototype.hasOwnProperty.call(rewards, i)) {
        const rewardsList = rewards[i]['entries'];
        for (const j in rewardsList) {
          if (isDegreeRewardType(rewardsList[j]['resourceType'])) {
            tempDegreeList.push(new Degree(rewardsList[j]['resourceId']));
            if (
              tempDegreeList.length >=
              BANGDREAM_DEGREE_LIST_SPEC.eventRewards.maxDegreeCount
            )
              break;
          }
        }
      }
    }
    list.push(
      await drawDegreeListInList({
        degreeList: tempDegreeList,
        server: server,
      }),
    );
  }
  return stackImage(list);
}
