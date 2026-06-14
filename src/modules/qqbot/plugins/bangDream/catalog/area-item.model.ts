import mainAPI from '@/modules/qqbot/plugins/bangDream/shared/main-data-store';
import { Server } from '@/modules/qqbot/plugins/bangDream/catalog/server.model';
import { Card, Stat } from '@/modules/qqbot/plugins/bangDream/card/card.model';

export class AreaItem {
  areaItemId: number;
  isExist: boolean = false;
  level: Array<number | null>;
  areaItemLevel: number;
  areaItemName: Array<string | null>;
  description: { [areaItemLevel: number]: Array<string | null> };
  performance: { [areaItemLevel: number]: Array<string | null> };
  technique: { [areaItemLevel: number]: Array<string | null> };
  visual: { [areaItemLevel: number]: Array<string | null> };
  targetAttributes: Array<'cool' | 'happy' | 'pure' | 'powerful'>;
  targetBandIds: Array<number>;
  /**
   * 构造 AreaItem 实例，并初始化该模型的本地基础字段。
   *
   * @param areaItemId - 区域道具ID参数。
   */
  constructor(areaItemId: number) {
    this.areaItemId = areaItemId;
    const areaItemData = mainAPI['areaItems'][areaItemId.toString()];
    if (areaItemData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.level = areaItemData['level'];
    this.areaItemName = areaItemData['areaItemName'];
    this.description = areaItemData['description'];
    this.performance = areaItemData['performance'];
    this.technique = areaItemData['technique'];
    this.visual = areaItemData['visual'];
    this.targetAttributes = areaItemData['targetAttributes'];
    this.targetBandIds = areaItemData['targetBandIds'];
  }
  /**
   * 在 AreaItem 模型中计算数值。
   *
   * @param card - 卡牌参数。
   * @param areaItemLevel - 区域道具等级参数。
   * @param cardSTat - 卡牌STat参数。
   * @param server - 目标服务器。
   * @returns 处理结果。
   */
  calcStat(
    card: Card,
    areaItemLevel: number,
    cardSTat: Stat,
    server: Server,
  ): Stat {
    const emptyStat: Stat = {
      //空综合力变量
      performance: 0,
      technique: 0,
      visual: 0,
    };
    if (!this.isExist) {
      return emptyStat;
    }
    if (
      this.targetAttributes.includes(card.attribute) &&
      this.targetBandIds.includes(card.bandId)
    ) {
      const finalStat = {
        performance:
          (this.performance[areaItemLevel.toString()][server] *
            cardSTat.performance) /
          100,
        technique:
          (this.technique[areaItemLevel.toString()][server] *
            cardSTat.technique) /
          100,
        visual:
          (this.visual[areaItemLevel.toString()][server] * cardSTat.visual) /
          100,
      };
      return finalStat;
    } else {
      return emptyStat;
    }
  }
}
