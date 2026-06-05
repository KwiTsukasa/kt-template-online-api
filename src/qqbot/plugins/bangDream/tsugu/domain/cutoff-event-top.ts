import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { Event } from '@/qqbot/plugins/bangDream/tsugu/domain/event';
import { callAPIAndCacheResponse } from '@/qqbot/plugins/bangDream/tsugu/data/get-api';
import { bestdoriUrl } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { BangDreamEventStatus } from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';

export class CutoffEventTop {
  eventId: number;
  server: Server;
  startAt: number;
  endAt: number;
  status: BangDreamEventStatus;
  isInitfull: boolean = false;
  isExist = false;
  points: {
    time: number;
    uid: number;
    value: number;
  }[];
  users: {
    uid: number;
    name: string;
    introduction: string;
    rank: number;
    sid: number;
    strained: number;
    degrees: number[];
    ranking: number;
    currentPt: number;
  }[];
  constructor(eventId: number, server: Server) {
    const event = new Event(eventId);
    if (!event.isExist) {
      this.isExist = false;
      return;
    }
    this.eventId = eventId;
    this.server = server;
    this.isExist = true;
    this.startAt = event.startAt[server];
    this.endAt = event.endAt[server];
    const time = new Date().getTime();
    if (time < event.startAt[this.server]) {
      this.status = BangDreamEventStatus.notStart;
    } else if (time > event.endAt[this.server]) {
      this.status = BangDreamEventStatus.ended;
    } else {
      this.status = BangDreamEventStatus.inProgress;
    }
  }
  async initFull() {
    if (!this.isExist) {
      return;
    }
    if (this.isInitfull) {
      return;
    }
    const topData = await callAPIAndCacheResponse(
      `${bestdoriUrl}/api/eventtop/data?server=${<number>this.server}&event=${this.eventId}&mid=0&interval=3600000`,
    );
    if (topData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.points = topData['points'] as {
      time: number;
      uid: number;
      value: number;
    }[];
    this.users = topData['users'] as {
      uid: number;
      name: string;
      introduction: string;
      rank: number;
      sid: number;
      strained: number;
      degrees: number[];
      ranking: number;
      currentPt: number;
    }[];
    if (this.points.length == 0 || this.users.length == 0) {
      //如果没有数据，返回不存在
      this.isExist = false;
      return;
    }
    const latestRanking = this.getLatestRanking();
    for (let i = 0; i < this.users.length; i++) {
      for (let j = 0; j < latestRanking.length; j++) {
        if (this.users[i].uid == latestRanking[j].uid) {
          this.users[i].ranking = j + 1;
          this.users[i].currentPt = latestRanking[j].point;
          break;
        }
      }
    }
  }
  getChartData(setStartToZero = false): {
    [key: number]: { x: Date; y: number }[];
  } {
    if (this.isExist == false) {
      return;
    }
    const chartDate: { [key: number]: { x: Date; y: number }[] } = {};
    for (let i = 0; i < this.points.length; i++) {
      const element = this.points[i];
      if (!(element.uid in chartDate)) {
        chartDate[element.uid] = [];
        if (setStartToZero) {
          chartDate[element.uid].push({ x: new Date(0), y: 0 });
          chartDate[element.uid].push({
            x: new Date(element.time - this.startAt),
            y: element.value,
          });
        } else {
          chartDate[element.uid].push({ x: new Date(this.startAt), y: 0 });
          chartDate[element.uid].push({
            x: new Date(element.time),
            y: element.value,
          });
        }
      } else {
        if (setStartToZero) {
          chartDate[element.uid].push({
            x: new Date(element.time - this.startAt),
            y: element.value,
          });
        } else {
          chartDate[element.uid].push({
            x: new Date(element.time),
            y: element.value,
          });
        }
      }
    }
    return chartDate;
  }
  getLatestRanking(): { uid: number; point: number }[] {
    const result: { uid: number; point: number }[] = [];
    let index = this.points.length - 10;
    while (index < this.points.length) {
      const element = this.points[index];
      result.push({ uid: element.uid, point: element.value });
      index++;
    }
    result.sort((a, b) => b.point - a.point);
    return result;
  }
  getUserByUid(id: number): {
    uid: number;
    name: string;
    introduction: string;
    rank: number;
    sid: number;
    strained: number;
    degrees: number[];
    ranking: number;
    currentPt: number;
  } {
    for (let i = 0; i < this.users.length; i++) {
      if (this.users[i].uid == id) {
        return this.users[i];
      }
    }
    return;
  }
  getUserNameById(id: number): string {
    for (let i = 0; i < this.users.length; i++) {
      if (this.users[i].uid == id) {
        return this.users[i].name;
      }
    }
    return;
  }
}
