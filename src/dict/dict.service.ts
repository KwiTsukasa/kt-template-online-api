import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { setDictDecodeCache } from '@/common';
import { DictEntity } from './dict.entity';

const COMPONENT_TYPE_DICT_KEY = 'COMPONENT_TYPE';

@Injectable()
export class DictService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(DictEntity)
    private readonly dictRepository: Repository<DictEntity>,
  ) {}

  async onApplicationBootstrap() {
    await this.refreshDecodeCache();
  }

  async getDictByKey(dictKey: string): Promise<Dict[]> {
    const list = await this.dictRepository.find({
      where: {
        dictKey,
        is_deleted: false,
      },
      order: {
        sort: 'ASC',
        createTime: 'ASC',
      },
    });

    return list.map(({ label, value }) => ({
      label,
      value: Number.isNaN(Number(value)) ? value : Number(value),
    }));
  }

  async getComponentDictByType(type: number): Promise<Dict[]> {
    // 一级类型的 childrenKey 决定二级字典来源，避免在代码里维护 1 -> CHART 这类关系。
    const componentType = await this.dictRepository.findOne({
      where: {
        dictKey: COMPONENT_TYPE_DICT_KEY,
        value: String(type),
        is_deleted: false,
      },
    });

    if (!componentType?.childrenKey) return [];

    return this.getDictByKey(componentType.childrenKey);
  }

  async refreshDecodeCache() {
    // AfterLoad 字典翻译必须同步完成，所以这里先把数据库字典刷新到进程缓存。
    const list = await this.dictRepository.find({
      where: {
        is_deleted: false,
      },
      order: {
        sort: 'ASC',
        createTime: 'ASC',
      },
    });

    setDictDecodeCache(list);
  }
}
