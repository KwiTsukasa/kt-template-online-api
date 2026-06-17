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
  /**
   * 初始化 BlogTermService 实例。
   * @param termRepository - 博客仓库依赖；影响 constructor 的返回值。
   * @param articleRepository - 文章仓库依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(BlogTerm)
    private readonly termRepository: Repository<BlogTerm>,
    @InjectRepository(BlogArticle)
    private readonly articleRepository: Repository<BlogArticle>,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 获取分页数据。
   * @param kind - kind 输入；驱动 `this.collectArticleTermMap()`、`this.filterAndSortTerms()` 的 博客步骤。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
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
   * 执行 博客内容流程。
   * @param kind - kind 输入；驱动 `this.collectArticleTermMap()`、`this.getStoredTerms()` 的 博客步骤。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
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
   * 获取详情数据。
   * @param kind - kind 输入；驱动 `this.findExistingTerm()`、`this.collectArticleTermMap()` 的 博客步骤。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
   */
  async detail(kind: BlogTermKind, id: string | number) {
    const term = await this.findExistingTerm(kind, id);
    const countMap = await this.collectArticleTermMap(kind);

    return this.toResponse(term, countMap);
  }

  /**
   * 保存数据。
   * @param kind - kind 输入；驱动 `this.getTermEntity()`、`this.assertSlugAvailable()`、`this.toResponse()` 的 博客步骤。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
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
   * 更新数据。
   * @param kind - kind 输入；驱动 `this.findExistingTerm()`、`this.getTermEntity()`、`this.assertSlugAvailable()`、`this.toResponse()` 的 博客步骤。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
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
   * 删除数据。
   * @param kind - kind 输入；影响 remove 的返回值。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
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
   * 更新 博客内容状态。
   * @param kind - kind 输入；写入 博客状态。
   * @param terms - 博客列表；驱动 `for()` 的 博客步骤。
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
   * 查询 博客内容数据。
   * @param kind - kind 输入；限定 博客查询范围。
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
   * 查询 博客内容数据。
   * @param kind - kind 输入；限定 博客查询范围。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
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
   * 查询 博客内容数据。
   * @param kind - kind 输入；限定 博客查询范围。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
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
        kind === 'category' ? this.toolsService.toStringId(body.parent) : '',
      slug: this.normalizeSlug(body.slug || name),
    } as Partial<BlogTerm>;
  }

  /**
   * 执行 博客内容流程。
   * @param kind - kind 输入；影响 assertSlugAvailable 的返回值。
   * @param slug - slug 输入；影响 assertSlugAvailable 的返回值。
   * @param currentId - 博客 ID；定位本次读取、更新、删除或关联的博客。
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
   * 执行 博客内容流程。
   * @param kind - kind 输入；影响 collectArticleTermMap 的返回值。
   */
  private async collectArticleTermMap(kind: BlogTermKind) {
    const articles = await this.articleRepository.find({
      select:
        kind === 'category'
          ? {
              categoryItems: true,
            }
          : {
              tagItems: true,
            },
      where: {
        isDeleted: false,
      },
    });
    const termMap = new Map<string, CountedBlogTerm>();

    articles.forEach((article) => {
      const source =
        kind === 'category'
          ? article.categoryItems || []
          : article.tagItems || [];

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
   * 转换 博客内容输入。
   * @param values - 配置值字典；影响 normalizeTerms 的返回值。
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
   * 执行 博客内容流程。
   * @param terms - 博客列表；影响 filterAndSortTerms 的返回值。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
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
   * 执行 博客内容流程。
   * @param term - term 输入；使用 `slug`、`name`、`id`、`parentId` 字段生成结果。
   * @param countMap - countMap 输入；执行 `countMap.get()` 对应的 博客步骤。
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
   * 转换 博客内容输入。
   * @param value - 待转换值；驱动 `toolsService.normalizeSlugText()` 的 博客步骤。
   */
  private normalizeSlug(value: unknown) {
    return this.toolsService.normalizeSlugText(value);
  }
}
