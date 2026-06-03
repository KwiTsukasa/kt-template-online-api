import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { setDictDecodeCache } from '@/common';
import { AdminDict } from './admin-dict.entity';

const COMPONENT_TYPE_DICT_KEY = 'COMPONENT_TYPE';

export type AdminDictItem = {
  childrenCode?: string | null;
  label: string;
  value: string;
};

@Injectable()
export class DictService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(AdminDict)
    private readonly dictRepository: Repository<AdminDict>,
  ) {}

  async onApplicationBootstrap() {
    await this.refreshDecodeCache();
  }

  async getDictByKey(dictKey: string): Promise<Dict[]> {
    const list = await this.getDictItemsByKey(dictKey);

    return list.map(({ label, value }) => ({
      label,
      value: Number.isNaN(Number(value)) ? value : Number(value),
    }));
  }

  async getDictItemsByKey(dictKey: string): Promise<AdminDictItem[]> {
    const list = await this.dictRepository.find({
      where: {
        dictCode: dictKey,
        isDeleted: false,
        status: 1,
      },
      order: {
        sort: 'ASC',
        createTime: 'ASC',
      },
    });

    return list.map(({ childrenCode, label, value }) => ({
      childrenCode,
      label,
      value,
    }));
  }

  async getComponentDictByType(type: number): Promise<Dict[]> {
    // 一级类型的 childrenCode 决定二级字典来源，避免在代码里维护 1 -> CHART 这类关系。
    const componentType = await this.dictRepository.findOne({
      where: {
        dictCode: COMPONENT_TYPE_DICT_KEY,
        isDeleted: false,
        status: 1,
        value: String(type),
      },
    });

    if (!componentType?.childrenCode) return [];

    return this.getDictByKey(componentType.childrenCode);
  }

  async refreshDecodeCache() {
    // AfterLoad 字典翻译必须同步完成，所以这里先把数据库字典刷新到进程缓存。
    const list = await this.dictRepository.find({
      where: {
        isDeleted: false,
        status: 1,
      },
      order: {
        sort: 'ASC',
        createTime: 'ASC',
      },
    });

    setDictDecodeCache(
      list.map(({ dictCode, label, value }) => ({
        dictKey: dictCode,
        label,
        value,
      })),
    );
  }
}
