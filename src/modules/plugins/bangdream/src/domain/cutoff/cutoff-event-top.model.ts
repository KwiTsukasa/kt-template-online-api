import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { Event } from '@/modules/plugins/bangdream/src/domain/event/event.model';
import { BangDreamEventStatus } from '@/modules/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  cutoffEventTopRepository,
  type CutoffEventTopPoint,
  type CutoffEventTopUser,
} from '@/modules/plugins/bangdream/src/domain/cutoff/cutoff-event-top.repository';

export class CutoffEventTop {
  eventId: number;
  server: Server;
  startAt: number;
  endAt: number;
  status: BangDreamEventStatus;
  isInitfull: boolean = false;
  isExist = false;
  points: CutoffEventTopPoint[];
  users: CutoffEventTopUser[];
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
  /**
   * 根据当前运行态处理initFull；当 `!this.isExist` 成立时直接结束且不产生返回值。
   */
  async initFull() {
    if (!this.isExist) {
      return;
    }
    if (this.isInitfull) {
      return;
    }
    const topData = await cutoffEventTopRepository.getTopData(
      this.eventId,
      this.server,
    );
    if (topData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.points = topData.points;
    this.users = topData.users;
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
  /**
   * 按`setStartToZero`读取Chart数据；当 `this.isExist == false` 成立时直接结束且不产生返回值。
   * @param setStartToZero - 决定Chart数据内容、边界或目标的 `setStartToZero` 值；省略时默认采用 `false`。
   * @returns 按输入顺序得到的Chart数据列表；没有可用结果或提前结束时为 `undefined`，没有匹配项时为空数组。
   */
  getChartData(setStartToZero = false): {
    [key: number]: { x: number; y: number }[];
  } {
    if (this.isExist == false) {
      return;
    }
    const chartDate: { [key: number]: { x: number; y: number }[] } = {};
    for (let i = 0; i < this.points.length; i++) {
      const element = this.points[i];
      if (!(element.uid in chartDate)) {
        chartDate[element.uid] = [];
        if (setStartToZero) {
          chartDate[element.uid].push({ x: 0, y: 0 });
          chartDate[element.uid].push({
            x: element.time - this.startAt,
            y: element.value,
          });
        } else {
          chartDate[element.uid].push({ x: this.startAt, y: 0 });
          chartDate[element.uid].push({
            x: element.time,
            y: element.value,
          });
        }
      } else {
        if (setStartToZero) {
          chartDate[element.uid].push({
            x: element.time - this.startAt,
            y: element.value,
          });
        } else {
          chartDate[element.uid].push({
            x: element.time,
            y: element.value,
          });
        }
      }
    }
    return chartDate;
  }
  /**
   * 按当前运行态读取Latest排名数据。
   * @returns 按输入顺序得到的Latest排名数据列表；没有匹配项时为空数组。
   */
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
  /**
   * 按`id`读取用户Uid；当 `this.users[i].uid == id` 成立时返回 `this.users[i]`。
   * @param id - 决定用户Uid内容、边界或目标的 `id` 值。
   * @returns 按输入顺序得到的用户Uid列表；没有可用结果或提前结束时为 `undefined`，没有匹配项时为空数组。
   */
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
  /**
   * 按`id`读取用户名称标识；当 `this.users[i].uid == id` 成立时返回 `this.users[i].name`。
   * @param id - 决定用户名称标识内容、边界或目标的 `id` 值。
   * @returns 用户名称标识；没有可用结果或提前结束时为 `undefined`。
   */
  getUserNameById(id: number): string {
    for (let i = 0; i < this.users.length; i++) {
      if (this.users[i].uid == id) {
        return this.users[i].name;
      }
    }
    return;
  }
}
