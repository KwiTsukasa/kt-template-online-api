import { HttpStatus, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  setDictDecodeCache,
  throwVbenError,
  ToolsService,
  type KtDictOption,
} from '@/common';
import { AdminDict } from './admin-dict.entity';
import {
  AdminDictBodyDto,
  AdminDictQueryDto,
  AdminDictUpdateDto,
} from './dict.dto';
import type {
  AdminDictGroupItem,
  AdminDictItem,
  AdminDictSerialized,
  AdminDictTreeItem,
} from '../admin.types';

const COMPONENT_TYPE_DICT_KEY = 'COMPONENT_TYPE';

@Injectable()
export class DictService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(AdminDict)
    private readonly dictRepository: Repository<AdminDict>,
    private readonly toolsService: ToolsService,
  ) {}

  async onApplicationBootstrap() {
    await this.refreshDecodeCache();
  }

  async getDictByKey(dictKey: string): Promise<KtDictOption[]> {
    const list = await this.getDictItemsByKey(dictKey);

    return list.map(({ label, value }) => ({
      label,
      value: Number.isNaN(Number(value)) ? value : Number(value),
    }));
  }

  async page(query: AdminDictQueryDto = {}) {
    const pageNo = this.toolsService.toPositiveNumber(
      query.pageNo ?? query.page,
      1,
    );
    const pageSize = this.toolsService.toPositiveNumber(query.pageSize, 20);
    const builder = this.dictRepository
      .createQueryBuilder('dict')
      .where('dict.isDeleted = :isDeleted', { isDeleted: false });

    const keyword = this.toolsService.toTrimmedString(query.keyword);
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

  async groups(query: AdminDictQueryDto = {}) {
    const pageNo = this.toolsService.toPositiveNumber(
      query.pageNo ?? query.page,
      1,
    );
    const pageSize = this.toolsService.toPositiveNumber(query.pageSize, 20);
    const builder = this.dictRepository
      .createQueryBuilder('dict')
      .where('dict.isDeleted = :isDeleted', { isDeleted: false });

    const keyword = this.toolsService.toTrimmedString(query.keyword);
    if (keyword) {
      builder.andWhere('dict.dictCode LIKE :keyword', {
        keyword: `%${keyword}%`,
      });
    }
    this.applyLikeFilter(builder, 'dictCode', query.dictCode);

    const totalRow = await builder
      .clone()
      .select('COUNT(DISTINCT dict.dictCode)', 'total')
      .getRawOne<{ total: string }>();
    const rows = await builder
      .select('dict.dictCode', 'dictCode')
      .addSelect('COUNT(dict.id)', 'itemCount')
      .groupBy('dict.dictCode')
      .orderBy('dict.dictCode', 'ASC')
      .offset((pageNo - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<{ dictCode: string; itemCount: string }>();

    return {
      items: rows.map((item) => this.serializeDictGroup(item)),
      total: Number(totalRow?.total || 0),
    };
  }

  async tree(query: AdminDictQueryDto = {}) {
    return this.relationTree(query);
  }

  async relationTree(query: AdminDictQueryDto = {}) {
    const items = await this.dictRepository.find({
      where: {
        isDeleted: false,
      },
      order: {
        dictCode: 'ASC',
        sort: 'ASC',
        createTime: 'ASC',
      },
    });
    const serializedItems = items.map((item) => this.serializeDict(item));
    const visibleItems = this.filterRelationTreeItems(serializedItems, query);

    return this.buildDictRelationTree(visibleItems);
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
    const id = this.toolsService.toTrimmedString(body.id);
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
    const normalizedId = this.toolsService.toTrimmedString(id);
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

  async getComponentDictByType(type: number): Promise<KtDictOption[]> {
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
    const normalizedValue = this.toolsService.toTrimmedString(value);
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

  private buildDictRelationTree(
    items: AdminDictSerialized[],
  ): AdminDictTreeItem[] {
    const byDictCode = this.groupItemsByDictCode(items);
    const dictCodes = new Set(items.map((item) => item.dictCode));
    const referencedCodes = new Set(
      items
        .map((item) => this.toolsService.toTrimmedString(item.childrenCode))
        .filter((childrenCode) => childrenCode && dictCodes.has(childrenCode)),
    );
    const rootCodes = [...dictCodes].filter(
      (code) => !referencedCodes.has(code),
    );
    const targetRootCodes = rootCodes.length > 0 ? rootCodes : [...dictCodes];

    return items
      .filter((item) => targetRootCodes.includes(item.dictCode))
      .map((item) =>
        this.createTreeNode(
          item,
          byDictCode,
          item.id,
          new Set([item.dictCode]),
        ),
      );
  }

  private createTreeNode(
    item: AdminDictSerialized,
    byDictCode: Map<string, AdminDictSerialized[]>,
    treeKey: string,
    pathCodes: Set<string>,
  ): AdminDictTreeItem {
    const childrenCode = this.toolsService.toTrimmedString(item.childrenCode);
    const children =
      childrenCode && !pathCodes.has(childrenCode)
        ? byDictCode.get(childrenCode)
        : undefined;
    const nextPathCodes = new Set(pathCodes);
    if (childrenCode) nextPathCodes.add(childrenCode);
    const node: AdminDictTreeItem = {
      ...item,
      treeKey,
    };

    if (children?.length) {
      node.children = children.map((child) =>
        this.createTreeNode(
          child,
          byDictCode,
          `${treeKey}/${child.id}`,
          nextPathCodes,
        ),
      );
    }

    return node;
  }

  private filterRelationTreeItems(
    items: AdminDictSerialized[],
    query: AdminDictQueryDto,
  ) {
    if (!this.hasTreeFilter(query)) return items;

    const byDictCode = this.groupItemsByDictCode(items);
    const parentsByChildrenCode = this.groupParentsByChildrenCode(items);
    const visibleIds = new Set<string>();
    const matchedItems = items.filter((item) =>
      this.matchesTreeFilter(item, query),
    );

    matchedItems.forEach((item) => {
      this.collectRelatedTreeItems(
        item,
        byDictCode,
        parentsByChildrenCode,
        visibleIds,
      );
    });

    return items.filter((item) => visibleIds.has(item.id));
  }

  private collectRelatedTreeItems(
    item: AdminDictSerialized,
    byDictCode: Map<string, AdminDictSerialized[]>,
    parentsByChildrenCode: Map<string, AdminDictSerialized[]>,
    visibleIds: Set<string>,
  ) {
    if (visibleIds.has(item.id)) return;

    visibleIds.add(item.id);

    const parents = parentsByChildrenCode.get(item.dictCode) || [];
    parents.forEach((parent) =>
      this.collectRelatedTreeItems(
        parent,
        byDictCode,
        parentsByChildrenCode,
        visibleIds,
      ),
    );

    const childrenCode = this.toolsService.toTrimmedString(item.childrenCode);
    if (!childrenCode) return;

    const children = byDictCode.get(childrenCode) || [];
    children.forEach((child) =>
      this.collectRelatedTreeItems(
        child,
        byDictCode,
        parentsByChildrenCode,
        visibleIds,
      ),
    );
  }

  private groupItemsByDictCode(items: AdminDictSerialized[]) {
    const map = new Map<string, AdminDictSerialized[]>();

    items.forEach((item) => {
      const list = map.get(item.dictCode) || [];
      list.push(item);
      map.set(item.dictCode, list);
    });

    return map;
  }

  private groupParentsByChildrenCode(items: AdminDictSerialized[]) {
    const map = new Map<string, AdminDictSerialized[]>();

    items.forEach((item) => {
      const childrenCode = this.toolsService.toTrimmedString(item.childrenCode);
      if (!childrenCode) return;

      const list = map.get(childrenCode) || [];
      list.push(item);
      map.set(childrenCode, list);
    });

    return map;
  }

  private hasTreeFilter(query: AdminDictQueryDto) {
    return (
      [
        query.childrenCode,
        query.dictCode,
        query.keyword,
        query.label,
        query.value,
      ].some((value) => !!this.toolsService.toTrimmedString(value)) ||
      ['0', '1'].includes(String(query.status))
    );
  }

  private matchesTreeFilter(
    item: AdminDictSerialized,
    query: AdminDictQueryDto,
  ) {
    const keyword = this.toolsService.toTrimmedString(query.keyword);
    if (
      keyword &&
      ![item.childrenCode, item.dictCode, item.label, item.value].some(
        (value) => this.toolsService.includesText(value, keyword),
      )
    ) {
      return false;
    }

    if (!this.matchesLike(item.dictCode, query.dictCode)) return false;
    if (!this.matchesLike(item.label, query.label)) return false;
    if (!this.matchesLike(item.value, query.value)) return false;
    if (!this.matchesLike(item.childrenCode, query.childrenCode)) return false;

    if (['0', '1'].includes(String(query.status))) {
      return Number(item.status) === Number(query.status);
    }

    return true;
  }

  private matchesLike(
    value: number | string | null | undefined,
    keyword?: string,
  ) {
    const normalizedKeyword = this.toolsService.toTrimmedString(keyword);
    if (!normalizedKeyword) return true;

    return this.toolsService.includesText(value, normalizedKeyword);
  }

  private normalizeInput(body: AdminDictBodyDto): Partial<AdminDict> {
    const dictCode = this.toolsService.toTrimmedString(body.dictCode);
    const label = this.toolsService.toTrimmedString(body.label);
    const value = this.toolsService.toTrimmedString(body.value);

    if (!dictCode) throwVbenError('字典编码不能为空', HttpStatus.BAD_REQUEST);
    if (!label) throwVbenError('字典标签不能为空', HttpStatus.BAD_REQUEST);
    if (!value) throwVbenError('字典值不能为空', HttpStatus.BAD_REQUEST);

    return {
      childrenCode: this.toolsService.normalizeNullableString(
        body.childrenCode,
      ),
      dictCode,
      label,
      sort: Number.isFinite(Number(body.sort)) ? Number(body.sort) : 0,
      status: Number(body.status) === 0 ? 0 : 1,
      value,
    };
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

  private serializeDictGroup(item: {
    dictCode: string;
    itemCount: number | string;
  }): AdminDictGroupItem {
    return {
      dictCode: item.dictCode,
      id: `dict-code:${item.dictCode}`,
      itemCount: Number(item.itemCount || 0),
      label: item.dictCode,
      value: item.dictCode,
    };
  }
}
