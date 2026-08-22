import { Image, loadImage } from 'skia-canvas';
import {
  Server,
  getServerByPriority,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import bangdreamCatalogCache from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import { itemResourceRepository } from '@/modules/plugins/bangdream/src/domain/catalog/item-resource.repository';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { BANGDREAM_ITEM_TYPE_PREFIXES } from '@/modules/plugins/bangdream/src/domain/common/bangdream-protocol';

export class Item {
  name: Array<string | null>;
  resourceId: number;
  itemId: string;
  type: string;
  typeName: string;
  isExist = false;
  constructor(itemId: string) {
    //如果是星石
    if (itemId == 'paid_star' || itemId == 'free_star') {
      if (itemId == 'paid_star') {
        this.name = [
          '有料スター',
          'paid star',
          'paid star',
          '付费星石',
          'paid star',
        ];
      } else {
        this.name = [
          '無料スター',
          'free star',
          'free star',
          '免费星石',
          'free star',
        ];
      }
      this.resourceId = 0;
      this.type = 'star';
      this.isExist = true;
      this.typeName = 'star';
      return;
    }
    //如果是其他物品
    const itemData = bangdreamCatalogCache['items'][itemId];
    if (itemData == undefined) {
      return;
    }
    this.isExist = true;
    this.itemId = itemId;
    this.name = itemData['name'];
    this.resourceId = itemData['resourceId'];
    for (const [prefix, typeName] of BANGDREAM_ITEM_TYPE_PREFIXES) {
      if (this.itemId.startsWith(prefix)) {
        this.typeName = typeName;
        break;
      }
    }
  }
  /**
   * 按`server`、`displayedServerList`读取条目图片；从受控资源来源加载所需数据（`itemResourceRepository.getImageBuffer`）。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param displayedServerList - 决定条目图片内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 条目图片。
   */
  async getItemImage(
    server?: Server,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    if (server == undefined) {
      server = getServerByPriority(this.name, displayedServerList);
    }
    server = getServerByPriority(this.name, displayedServerList);
    const itemImageBuffer = await itemResourceRepository.getImageBuffer(
      this,
      server,
    );
    return await loadImage(itemImageBuffer);
  }
}
