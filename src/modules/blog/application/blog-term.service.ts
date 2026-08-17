import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import {
  BlogArticle,
  type BlogArticleTerm,
} from '../infrastructure/persistence/blog-article.entity';
import {
  BlogTerm,
  type BlogTermKind,
} from '../infrastructure/persistence/blog-term.entity';
import type {
  BlogTermBodyDto,
  BlogTermListQueryDto,
  BlogTermUpdateBodyDto,
} from '../contract/blog-term.dto';

type CountedBlogTerm = BlogArticleTerm & {
  count: number;
};

@Injectable()
export class BlogTermService {
  constructor(
    @InjectRepository(BlogTerm)
    private readonly termRepository: Repository<BlogTerm>,
    @InjectRepository(BlogArticle)
    private readonly articleRepository: Repository<BlogArticle>,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 按术语类型和查询条件筛选、排序并分页博客分类或标签，同时附带文章引用计数。
   * @param kind - 决定分页结果内容、边界或目标的 `kind` 值。
   * @param query - 限定分页结果筛选、排序与分页范围的查询条件；省略时默认采用 `{}`。
   * @returns 分页。
   */
  async page(kind: BlogTermKind, query: BlogTermListQueryDto = {}) {
    const { pageSize, skip } = this.toolsService.getPageParams(query);
    const countMap = await this.collectArticleTermMap(kind);
    const list = this.filterAndSortTerms(
      (await this.getStoredTerms(kind)).map((term) =>
        this.toResponse(term, countMap),
      ),
      query,
    );

    return this.toolsService.page(
      list.slice(skip, skip + pageSize),
      list.length,
    );
  }

  /**
   * 根据`kind`、`query`处理针对博客内容；从 `toolsService.getPageParams` 读取针对博客内容。
   * @param kind - 决定针对博客内容、边界或目标的 `kind` 值。
   * @param query - 限定针对博客内容筛选、排序与分页范围的查询条件；省略时默认采用 `{}`。
   * @returns 针对博客内容。
   */
  async options(kind: BlogTermKind, query: BlogTermListQueryDto = {}) {
    const { pageSize, skip } = this.toolsService.getPageParams(query, 1, 200);
    const countMap = await this.collectArticleTermMap(kind);
    const termMap = new Map<string, BlogTerm>();

    (await this.getStoredTerms(kind)).forEach((term) => {
      termMap.set(term.slug || this.normalizeSlug(term.name), term);
    });

    countMap.forEach((term, slug) => {
      if (termMap.has(slug)) return;
      termMap.set(
        slug,
        this.termRepository.create({
          id: term.id || slug,
          kind,
          name: term.name,
          slug,
        }),
      );
    });

    const list = this.filterAndSortTerms(
      Array.from(termMap.values()).map((term) =>
        this.toResponse(term, countMap),
      ),
      query,
    );

    return this.toolsService.page(
      list.slice(skip, skip + pageSize),
      list.length,
    );
  }

  /**
   * 根据参数 `kind`，查询并返回详情数据。
   * @param kind - 决定根据参数 `kind`，查询并返回详情数据内容、边界或目标的 `kind` 值。
   * @param id - 决定根据参数 `kind`，查询并返回详情数据内容、边界或目标的 `id` 值。
   * @returns 根据参数 `kind`，查询并返回详情数据。
   */
  async detail(kind: BlogTermKind, id: string | number) {
    const term = await this.findExistingTerm(kind, id);
    const countMap = await this.collectArticleTermMap(kind);

    return this.toResponse(term, countMap);
  }

  /**
   * 根据`kind`、`body`更新`save` 对应结果；把变更持久化到当前存储（`termRepository.save`）。
   * @param kind - 决定`save` 对应结果内容、边界或目标的 `kind` 值。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @returns `save` 对应。
   */
  async save(kind: BlogTermKind, body: BlogTermBodyDto) {
    const entity = this.getTermEntity(kind, body);
    await this.assertSlugAvailable(kind, entity.slug);

    const saved = await this.termRepository.save(
      this.termRepository.create(entity),
    );

    return this.toResponse(saved, await this.collectArticleTermMap(kind));
  }

  /**
   * 根据`kind`、`body`更新`update` 对应结果；把变更持久化到当前存储（`termRepository.save`）。
   * @param kind - 决定`update` 对应结果内容、边界或目标的 `kind` 值。
   * @param body - 用于`update` 对应结果的结构化输入，包含 `id` 字段。
   * @returns `update` 对应。
   */
  async update(kind: BlogTermKind, body: BlogTermUpdateBodyDto) {
    const term = await this.findExistingTerm(kind, body.id);
    const nextEntity = this.getTermEntity(kind, body);

    await this.assertSlugAvailable(kind, nextEntity.slug, term.id);
    Object.assign(term, nextEntity);

    const saved = await this.termRepository.save(term);

    return this.toResponse(saved, await this.collectArticleTermMap(kind));
  }

  /**
   * 仅对类型与标识同时匹配且尚未删除的博客术语设置软删除标记，并返回是否命中。
   * @param kind - 决定`remove` 对应结果内容、边界或目标的 `kind` 值。
   * @param id - 决定`remove` 对应结果内容、边界或目标的 `id` 值。
   * @returns 满足`remove` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async remove(kind: BlogTermKind, id: string | number) {
    const result = await this.termRepository.update(
      {
        id: `${id}`,
        isDeleted: false,
        kind,
      },
      {
        isDeleted: true,
      },
    );

    return (result.affected || 0) > 0;
  }

  /**
   * 根据`kind`、`terms`处理针对博客内容；把变更持久化到当前存储（`termRepository.save`）。
   * @param kind - 决定针对博客内容、边界或目标的 `kind` 值。
   * @param terms - 决定针对博客内容、边界或目标的 `terms` 值；省略时默认采用 `[]`。
   */
  async syncTerms(kind: BlogTermKind, terms: BlogArticleTerm[] = []) {
    for (const term of this.normalizeTerms(terms)) {
      const slug = term.slug || this.normalizeSlug(term.name);
      const existing = await this.termRepository.findOne({
        where: {
          isDeleted: false,
          kind,
          slug,
        },
      });

      if (existing) continue;

      await this.termRepository.save(
        this.termRepository.create({
          kind,
          name: term.name,
          slug,
        }),
      );
    }
  }

  /**
   * 按`kind`读取针对博客内容。
   * @param kind - 决定针对博客内容、边界或目标的 `kind` 值。
   * @returns 针对博客内容。
   */
  private async getStoredTerms(kind: BlogTermKind) {
    return this.termRepository.find({
      where: {
        isDeleted: false,
        kind,
      },
    });
  }

  /**
   * 按`kind`、`id`读取针对博客内容；从 `termRepository.findOne` 读取针对博客内容。
   * @param kind - 决定针对博客内容、边界或目标的 `kind` 值。
   * @param id - 决定针对博客内容、边界或目标的 `id` 值。
   * @returns 针对博客内容。
   */
  private async findExistingTerm(kind: BlogTermKind, id: string | number) {
    const term = await this.termRepository.findOne({
      where: {
        id: `${id}`,
        isDeleted: false,
        kind,
      },
    });

    if (!term) {
      throwVbenError('分类或标签不存在', HttpStatus.NOT_FOUND);
    }

    return term;
  }

  /**
   * 按`kind`、`body`读取针对博客内容。
   * @param kind - 决定针对博客内容、边界或目标的 `kind` 值。
   * @param body - 用于针对博客内容的结构化输入，包含 `name`、`description`、`parent`、`slug` 字段。
   * @returns 包含 `description`、`kind`、`name`、`parentId`、`slug` 字段的针对博客内容。
   */
  private getTermEntity(kind: BlogTermKind, body: BlogTermBodyDto) {
    const name = this.toolsService.toTrimmedString(body.name);

    if (!name) {
      throwVbenError('请填写分类或标签名称', HttpStatus.BAD_REQUEST);
    }

    return {
      description: body.description || '',
      kind,
      name,
      parentId:
        (() => {
          if (kind === 'category') {
            return this.toolsService.toStringId(body.parent);
          }
          return '';
        })(),
      slug: this.normalizeSlug(body.slug || name),
    } as Partial<BlogTerm>;
  }

  /**
   * 校验`kind`、`slug`、`currentId`是否满足针对博客内容约束，并拒绝不合法输入；从 `termRepository.findOne` 读取针对博客内容。
   * @param kind - 决定针对博客内容、边界或目标的 `kind` 值。
   * @param slug - 决定针对博客内容、边界或目标的 `slug` 值。
   * @param currentId - 用于精确定位`current` 对应结果的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private async assertSlugAvailable(
    kind: BlogTermKind,
    slug: string,
    currentId?: string,
  ) {
    const existing = await this.termRepository.findOne({
      where: {
        isDeleted: false,
        kind,
        slug,
      },
    });

    if (existing && existing.id !== currentId) {
      throwVbenError('同名分类或标签已存在', HttpStatus.CONFLICT);
    }
  }

  /**
   * 根据`kind`处理针对博客内容。
   * @param kind - 决定针对博客内容、边界或目标的 `kind` 值。
   * @returns 针对博客内容。
   */
  private async collectArticleTermMap(kind: BlogTermKind) {
    const articles = await this.articleRepository.find({
      select:
        (() => {
          if (kind === 'category') {
            return {
              categoryItems: true,
            };
          }
          return {
              tagItems: true,
            };
        })(),
      where: {
        isDeleted: false,
      },
    });
    const termMap = new Map<string, CountedBlogTerm>();

    articles.forEach((article) => {
      const source =
        (() => {
          if (kind === 'category') {
            return article.categoryItems || [];
          }
          return article.tagItems || [];
        })();

      this.normalizeTerms(source).forEach((term) => {
        const slug = term.slug || this.normalizeSlug(term.name);
        const current = termMap.get(slug);

        if (current) {
          current.count += 1;
          return;
        }

        termMap.set(slug, {
          ...term,
          count: 1,
          id: term.id || slug,
          slug,
        });
      });
    });

    return termMap;
  }

  /**
   * 将`values`规范为针对博客内容，使等价输入得到一致表示。
   * @param values - 按原有顺序参与针对博客内容筛选、合并或汇总的集合。
   * @returns 针对博客内容。
   */
  private normalizeTerms(values: BlogArticleTerm[]) {
    const seen = new Set<string>();

    return values
      .map((item) => {
        const name = this.toolsService.toTrimmedString(item.name);
        const slug = this.normalizeSlug(item.slug || item.name);

        return this.toolsService.pickDefined({
          id: item.id,
          name,
          slug,
        }) as BlogArticleTerm;
      })
      .filter((item) => {
        if (!item.name || seen.has(item.slug)) return false;
        seen.add(item.slug);
        return true;
      });
  }

  /**
   * 从`terms`、`query`筛选针对博客内容，并保持保留项的原有顺序与键名。
   * @param terms - 决定针对博客内容、边界或目标的 `terms` 值。
   * @param query - 限定针对博客内容筛选、排序与分页范围的查询条件，包含 `search`、`parent`、`hide_empty` 字段；省略时默认采用 `{}`。
   * @returns 针对博客内容。
   */
  private filterAndSortTerms(
    terms: BlogTerm[],
    query: BlogTermListQueryDto = {},
  ) {
    const search = this.toolsService
      .toTrimmedString(query.search)
      .toLowerCase();
    const parent = this.toolsService.toStringId(query.parent);
    const hideEmpty = this.toolsService.normalizeBoolean(query.hide_empty);

    return terms
      .filter((term) => {
        if (hideEmpty && !term.count) return false;
        if (parent && term.parent !== parent) return false;
        if (!search) return true;
        return `${term.name} ${term.slug} ${term.description || ''}`
          .toLowerCase()
          .includes(search);
      })
      .sort((left, right) => {
        const countDiff = (right.count || 0) - (left.count || 0);
        if (countDiff !== 0) return countDiff;
        return left.name.localeCompare(right.name, 'zh-CN');
      });
  }

  /**
   * 将`term`、`countMap`转换为针对博客内容；从 `countMap.get` 读取针对博客内容。
   * @param term - 用于针对博客内容的领域对象，包含 `slug`、`name`、`id`、`parentId` 字段。
   * @param countMap - 用于针对博客内容的领域对象，包含 `get` 字段。
   * @returns 针对博客内容。
   */
  private toResponse(term: BlogTerm, countMap: Map<string, CountedBlogTerm>) {
    const slug = term.slug || this.normalizeSlug(term.name);
    const countedTerm = countMap.get(slug);

    return Object.assign(term, {
      count: countedTerm?.count || 0,
      id: term.id || slug,
      parent: term.parentId || undefined,
      slug,
    });
  }

  /**
   * 将`value`规范为针对博客内容，使等价输入得到一致表示。
   * @param value - 待转换为针对博客内容的原始值。
   * @returns 针对博客内容。
   */
  private normalizeSlug(value: unknown) {
    return this.toolsService.normalizeSlugText(value);
  }
}
