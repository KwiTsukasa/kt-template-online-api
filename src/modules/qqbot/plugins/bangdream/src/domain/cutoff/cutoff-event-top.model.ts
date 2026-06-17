import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { BangDreamEventStatus } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  cutoffEventTopRepository,
  type CutoffEventTopPoint,
  type CutoffEventTopUser,
} from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-event-top.repository';

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
  /**
   * 构造 CutoffEventTop 实例，并初始化该模型的本地基础字段。
   *
   * @param eventId - 活动 ID；定位本次读取、更新、删除或关联的活动。
   * @param server - server 输入；决定 BangDream条件分支。
   */
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
   * 在 CutoffEventTop 模型中加载远端完整详情并标记初始化状态。
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
   * 在 CutoffEventTop 模型中获取谱面数据。
   *
   * @param setStartToZero - setStartToZero 输入；决定 BangDream条件分支。
   * @returns 计算后的数值。
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
   * 查询 BangDream 插件数据。
   *
   * @returns 计算后的数值。
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
   * 查询 BangDream 插件数据。
   *
   * @param id - BangDream记录 ID；定位本次读取、更新、删除或关联的BangDream记录。
   * @returns 格式化后的文本。
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
   * 查询 BangDream 插件数据。
   *
   * @param id - BangDream记录 ID；定位本次读取、更新、删除或关联的BangDream记录。
   * @returns 格式化后的文本。
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
