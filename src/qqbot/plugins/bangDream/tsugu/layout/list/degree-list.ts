import { drawList } from '../list';
import { Canvas } from 'skia-canvas';
import { drawDegree } from '@/qqbot/plugins/bangDream/tsugu/layout/degree';
import { Degree } from '@/qqbot/plugins/bangDream/tsugu/domain/degree';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { Event } from '@/qqbot/plugins/bangDream/tsugu/domain/event';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';

interface DegreeListInListOptions {
  key?: string;
  degreeList: Array<Degree>;
  server?: Server;
  displayedServerList?: Server[];
}

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
    textSize: 50,
  });
}

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
    if (rankingRewards[i].rewardType == 'degree') {
      tempDegreeList.push(new Degree(rankingRewards[i].rewardId));
      if (tempDegreeList.length >= 6) break;
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
  if (
    event.eventType == 'versus' ||
    event.eventType == 'challenge' ||
    event.eventType == 'medley'
  ) {
    const rewards = event.musics[server];
    for (let i = 0; i < rewards.length; i++) {
      const tempDegreeList = [];
      for (let n = 0; n < rewards[i].musicRankingRewards.length; n++) {
        if (rewards[i].musicRankingRewards[n].resourceType == 'degree') {
          tempDegreeList.push(
            new Degree(rewards[i].musicRankingRewards[n].resourceId),
          );
          if (tempDegreeList.length >= 6) break;
        }
      }
      list.push(
        await drawDegreeListInList({
          degreeList: tempDegreeList,
          server: server,
          displayedServerList: displayedServerList,
        }),
      );
      if (event.eventType == 'medley') {
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
          if (rewardsList[j]['resourceType'] == 'degree') {
            tempDegreeList.push(new Degree(rewardsList[j]['resourceId']));
            if (tempDegreeList.length >= 6) break;
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
