import { HttpStatus, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { setDictDecodeCache, throwVbenError } from '@/common';
import { AdminDict } from './admin-dict.entity';
import {
  AdminDictBodyDto,
  AdminDictQueryDto,
  AdminDictUpdateDto,
} from './dict.dto';

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

  async page(query: AdminDictQueryDto = {}) {
    const pageNo = this.toPositiveNumber(query.pageNo ?? query.page, 1);
    const pageSize = this.toPositiveNumber(query.pageSize, 20);
    const builder = this.dictRepository
      .createQueryBuilder('dict')
      .where('dict.isDeleted = :isDeleted', { isDeleted: false });

    const keyword = this.normalizeText(query.keyword);
    if (keyword) {
      builder.andWhere(
        new Brackets((subBuilder) => {
          subBuilder
            .where('dict.dictCode LIKE :keyword', {
              keyword: `%${keyword}%`,
            })
            .orWhere('dict.label LIKE :keyword', {
              keyword: `%${keyword}%`,
            })
            .orWhere('dict.value LIKE :keyword', {
              keyword: `%${keyword}%`,
            })
            .orWhere('dict.childrenCode LIKE :keyword', {
              keyword: `%${keyword}%`,
            });
        }),
      );
    }

    this.applyLikeFilter(builder, 'dictCode', query.dictCode);
    this.applyLikeFilter(builder, 'label', query.label);
    this.applyLikeFilter(builder, 'value', query.value);
    this.applyLikeFilter(builder, 'childrenCode', query.childrenCode);

    if (['0', '1'].includes(String(query.status))) {
      builder.andWhere('dict.status = :status', {
        status: Number(query.status),
      });
    }

    const [items, total] = await builder
      .orderBy('dict.dictCode', 'ASC')
      .addOrderBy('dict.sort', 'ASC')
      .addOrderBy('dict.createTime', 'ASC')
      .skip((pageNo - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: items.map((item) => this.serializeDict(item)),
      total,
    };
  }

  async getDictCodeOptions() {
    const rows = await this.dictRepository
      .createQueryBuilder('dict')
      .select('DISTINCT dict.dictCode', 'dictCode')
      .where('dict.isDeleted = :isDeleted', { isDeleted: false })
      .orderBy('dict.dictCode', 'ASC')
      .getRawMany<{ dictCode: string }>();

    return rows
      .filter((item) => !!item.dictCode)
      .map((item) => ({
        label: item.dictCode,
        value: item.dictCode,
      }));
  }

  async save(body: AdminDictBodyDto) {
    const input = this.normalizeInput(body);
    const existing = await this.findByCodeValue(input.dictCode, input.value);
    if (existing && !existing.isDeleted) {
      throwVbenError('同一字典编码下的字典值已存在', HttpStatus.BAD_REQUEST);
    }

    const entity = existing
      ? this.dictRepository.merge(existing, {
          ...input,
          isDeleted: false,
        })
      : this.dictRepository.create(input);

    await this.dictRepository.save(entity);
    await this.refreshDecodeCache();
    return entity.id;
  }

  async update(body: AdminDictUpdateDto) {
    const id = this.normalizeText(body.id);
    if (!id) throwVbenError('字典项ID不能为空', HttpStatus.BAD_REQUEST);

    const dict = await this.dictRepository.findOne({
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!dict) throwVbenError('字典项不存在', HttpStatus.BAD_REQUEST);

    const input = this.normalizeInput({
      childrenCode: body.childrenCode ?? dict.childrenCode,
      dictCode: body.dictCode ?? dict.dictCode,
      label: body.label ?? dict.label,
      sort: body.sort ?? dict.sort,
      status: body.status ?? dict.status,
      value: body.value ?? dict.value,
    });
    const existing = await this.findByCodeValue(input.dictCode, input.value);
    if (existing && existing.id !== id) {
      throwVbenError('同一字典编码下的字典值已存在', HttpStatus.BAD_REQUEST);
    }

    await this.dictRepository.save(
      this.dictRepository.merge(dict, {
        ...input,
      }),
    );
    await this.refreshDecodeCache();
    return null;
  }

  async remove(id: string) {
    const normalizedId = this.normalizeText(id);
    if (!normalizedId)
      throwVbenError('字典项ID不能为空', HttpStatus.BAD_REQUEST);

    const dict = await this.dictRepository.findOne({
      where: {
        id: normalizedId,
        isDeleted: false,
      },
    });
    if (!dict) throwVbenError('字典项不存在', HttpStatus.BAD_REQUEST);

    await this.dictRepository.update(
      { id: normalizedId },
      {
        isDeleted: true,
      },
    );
    await this.refreshDecodeCache();
    return null;
  }

  async toggle(id: string, status: number) {
    const normalizedStatus = status === 1 ? 1 : 0;
    await this.update({
      id,
      status: normalizedStatus,
    });
    return null;
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

  private applyLikeFilter(
    builder: ReturnType<Repository<AdminDict>['createQueryBuilder']>,
    field: keyof Pick<
      AdminDict,
      'childrenCode' | 'dictCode' | 'label' | 'value'
    >,
    value?: string,
  ) {
    const normalizedValue = this.normalizeText(value);
    if (!normalizedValue) return;

    builder.andWhere(`dict.${field} LIKE :${field}`, {
      [field]: `%${normalizedValue}%`,
    });
  }

  private async findByCodeValue(dictCode: string, value: string) {
    return this.dictRepository.findOne({
      where: {
        dictCode,
        value,
      },
    });
  }

  private normalizeInput(body: AdminDictBodyDto): Partial<AdminDict> {
    const dictCode = this.normalizeText(body.dictCode);
    const label = this.normalizeText(body.label);
    const value = this.normalizeText(body.value);

    if (!dictCode) throwVbenError('字典编码不能为空', HttpStatus.BAD_REQUEST);
    if (!label) throwVbenError('字典标签不能为空', HttpStatus.BAD_REQUEST);
    if (!value) throwVbenError('字典值不能为空', HttpStatus.BAD_REQUEST);

    return {
      childrenCode: this.normalizeNullableText(body.childrenCode),
      dictCode,
      label,
      sort: Number.isFinite(Number(body.sort)) ? Number(body.sort) : 0,
      status: Number(body.status) === 0 ? 0 : 1,
      value,
    };
  }

  private normalizeNullableText(value?: number | string | null) {
    const text = this.normalizeText(value);
    return text || null;
  }

  private normalizeText(value?: number | string | null) {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  private serializeDict(dict: AdminDict) {
    return {
      childrenCode: dict.childrenCode,
      createTime: dict.createTime,
      dictCode: dict.dictCode,
      id: dict.id,
      label: dict.label,
      sort: dict.sort,
      status: dict.status,
      updateTime: dict.updateTime,
      value: dict.value,
    };
  }

  private toPositiveNumber(
    value: number | string | undefined,
    fallback: number,
  ) {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : fallback;
  }
}
