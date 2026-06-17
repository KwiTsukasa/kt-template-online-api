import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { MarkdownService, throwVbenError, ToolsService } from '@/common';
import { WordpressService } from '@/modules/wordpress/application/wordpress.service';
import {
  BlogArticle,
  type BlogArticleStatus,
  type BlogArticleTerm,
} from '../infrastructure/persistence/blog-article.entity';
import type {
  BlogArticleBodyDto,
  BlogArticleImportWordpressDto,
  BlogArticleListQueryDto,
  BlogArticleTermOptionsQueryDto,
  BlogArticleUpdateBodyDto,
} from '../contract/blog-article.dto';
import { BlogTermService } from './blog-term.service';

@Injectable()
export class BlogArticleService {
  /**
   * 初始化 BlogArticleService 实例。
   * @param articleRepository - 文章仓库依赖；影响 constructor 的返回值。
   * @param markdownService - markdownService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param wordpressService - wordpressService 服务依赖；影响 constructor 的返回值。
   * @param blogTermService - blogTermService 服务依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(BlogArticle)
    private readonly articleRepository: Repository<BlogArticle>,
    private readonly markdownService: MarkdownService,
    private readonly toolsService: ToolsService,
    private readonly wordpressService: WordpressService,
    private readonly blogTermService: BlogTermService,
  ) {}

  /**
   * 获取分页数据。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  async page(query: BlogArticleListQueryDto) {
    return this.queryPage(query);
  }

  /**
   * 执行 博客内容流程。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  async publicList(query: BlogArticleListQueryDto) {
    return this.queryPage({
      ...query,
      status: 'publish',
    });
  }

  /**
   * 获取详情数据。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
   */
  async detail(id: string | number) {
    const article = await this.articleRepository.findOne({
      where: {
        id: `${id}`,
        isDeleted: false,
      },
    });

    if (!article) {
      throwVbenError('文章不存在', HttpStatus.NOT_FOUND);
    }

    return this.toResponse(article);
  }

  /**
   * 执行 博客内容流程。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  async publicDetail(query: { id?: string; slug?: string }) {
    const article = await this.articleRepository.findOne({
      where: query.id
        ? {
            id: `${query.id}`,
            isDeleted: false,
            status: 'publish',
          }
        : {
            isDeleted: false,
            slug: this.normalizeSlug(query.slug || ''),
            status: 'publish',
          },
    });

    if (!article) {
      throwVbenError('文章不存在或未发布', HttpStatus.NOT_FOUND);
    }

    return this.toResponse(article);
  }

  /**
   * 保存数据。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  async save(body: BlogArticleBodyDto) {
    const articleEntity = await this.getArticleEntity(body);
    await this.syncArticleTerms(articleEntity);

    const article = this.articleRepository.create(articleEntity);
    const saved = await this.articleRepository.save(article);

    return this.toResponse(saved);
  }

  /**
   * 更新数据。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  async update(body: BlogArticleUpdateBodyDto) {
    const article = await this.articleRepository.findOne({
      where: {
        id: `${body.id}`,
        isDeleted: false,
      },
    });

    if (!article) {
      throwVbenError('文章不存在', HttpStatus.NOT_FOUND);
    }

    const articleEntity = await this.getArticleEntity(body, article);
    await this.syncArticleTerms(articleEntity);

    Object.assign(article, articleEntity);
    const saved = await this.articleRepository.save(article);

    return this.toResponse(saved);
  }

  /**
   * 删除数据。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
   */
  async remove(id: string | number) {
    const result = await this.articleRepository.update(
      {
        id: `${id}`,
        isDeleted: false,
      },
      {
        isDeleted: true,
      },
    );

    return (result.affected || 0) > 0;
  }

  /**
   * 执行 博客内容流程。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  async categoryOptions(query: BlogArticleTermOptionsQueryDto = {}) {
    return this.blogTermService.options('category', query);
  }

  /**
   * 执行 博客内容流程。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  async tagOptions(query: BlogArticleTermOptionsQueryDto = {}) {
    return this.blogTermService.options('tag', query);
  }

  /**
   * 执行 博客内容流程。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  async importFromWordpress(query: BlogArticleImportWordpressDto = {}) {
    const pageNo = this.toolsService.toPositiveNumber(query.pageNo, 1);
    const pageSize = Math.min(
      this.toolsService.toPositiveNumber(query.pageSize, 100),
      100,
    );
    const importAll = this.toolsService.normalizeBoolean(query.all, true);
    const overwrite = this.toolsService.normalizeBoolean(query.overwrite);
    const firstWordpressPage = await this.wordpressService.publicArticleList({
      pageNo,
      pageSize,
    });
    const result = {
      created: 0,
      items: [] as Array<{
        action: 'created' | 'skipped' | 'updated';
        id: string;
        slug: string;
        title: string;
      }>,
      pageCount: 0,
      skipped: 0,
      total: firstWordpressPage.total || firstWordpressPage.list?.length || 0,
      updated: 0,
    };
    const wordpressPages = [firstWordpressPage];

    if (importAll && firstWordpressPage.total > pageSize) {
      const totalPages = Math.ceil(firstWordpressPage.total / pageSize);

      for (
        let currentPageNo = pageNo + 1;
        currentPageNo <= totalPages;
        currentPageNo += 1
      ) {
        wordpressPages.push(
          await this.wordpressService.publicArticleList({
            pageNo: currentPageNo,
            pageSize,
          }),
        );
      }
    }

    for (const wordpressPage of wordpressPages) {
      result.pageCount += 1;

      for (const source of wordpressPage.list as Array<Record<string, any>>) {
        const detail = (await this.wordpressService.publicArticleDetail({
          id: source.id,
          slug: source.slug,
        })) as Record<string, any>;
        const importEntity = await this.getWordpressImportEntity(detail);
        await this.syncArticleTerms(importEntity);
        const existing = await this.articleRepository.findOne({
          where: {
            isDeleted: false,
            slug: importEntity.slug,
          },
        });

        if (existing && !overwrite) {
          result.skipped += 1;
          result.items.push({
            action: 'skipped',
            id: existing.id,
            slug: existing.slug,
            title: existing.title,
          });
          continue;
        }

        const saved = await this.articleRepository.save(
          existing
            ? Object.assign(existing, importEntity)
            : this.articleRepository.create(importEntity),
        );
        const action = existing ? 'updated' : 'created';

        result[action] += 1;
        result.items.push({
          action,
          id: saved.id,
          slug: saved.slug,
          title: saved.title,
        });
      }
    }

    return result;
  }

  /**
   * 查询 博客内容数据。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  private async queryPage(query: BlogArticleListQueryDto) {
    const { pageSize, skip } = this.toolsService.getPageParams(query);
    const builder = this.articleRepository
      .createQueryBuilder('article')
      .where('article.isDeleted = :isDeleted', { isDeleted: false });
    const status = query.status || 'any';
    const categoryKeywords = this.normalizeQueryList(query.categories);
    const tagKeywords = this.normalizeQueryList(query.tags);

    if (status !== 'any') {
      builder.andWhere('article.status = :status', { status });
    }

    if (query.search) {
      builder.andWhere(
        new Brackets((qb) => {
          qb.where('article.title LIKE :search', {
            search: `%${query.search}%`,
          })
            .orWhere('article.excerpt LIKE :search', {
              search: `%${query.search}%`,
            })
            .orWhere('article.contentMarkdown LIKE :search', {
              search: `%${query.search}%`,
            });
        }),
      );
    }

    categoryKeywords.forEach((keyword, index) => {
      builder.andWhere(`article.categoryItems LIKE :category${index}`, {
        [`category${index}`]: `%${keyword}%`,
      });
    });
    tagKeywords.forEach((keyword, index) => {
      builder.andWhere(`article.tagItems LIKE :tag${index}`, {
        [`tag${index}`]: `%${keyword}%`,
      });
    });

    const [list, total] = await builder
      .orderBy('article.publishTime', 'DESC')
      .addOrderBy('article.updateTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    return this.toolsService.page(
      list.map((item) => this.toResponse(item)),
      total,
    );
  }

  /**
   * 查询 博客内容数据。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   * @param current - current 输入；驱动 `this.normalizeSlug()` 的 博客步骤。
   * @returns 博客内容查询结果。
   */
  private async getArticleEntity(
    body: BlogArticleBodyDto,
    current?: BlogArticle,
  ): Promise<Partial<BlogArticle>> {
    const contentFormat = body.contentFormat || 'markdown';
    const nextArticle: Partial<BlogArticle> = this.toolsService.pickDefined({
      authorName: body.authorName,
      cover: body.cover,
      excerpt: body.excerpt,
      slug: this.normalizeSlug(body.slug || body.title || current?.slug || ''),
      status: body.status || current?.status || ('draft' as BlogArticleStatus),
      title: body.title,
    });

    if (body.categories) {
      nextArticle.categoryItems = this.normalizeTerms(body.categories);
    }

    if (body.tags) {
      nextArticle.tagItems = this.normalizeTerms(body.tags);
    }

    if (body.content !== undefined) {
      if (contentFormat === 'markdown') {
        nextArticle.contentMarkdown = body.content;
        nextArticle.contentHtml = await this.markdownService.renderToHtml(
          body.content,
        );
      } else {
        nextArticle.contentMarkdown = current?.contentMarkdown || '';
        nextArticle.contentHtml = await this.markdownService.renderToHtml(
          body.content,
        );
      }
    }

    if (
      nextArticle.status === 'publish' &&
      !current?.publishTime &&
      !nextArticle.publishTime
    ) {
      nextArticle.publishTime = new Date();
    }

    return nextArticle;
  }

  /**
   * 转换 博客内容输入。
   * @param values - 配置值字典；影响 normalizeTerms 的返回值。
   */
  private normalizeTerms(values: Array<BlogArticleTerm | string>) {
    const seen = new Set<string>();

    return values
      .map((item) => {
        const name =
          typeof item === 'string'
            ? this.toolsService.toTrimmedString(item)
            : this.toolsService.toTrimmedString(item.name);
        const slug =
          typeof item === 'string'
            ? this.normalizeSlug(item)
            : this.normalizeSlug(item.slug || item.name);

        return this.toolsService.pickDefined({
          id: typeof item === 'string' ? undefined : item.id,
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
   * 查询 博客内容数据。
   * @param source - source 输入；使用 `contentHtml`、`content`、`contentMarkdown`、`status` 字段生成结果。
   */
  private async getWordpressImportEntity(source: Record<string, any>) {
    const rawContentHtml = source.contentHtml || source.content?.rendered || '';
    const contentHtml = await this.markdownService.sanitizeHtml(rawContentHtml);
    const contentMarkdown =
      source.contentMarkdown ||
      this.markdownService.extractSource(source.content?.raw) ||
      (await this.markdownService.renderHtmlToMarkdown(rawContentHtml));
    const status = (
      source.status === 'publish' ? 'publish' : 'draft'
    ) as BlogArticleStatus;

    return this.toolsService.pickDefined({
      authorName: source.authorName,
      categoryItems: this.normalizeTerms(
        (source.categoriesResolved || []).map((item) => ({
          id: item.id ? `${item.id}` : undefined,
          name: item.name,
          slug: item.slug || item.name,
        })),
      ),
      comments: Number(source.comment_count || 0),
      contentHtml,
      contentMarkdown,
      cover: source.cover,
      excerpt:
        source.excerptText ||
        this.stripHtml(source.excerpt?.rendered || source.excerpt || ''),
      publishTime: this.parseDate(source.date || source.modified),
      slug: this.normalizeSlug(source.slug || source.title?.rendered || ''),
      status,
      tagItems: this.normalizeTerms(
        (source.tagsResolved || []).map((item) => ({
          id: item.id ? `${item.id}` : undefined,
          name: item.name,
          slug: item.slug || item.name,
        })),
      ),
      title: this.stripHtml(source.title?.rendered || source.title || ''),
      views: Number(source.views || 0),
    });
  }

  /**
   * 转换 博客内容输入。
   * @param value - 待转换值；决定 博客条件分支。
   */
  private normalizeQueryList(value?: string | string[]) {
    if (Array.isArray(value)) {
      return value
        .flatMap((item) => item.split(','))
        .map((item) => this.normalizeSlug(item))
        .filter(Boolean);
    }

    if (!value) return [];

    return value
      .split(',')
      .map((item) => this.normalizeSlug(item))
      .filter(Boolean);
  }

  /**
   * 更新 博客内容状态。
   * @param article - article 输入；使用 `categoryItems`、`tagItems` 字段生成结果。
   */
  private async syncArticleTerms(article: Partial<BlogArticle>) {
    if (article.categoryItems) {
      await this.blogTermService.syncTerms('category', article.categoryItems);
    }

    if (article.tagItems) {
      await this.blogTermService.syncTerms('tag', article.tagItems);
    }
  }

  /**
   * 执行 博客内容流程。
   * @param article - article 输入；使用 `categoryItems`、`tagItems`、`excerpt`、`contentHtml` 字段生成结果。
   */
  private toResponse(article: BlogArticle) {
    const categoriesResolved = article.categoryItems || [];
    const tagsResolved = article.tagItems || [];
    const excerptText =
      article.excerpt ||
      this.stripHtml(article.contentHtml || '').slice(0, 120);

    return Object.assign(article, {
      categories: categoriesResolved.map((item) => item.name),
      categoriesResolved,
      excerptText,
      tags: tagsResolved.map((item) => item.name),
      tagsResolved,
    });
  }

  /**
   * 转换 博客内容输入。
   * @param value - 待转换值；驱动 `toolsService.normalizeSlugText()` 的 博客步骤。
   */
  private normalizeSlug(value: string) {
    return this.toolsService.normalizeSlugText(value);
  }

  /**
   * 执行 博客内容流程。
   * @param value - 待转换值；影响 stripHtml 的返回值。
   */
  private stripHtml(value: string) {
    return value
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 解析Date。
   * @param value - 待转换时间值；决定 博客条件分支。
   */
  private parseDate(value: unknown) {
    if (!value) return null;
    const date = new Date(`${value}`);

    return Number.isNaN(date.getTime()) ? null : date;
  }
}
