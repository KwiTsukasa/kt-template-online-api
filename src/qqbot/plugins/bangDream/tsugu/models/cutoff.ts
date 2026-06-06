import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/bestdori-provider';
import { bangDreamHhwxTrackerProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/hhwx-tracker-provider';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/data-provider';
import { bangDreamMainDataRepository } from '@/qqbot/plugins/bangDream/tsugu/models/main-data-repository';
import {
  preferHhwxSource,
  reportDataSourceProblem,
  clearDataSourceProblem,
  tierListOfServer,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import {
  Event,
  getPresentEvent,
} from '@/qqbot/plugins/bangDream/tsugu/models/event';
import { predict } from '@/qqbot/plugins/bangDream/tsugu/calculations/cutoff-predictor';
import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/logger';
import {
  normalizeTimestamp,
  getDateByServerTimezone,
  getServerUtcOffset,
  getProbableTimeDifference,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-time';
import { BangDreamEventStatus } from '@/qqbot/plugins/bangDream/tsugu/models/bangdream-constants';

export class Cutoff {
  eventId: number;
  server: Server;
  tier: number;
  isExist = false;
  cutoffs: { time: number; ep: number }[];
  eventType: string;
  latestCutoff: { time: number; ep: number };
  rate: number | null;
  predictEP: number;
  startAt: number;
  endAt: number;
  status: BangDreamEventStatus;
  isInitfull: boolean = false;
  useHHWX = preferHhwxSource;
  dailyIncrement = [];
  currentGetDataTime;
  /**
   * 构造 Cutoff 实例，并初始化该模型的本地基础字段。
   *
   * @param eventId - 活动 ID。
   * @param server - 目标服务器。
   * @param tier - tier参数。
   */
  constructor(eventId: number, server: Server, tier: number) {
    const event = new Event(eventId);
    //如果活动不存在，直接返回
    if (!event.isExist) {
      this.isExist = false;
      return;
    }
    this.eventType = event.eventType;
    this.eventId = eventId;
    this.server = server;
    //如果该档线不在该服的档线列表中，直接返回
    if (!tierListOfServer[Server[server]].includes(tier)) {
      this.isExist = false;
      return;
    }
    this.tier = tier;
    this.isExist = true;
    // this.startAt = event.startAt[server]
    // this.endAt = event.endAt[server]
    // 当该活动在服务器上尚未存在时，使用预测的时间去推断startAt以及endAt，以解决部分情况下卡死及档线状态不对的问题
    this.startAt =
      event.startAt[server] || server != Server.cn
        ? event.startAt[server]
        : getProbableTimeDifference(this.eventId, getPresentEvent(this.server));
    this.endAt =
      event.endAt[server] || server != Server.cn
        ? event.endAt[server]
        : getProbableTimeDifference(
            this.eventId,
            getPresentEvent(this.server),
          ) +
          (event.endAt[Server.jp] - event.startAt[Server.jp]);
    const tempEvent = new Event(this.eventId);
    this.currentGetDataTime = new Date().getTime();
    //状态
    const time = new Date().getTime();
    if (time < tempEvent.startAt[this.server]) {
      this.status = BangDreamEventStatus.notStart;
    } else if (time > tempEvent.endAt[this.server]) {
      this.status = BangDreamEventStatus.ended;
    } else {
      this.status = BangDreamEventStatus.inProgress;
    }
  }
  /**
   * 在 Cutoff 模型中获取最终 Tracker 数据源。
   *
   * @param reverse - reverse参数。
   */
  getFinalTrackerProvider(reverse: boolean): BangDreamDataProvider {
    // reverse:是否反向获取。假如useHHWX为False，当反向开启后就使用HHWX
    if (this.server != Server.cn) {
      // 非国服不使用HHWX
      this.useHHWX = false;
      return bangDreamBestdoriProvider;
    }
    const provider = !reverse
      ? this.useHHWX
        ? bangDreamHhwxTrackerProvider
        : bangDreamBestdoriProvider
      : this.useHHWX
        ? bangDreamBestdoriProvider
        : bangDreamHhwxTrackerProvider;
    if (reverse && this.server == Server.cn) this.useHHWX = !this.useHHWX;
    return provider;
  }
  /**
   * 在 Cutoff 模型中拉取最终档线列表数据。
   *
   * @param reverse - reverse参数。
   * @param cacheTime - 缓存时间参数。
   */
  async fetchFinalCutoffsData(reverse: boolean, cacheTime: number) {
    const provider = this.getFinalTrackerProvider(reverse);
    return await provider.getTracker({
      cacheTime,
      eventId: this.eventId,
      server: this.server,
      tier: this.tier,
    });
  }
  /**
   * 在 Cutoff 模型中记录最终档线列表来源Problem。
   *
   * @param e - e参数。
   */
  reportFinalCutoffsSourceProblem(e) {
    if (e?.response?.status != 404 && this.server == Server.cn) {
      reportDataSourceProblem();
    }
  }
  /**
   * 在 Cutoff 模型中获取最终档线列表数据。
   *
   * @param forceReadCache - forceRead缓存参数，未传入时使用默认值。
   */
  async getFinalCutoffsData(forceReadCache: boolean = false) {
    const cacheTime = forceReadCache ? 1 / 0 : 0;
    try {
      // 当数据源获取出现网络问题时切换到另一数据源获取数据
      return await this.fetchFinalCutoffsData(false, cacheTime);
    } catch (e) {
      this.reportFinalCutoffsSourceProblem(e);
      logger(
        'Cutoff.ts/getFinalCutoffsData',
        `数据源 ${this.useHHWX ? 'HHWX' : 'Bestdori'} 获取失败，尝试切换备用源`,
      );
      try {
        return await this.fetchFinalCutoffsData(true, cacheTime);
      } catch {
        return null;
      }
    }
  }
  /**
   * 在 Cutoff 模型中加载远端完整详情并标记初始化状态。
   */
  async initFull() {
    if (this.isInitfull) {
      return;
    }
    if (this.isExist == false) {
      return;
    }
    let cutoffData;
    //如果cutoff的活动已经结束，则使用缓存
    const time = new Date().getTime();
    if (time < this.endAt + 1000 * 60 * 60 * 24 * 2) {
      const oldDataSourceFlags = this.useHHWX;
      cutoffData = await this.getFinalCutoffsData();
      if (!cutoffData) {
        this.isExist = false;
        return;
      }
      // let dateNow = Date.now()
      if (
        this.server == Server.cn &&
        cutoffData['cutoffs'] &&
        cutoffData['cutoffs'].length != 0 &&
        time - cutoffData['cutoffs'][cutoffData['cutoffs'].length - 1].time >=
          2700000
      ) {
        // 对数据进行实时性检查，如果不通过则使用另一个数据源数据.确保服务器时间对齐东八区
        this.useHHWX = !this.useHHWX;
        logger(
          'Cutoff.ts/initFull',
          `数据实时性校验不通过，切换数据源至${this.useHHWX ? 'HHWX' : 'Bestdori'} `,
        );
        reportDataSourceProblem();
        const cutoffData2 = await this.getFinalCutoffsData();
        if (
          cutoffData['cutoffs'][cutoffData['cutoffs'].length - 1].time <
          cutoffData2['cutoffs'][cutoffData2['cutoffs'].length - 1].time
        ) {
          // 对比两个数据源的数据哪个更加实时
          cutoffData = cutoffData2;
        }
      } else if (
        this.server == Server.cn &&
        cutoffData['cutoffs'] &&
        cutoffData['cutoffs'].length != 0 &&
        oldDataSourceFlags == this.useHHWX
      ) {
        // 正在进行的活动，数据源数据无问题，清空计数器.
        clearDataSourceProblem();
      }
    } else {
      const useCache = true;
      cutoffData = await this.getFinalCutoffsData(useCache);
      // 检查缓存是否合法
      if (
        cutoffData['cutoffs'] &&
        (cutoffData['cutoffs'].length == 0 ||
          (cutoffData['cutoffs'].length != 0 &&
            this.endAt -
              cutoffData['cutoffs'][cutoffData['cutoffs'].length - 1].time >
              410000))
      ) {
        cutoffData = await this.getFinalCutoffsData();
      } //如果最后一个记录的时间减去endAt，校验如果差距太大就要更新
    }
    if (cutoffData == undefined) {
      this.isExist = false;
      return;
    } else if (cutoffData['result'] == false) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.cutoffs = cutoffData['cutoffs'] as { time: number; ep: number }[];
    if (this.cutoffs.length == 0) {
      const event = new Event(this.eventId);
      this.latestCutoff = { time: event.startAt[this.server], ep: 0 };
      return;
    } else {
      this.latestCutoff = this.cutoffs[this.cutoffs.length - 1];
    }
    //rate
    const rateDataList = bangDreamMainDataRepository.getValue<
      Array<{ server: number; type: string; tier: number; rate: number }>
    >('rates');
    const rateData = rateDataList.find((element) => {
      return (
        element.server == this.server &&
        element.type == this.eventType &&
        element.tier == this.tier
      );
    });
    if (rateData == undefined) {
      this.rate = null;
    } else {
      this.rate = rateData.rate;
    }
    try {
      this.getDailyIncrement();
    } catch {}
    if (this.status == BangDreamEventStatus.inProgress) {
      this.predict();
    }
    this.isInitfull = true;
  }
  /**
   * 在 Cutoff 模型中处理预测。
   *
   * @returns 计算后的数值。
   */
  predict(): number {
    if (this.isExist == false) {
      return;
    }
    const { startTs, endTs } = this.getPredictionWindow();
    const cutoffTs = this.getCutoffsInSeconds();
    try {
      this.predictEP = Math.floor(
        predict(cutoffTs, startTs, endTs, this.rate).ep,
      );
    } catch {
      this.predictEP = 0;
    }
    return this.predictEP;
  }
  /**
   * 在 Cutoff 模型中获取预测Window。
   *
   * @returns 计算后的数值。
   */
  getPredictionWindow(): { startTs: number; endTs: number } {
    const event = new Event(this.eventId);
    return {
      startTs: Math.floor(event.startAt[this.server] / 1000),
      endTs: Math.floor(event.endAt[this.server] / 1000),
    };
  }
  /**
   * 在 Cutoff 模型中获取档线列表InSeconds。
   *
   * @returns 计算后的数值。
   */
  getCutoffsInSeconds(): { time: number; ep: number }[] {
    return this.cutoffs.map((element) => ({
      time: Math.floor(element.time / 1000),
      ep: element.ep,
    }));
  }
  /**
   * 在 Cutoff 模型中获取预测History。
   *
   * @returns 计算后的数值。
   */
  getPredictionHistory(): { time: number; ep: number }[] {
    if (this.isExist == false || !this.cutoffs) {
      return [];
    }
    const { startTs, endTs } = this.getPredictionWindow();
    const cutoffTs = this.getCutoffsInSeconds();
    const history: { time: number; ep: number }[] = [];
    for (let i = 0; i < cutoffTs.length; i++) {
      let result;
      try {
        result = predict(cutoffTs.slice(0, i + 1), startTs, endTs, this.rate);
      } catch {
        continue;
      }
      if (result && result.ep && !isNaN(result.ep) && result.ep !== 0) {
        history.push({ time: this.cutoffs[i].time, ep: Math.floor(result.ep) });
      }
    }
    return history;
  }
  /**
   * 在 Cutoff 模型中获取DaysOf活动。
   *
   * @param ts - ts参数。
   */
  getDaysOfEvent(ts: number) {
    if (!this.startAt) return 0;
    const offsetMs = getServerUtcOffset(this.server) * 60 * 60 * 1000;
    const eventStartAtTime = normalizeTimestamp(this.startAt);
    const timestamp = normalizeTimestamp(ts);

    const serverStartTime = eventStartAtTime + offsetMs;

    const startDate = new Date(serverStartTime);

    const hour = startDate.getUTCHours();
    const minute = startDate.getUTCMinutes();
    const second = startDate.getUTCSeconds();
    const millisecond = startDate.getUTCMilliseconds();

    const firstDayEndServerTime =
      serverStartTime +
      (86400000 +
        4 * 60 * 60 * 1000 -
        hour * 60 * 60 * 1000 -
        minute * 60 * 1000 -
        second * 1000 -
        millisecond);

    const firstDayEndTime = firstDayEndServerTime - offsetMs;

    if (timestamp < firstDayEndTime) {
      return 0;
    } else {
      return Math.ceil((timestamp - firstDayEndTime) / 86400000);
    }
  }
  /**
   * 在 Cutoff 模型中判断日增Checkpoint。
   *
   * @param date - date参数。
   * @returns 判断结果。
   */
  isDailyCheckpoint(date: Date): boolean {
    return (
      (this.server == Server.cn ||
        this.server == Server.tw ||
        this.server == Server.jp) &&
      date.getUTCHours() === 3 &&
      date.getUTCMinutes() === 45
    );
  }
  /**
   * 在 Cutoff 模型中获取日增CheckpointSeries。
   *
   * @returns 计算后的数值。
   */
  getDailyCheckpointSeries(): { score: number[]; time: number[] } {
    const score: number[] = [];
    const time: number[] = [];
    for (const c of this.cutoffs) {
      const timestamp = normalizeTimestamp(c.time);
      const date = getDateByServerTimezone(timestamp, this.server);
      if (this.isDailyCheckpoint(date)) {
        score.push(c.ep);
        time.push(timestamp);
      }
    }
    return { score, time };
  }
  /**
   * 在 Cutoff 模型中追加MissingHead分数列表。
   *
   * @param scoreFinal - 分数最终参数。
   * @param invalidDays - invalidDays参数。
   * @param cutoffLastDataDays - 档线Last数据Days参数。
   * @returns 计算后的数值。
   */
  appendMissingHeadScores(
    scoreFinal: number[],
    invalidDays: Set<number>,
    cutoffLastDataDays: number,
  ): number {
    const lastCutoff = this.cutoffs[this.cutoffs.length - 1];
    let j = 0; // 临时天数存放
    for (let i = 0; i <= cutoffLastDataDays; i++) {
      if (cutoffLastDataDays == 0) {
        scoreFinal.push(lastCutoff.ep);
        break;
      }
      const avgIncrementValue = Math.round(lastCutoff.ep / cutoffLastDataDays); // 计算丢失的天数的平均增量
      scoreFinal.push(Math.round(avgIncrementValue * (i + 1))); // 把丢失的天数的数据补全
      invalidDays.add(scoreFinal.length - 1); // 记录增量数据不完整的天数位置
      j++; // 增加一天
    }
    return j;
  }
  /**
   * 在 Cutoff 模型中追加Interpolated分数列表。
   *
   * @param scoreFinal - 分数最终参数。
   * @param invalidDays - invalidDays参数。
   * @param startScore - start分数参数。
   * @param endScore - end分数参数。
   * @param lostDays - lostDays参数。
   */
  appendInterpolatedScores(
    scoreFinal: number[],
    invalidDays: Set<number>,
    startScore: number,
    endScore: number,
    lostDays: number,
  ): void {
    const avgIncrementValue = Math.round((endScore - startScore) / lostDays); // 计算丢失的天数的平均增量
    for (let ld = 0; ld < lostDays; ld++) {
      scoreFinal.push(Math.round(startScore + avgIncrementValue * (ld + 1))); // 把丢失的天数的数据补全
      invalidDays.add(scoreFinal.length - 1); // 记录增量数据不完整的天数位置
    }
  }
  /**
   * 在 Cutoff 模型中追加Checkpoint分数列表。
   *
   * @param scoreFinal - 分数最终参数。
   * @param invalidDays - invalidDays参数。
   * @param score - 分数参数。
   * @param time - 谱面时间点。
   * @param startDayIndex - startDay索引参数。
   * @returns 计算后的数值。
   */
  appendCheckpointScores(
    scoreFinal: number[],
    invalidDays: Set<number>,
    score: number[],
    time: number[],
    startDayIndex: number,
  ): number {
    let j = startDayIndex; // 临时天数存放

    for (let i = 0; i < score.length; i++) {
      const dayOfEvent = this.getDaysOfEvent(time[i]);
      if (dayOfEvent == j) {
        scoreFinal.push(score[i]);
        j++;
        continue;
      }
      if (dayOfEvent <= j) {
        continue;
      }

      const lostDays = dayOfEvent - j + 1;
      this.appendInterpolatedScores(
        scoreFinal,
        invalidDays,
        i == 0 ? 0 : score[i - 1],
        score[i],
        lostDays,
      );
      j += lostDays;
    }
    return j;
  }
  /**
   * 在 Cutoff 模型中追加MissingTail分数列表。
   *
   * @param scoreFinal - 分数最终参数。
   * @param invalidDays - invalidDays参数。
   * @param score - 分数参数。
   * @param time - 谱面时间点。
   * @param cutoffLastDataDays - 档线Last数据Days参数。
   */
  appendMissingTailScores(
    scoreFinal: number[],
    invalidDays: Set<number>,
    score: number[],
    time: number[],
    cutoffLastDataDays: number,
  ): void {
    // 尾处理 。当尾巴 this.getDaysOfEvent(time[time.length-1])不为1的时候，就说明尾是有多项数据缺失
    const missingDays =
      cutoffLastDataDays - this.getDaysOfEvent(time[time.length - 1]);
    if (missingDays <= 0) {
      return;
    }
    const avgIncrementValue = Math.round(
      (this.cutoffs[this.cutoffs.length - 1].ep - score[score.length - 1]) /
        missingDays,
    ); // 计算丢失的天数的平均增量
    for (let i = 0; i < missingDays; i++) {
      scoreFinal.push(
        Math.round(score[score.length - 1] + avgIncrementValue * (i + 1)),
      ); // 把丢失的天数的数据补全
      if (missingDays > 1) {
        invalidDays.add(scoreFinal.length - 1);
      }
    }
  }
  /**
   * 在 Cutoff 模型中转换为日增增量列表。
   *
   * @param scoreFinal - 分数最终参数。
   * @param invalidDays - invalidDays参数。
   * @returns 格式化后的文本。
   */
  toDailyIncrementList(
    scoreFinal: number[],
    invalidDays: Set<number>,
  ): string[] {
    const dailyIncrement = [];
    for (let i = 0; i < scoreFinal.length; i++) {
      // 计算增量
      if (i == 0) {
        dailyIncrement.push(
          `${Math.round(scoreFinal[i] / 10000)}${invalidDays.has(i) ? '!' : ''}`,
        );
      } else {
        dailyIncrement.push(
          `${Math.round((scoreFinal[i] - scoreFinal[i - 1]) / 10000)}${invalidDays.has(i) ? '!' : ''}`,
        );
      }
    }
    return dailyIncrement;
  }
  /**
   * 在 Cutoff 模型中获取日增增量。
   */
  getDailyIncrement() {
    if (!this.cutoffs || this.cutoffs.length === 0) {
      return;
    }

    const { score, time } = this.getDailyCheckpointSeries();
    const invalidDays = new Set<number>();
    const scoreFinal: number[] = [];
    const cutoffLastDataDays = this.getDaysOfEvent(
      this.cutoffs[this.cutoffs.length - 1].time,
    ); // 最后一个数据的天数
    const startDayIndex =
      score.length == 0
        ? this.appendMissingHeadScores(
            scoreFinal,
            invalidDays,
            cutoffLastDataDays,
          )
        : 0;

    this.appendCheckpointScores(
      scoreFinal,
      invalidDays,
      score,
      time,
      startDayIndex,
    );
    if (score.length != 0) {
      this.appendMissingTailScores(
        scoreFinal,
        invalidDays,
        score,
        time,
        cutoffLastDataDays,
      );
    }
    this.dailyIncrement = this.toDailyIncrementList(scoreFinal, invalidDays);
  }
  /**
   * 在 Cutoff 模型中获取Yesterday增量概率。
   */
  getYesterdayIncrementRate() {
    if (!this.cutoffs || this.cutoffs.length === 0) {
      return '无数据';
    }
    let lastCutoffTime = this.cutoffs[this.cutoffs.length - 1].time;
    // HHWX数据源会在快要结活的时候改为每15分钟抓取一次，因此需要主动规避
    let usePrevPoint = false;
    const UTCMin = getDateByServerTimezone(
      lastCutoffTime,
      this.server,
    ).getUTCMinutes();
    const UTCHour = getDateByServerTimezone(
      lastCutoffTime,
      this.server,
    ).getUTCHours();
    let lengthLimit = 2;
    if (UTCMin < 3 || (UTCMin >= 25 && UTCMin <= 35)) {
      lastCutoffTime = this.cutoffs[this.cutoffs.length - 2].time;
      usePrevPoint = true;
    }
    if (UTCMin == 45 && UTCHour == 3) lengthLimit++;
    const curEventDays = this.getDaysOfEvent(lastCutoffTime);
    const lastCutoffEp =
      this.cutoffs[this.cutoffs.length - (usePrevPoint ? 2 : 1)].ep;
    const score: number[] = [];
    const time: number[] = [];
    const scoreCur: number[] = [];
    const timeCur: number[] = [];
    const dateNow = getDateByServerTimezone(lastCutoffTime, this.server);
    const lastestUtcHour = dateNow.getUTCHours();
    const lastestUtcMinutes = dateNow.getUTCMinutes();

    for (const c of this.cutoffs) {
      let allowPushFlag = false;
      const timestamp = normalizeTimestamp(c.time);
      const d = this.getDaysOfEvent(timestamp);
      if (d < curEventDays - 2) {
        continue;
      }
      if (d > curEventDays - 2) {
        allowPushFlag = true;
      }
      const date = getDateByServerTimezone(timestamp, this.server);
      if (
        (this.server == Server.cn ||
          this.server == Server.tw ||
          this.server == Server.jp) &&
        date.getUTCHours() === 3 &&
        date.getUTCMinutes() === 45
      ) {
        score.push(c.ep);
        time.push(timestamp);
      }
      if (
        allowPushFlag &&
        (this.server == Server.cn ||
          this.server == Server.tw ||
          this.server == Server.jp) &&
        date.getUTCHours() === lastestUtcHour &&
        date.getUTCMinutes() === lastestUtcMinutes
      ) {
        scoreCur.push(c.ep);
        timeCur.push(timestamp);
      }
    }
    if (score.length != lengthLimit || scoreCur.length != 2) return '数据缺失';
    // 此时score里边应该会有两个数据，一个是昨日3:45，一个是今日3:45的数据
    const TodaysIncrement = lastCutoffEp - score[1];
    const YesterdaysIncrement = scoreCur[0] - score[0];
    const rate: number =
      YesterdaysIncrement != 0 ? TodaysIncrement / YesterdaysIncrement : 1;
    const result = `昨天同时刻日增${Math.round(YesterdaysIncrement / 10000)} 现在是昨天的${Math.round(rate * 100)}%${rate * 100 >= 100 ? '↑' : '↓'}`;
    return result;
  }
  /**
   * 在 Cutoff 模型中获取谱面数据。
   *
   * @param setStartToZero - setStartToZero参数，未传入时使用默认值。
   * @returns 计算后的数值。
   */
  getChartData(setStartToZero = false): { x: Date; y: number }[] {
    if (this.isExist == false) {
      return [];
    }
    const chartData: { x: Date; y: number }[] = [];
    if (setStartToZero) {
      chartData.push({ x: new Date(0), y: 0 });
    } else {
      chartData.push({ x: new Date(this.startAt), y: 0 });
    }

    // 在访问 this.cutoffs[0].time 之前检查 this.cutoffs 是否存在且长度大于0
    let tempTime =
      this.cutoffs && this.cutoffs.length > 0 ? this.cutoffs[0].time : null;
    // 如果 tempTime 为 null，则后续逻辑应当考虑这种情况以避免错误

    for (let i = 0; i < this.cutoffs.length; i++) {
      const element = this.cutoffs[i];
      if (setStartToZero) {
        // 确保 tempTime 不为 null 才执行减法操作
        chartData.push({
          x: tempTime ? new Date(element.time - this.startAt) : new Date(0),
          y: element.ep,
        });
      } else {
        chartData.push({ x: new Date(element.time), y: element.ep });
      }
      tempTime = element.time;
    }
    return chartData;
  }
}
