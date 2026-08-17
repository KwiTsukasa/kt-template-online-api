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
} from '../../contract/admin.types';

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

  /**
   * 按`dictKey`读取字典键；从 `getDictItemsByKey` 读取字典键。
   * @param dictKey - 用于读取或更新字典键的稳定键。
   * @returns 按输入顺序得到的字典键列表；没有匹配项时为空数组。
   */
  async getDictByKey(dictKey: string): Promise<KtDictOption[]> {
    const list = await this.getDictItemsByKey(dictKey);

    return list.map(({ label, value }) => ({
      label,
      value: (() => {
        if (Number.isNaN(Number(value))) {
          return value;
        }
        return Number(value);
      })(),
    }));
  }

  /**
   * 按`query`读取分页数据；把变更持久化到当前存储（`dictRepository.createQueryBuilder`）。
   * @param query - 限定分页数据筛选、排序与分页范围的查询条件，包含 `pageNo`、`page`、`pageSize`、`keyword` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的分页数据。
   */
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

  /**
   * 按当前运行态读取字典代码选项；把变更持久化到当前存储（`dictRepository.createQueryBuilder`）。
   * @returns 字典代码选项。
   */
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

  /**
   * 通过 `toolsService.toPositiveNumber` 收敛领域表示。
   * @param query - 限定groups筛选、排序与分页范围的查询条件，包含 `pageNo`、`page`、`pageSize`、`keyword` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的groups。
   */
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

  /**
   * 根据`query`处理树形数据。
   * @param query - 限定树形数据筛选、排序与分页范围的查询条件；省略时默认采用 `{}`。
   * @returns 树形数据。
   */
  async tree(query: AdminDictQueryDto = {}) {
    return this.relationTree(query);
  }

  /**
   * 根据`query`处理关联树形层级。
   * @param query - 限定关联树形层级筛选、排序与分页范围的查询条件；省略时默认采用 `{}`。
   * @returns 关联树形层级。
   */
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

  /**
   * 根据`body`更新`save` 对应结果；把变更持久化到当前存储（`dictRepository.save`）。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @returns `save` 对应。
   */
  async save(body: AdminDictBodyDto) {
    const input = this.normalizeInput(body);
    const existing = await this.findByCodeValue(input.dictCode, input.value);
    if (existing && !existing.isDeleted) {
      throwVbenError('同一字典编码下的字典值已存在', HttpStatus.BAD_REQUEST);
    }

    const entity = (() => {
      if (existing) {
        return this.dictRepository.merge(existing, {
          ...input,
          isDeleted: false,
        });
      }
      return this.dictRepository.create(input);
    })();

    await this.dictRepository.save(entity);
    await this.refreshDecodeCache();
    return entity.id;
  }

  /**
   * 根据`body`更新`update` 对应结果；把变更持久化到当前存储（`dictRepository.save`）。
   * @param body - 用于`update` 对应结果的结构化输入，包含 `id`、`childrenCode`、`dictCode`、`label` 字段。
   * @returns 固定为 `null`，表示当前入口不会产生`update` 对应。
   */
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

  /**
   * 按`id`移除`remove` 对应结果；把变更持久化到当前存储（`dictRepository.update`）。
   * @param id - 决定`remove` 对应结果内容、边界或目标的 `id` 值。
   * @returns 固定为 `null`，表示当前入口不会产生`remove` 对应。
   */
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

  /**
   * 按字典项标识把状态收敛为 `0` 或 `1`，并沿用统一更新流程刷新解码缓存。
   * @param id - 决定`toggle` 对应结果内容、边界或目标的 `id` 值。
   * @param status - 决定`toggle` 对应结果内容、边界或目标的 `status` 值。
   * @returns 固定为 `null`，表示当前入口不会产生`toggle` 对应。
   */
  async toggle(id: string, status: number) {
    const normalizedStatus = (() => {
      if (status === 1) {
        return 1;
      }
      return 0;
    })();
    await this.update({
      id,
      status: normalizedStatus,
    });
    return null;
  }

  /**
   * 按`dictKey`读取字典条目集合键。
   * @param dictKey - 用于读取或更新字典条目集合键的稳定键。
   * @returns 按输入顺序得到的字典条目集合键列表；没有匹配项时为空数组。
   */
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

  /**
   * 按`type`读取Component字典Type；从 `dictRepository.findOne` 读取Component字典Type。
   * @param type - 决定Component字典Type内容、边界或目标的 `type` 值。
   * @returns 按输入顺序得到的Component字典Type列表；没有匹配项时为空数组。
   */
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

  /**
   * 根据当前运行态处理刷新结果缓存。
   */
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

  /**
   * 根据`builder`、`field`、`value`更新模糊匹配。
   * @param builder - 用于模糊匹配的领域对象，包含 `andWhere` 字段。
   * @param field - 决定模糊匹配内容、边界或目标的 `field` 值。
   * @param value - 参与模糊匹配比较、格式化或输出的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
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

  /**
   * 按`dictCode`、`value`读取代码值；从 `dictRepository.findOne` 读取代码值。
   * @param dictCode - 决定代码值内容、边界或目标的 `dictCode` 值。
   * @param value - 参与代码值比较、格式化或输出的候选值。
   * @returns 代码值。
   */
  private async findByCodeValue(dictCode: string, value: string) {
    return this.dictRepository.findOne({
      where: {
        dictCode,
        value,
      },
    });
  }

  /**
   * 根据`items`构造字典关联树形层级。
   * @param items - 按原有顺序参与字典关联树形层级筛选、合并或汇总的集合。
   * @returns 按输入顺序得到的字典关联树形层级列表；没有匹配项时为空数组。
   */
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
    const targetRootCodes = (() => {
      if (rootCodes.length > 0) {
        return rootCodes;
      }
      return [...dictCodes];
    })();

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

  /**
   * 根据`item`、`byDictCode`、`treeKey`构造树形层级树节点。
   * @param item - 用于树形层级树节点的领域对象，包含 `childrenCode` 字段。
   * @param byDictCode - 用于树形层级树节点的领域对象，包含 `get` 字段。
   * @param treeKey - 用于读取或更新树形层级树节点的稳定键。
   * @param pathCodes - 用于树形层级树节点的领域对象，包含 `has` 字段。
   * @returns 树形层级树节点。
   */
  private createTreeNode(
    item: AdminDictSerialized,
    byDictCode: Map<string, AdminDictSerialized[]>,
    treeKey: string,
    pathCodes: Set<string>,
  ): AdminDictTreeItem {
    const childrenCode = this.toolsService.toTrimmedString(item.childrenCode);
    const children =
      (() => {
        if (childrenCode && !pathCodes.has(childrenCode)) {
          return byDictCode.get(childrenCode);
        }
        return undefined;
      })();
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

  /**
   * 从`items`、`query`筛选关联树形层级条目集合，并保持保留项的原有顺序与键名。
   * @param items - 按原有顺序参与关联树形层级条目集合筛选、合并或汇总的集合。
   * @param query - 限定关联树形层级条目集合筛选、排序与分页范围的查询条件。
   * @returns 关联树形层级条目集合。
   */
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

  /**
   * 通过 `visibleIds.has` 判断输入是否满足函数约束。
   * @param item - 用于Related树形层级条目集合的领域对象，包含 `id`、`dictCode`、`childrenCode` 字段。
   * @param byDictCode - 用于Related树形层级条目集合的领域对象，包含 `get` 字段。
   * @param parentsByChildrenCode - 用于Related树形层级条目集合的领域对象，包含 `get` 字段。
   * @param visibleIds - 要批量读取、校验或更新的visible标识集合。
   */
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

  /**
   * 按字典编码将字典项聚合到 `Map`，并保持各编码下的原始顺序。
   * @param items - 按原有顺序参与group条目集合字典代码筛选、合并或汇总的集合。
   * @returns group条目集合字典代码。
   */
  private groupItemsByDictCode(items: AdminDictSerialized[]) {
    const map = new Map<string, AdminDictSerialized[]>();

    items.forEach((item) => {
      const list = map.get(item.dictCode) || [];
      list.push(item);
      map.set(item.dictCode, list);
    });

    return map;
  }

  /**
   * 忽略空子级编码，并按规范化后的子级编码聚合父字典项。
   * @param items - 按原有顺序参与groupParentsChildren代码筛选、合并或汇总的集合。
   * @returns groupParentsChildren代码。
   */
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

  /**
   * 根据`query`与当前约束判定树形层级。
   * @param query - 限定树形层级筛选、排序与分页范围的查询条件，包含 `childrenCode`、`dictCode`、`keyword`、`label` 字段。
   * @returns 满足树形层级约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 根据`item`、`query`与当前约束判定matches树形层级；当 `keyword && ![item.childrenCode, item.dictCode, item.label, it…` 成立时返回 `false`。
   * @param item - 用于matches树形层级的领域对象，包含 `childrenCode`、`dictCode`、`label`、`value` 字段。
   * @param query - 限定matches树形层级筛选、排序与分页范围的查询条件，包含 `keyword`、`dictCode`、`label`、`value` 字段。
   * @returns 满足matches树形层级约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 根据`value`、`keyword`与当前约束判定matches模糊匹配。
   * @param value - 待判定是否满足matches模糊匹配约束的候选值。
   * @param keyword - 决定matches模糊匹配内容、边界或目标的 `keyword` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足matches模糊匹配约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private matchesLike(
    value: number | string | null | undefined,
    keyword?: string,
  ) {
    const normalizedKeyword = this.toolsService.toTrimmedString(keyword);
    if (!normalizedKeyword) return true;

    return this.toolsService.includesText(value, normalizedKeyword);
  }

  /**
   * 将`body`规范为输入，使等价输入得到一致表示。
   * @param body - 用于输入的结构化输入，包含 `dictCode`、`label`、`value`、`childrenCode` 字段。
   * @returns 包含 `childrenCode`、`dictCode`、`label`、`sort`、`status` 字段的输入。
   */
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
      sort: (() => {
        if (Number.isFinite(Number(body.sort))) {
          return Number(body.sort);
        }
        return 0;
      })(),
      status: (() => {
        if (Number(body.status) === 0) {
          return 0;
        }
        return 1;
      })(),
      value,
    };
  }

  /**
   * 将字典实体投影为管理端可编辑的字典项，保留分组、排序、状态与时间字段。
   * @param dict - 待返回给管理端的字典持久化实体。
   * @returns 返回不含持久化关系的字典项 DTO。
   */
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

  /**
   * 将字典分组聚合结果投影为可选项，并以字典编码构造稳定标识。
   * @param item - 数据库返回的字典编码与项数聚合值；项数可为数字或数字字符串。
   * @returns 返回以 `dict-code:<dictCode>` 为标识的分组选项；空项数转为 `0`。
   */
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
