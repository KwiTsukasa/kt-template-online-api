import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { MarkdownService, throwVbenError, ToolsService } from '@/common';
import {
  BlogArticle,
  type BlogArticleStatus,
  type BlogArticleTerm,
} from './blog-article.entity';
import type {
  BlogArticleBodyDto,
  BlogArticleImportWordpressDto,
  BlogArticleListQueryDto,
  BlogArticleTermOptionsQueryDto,
  BlogArticleUpdateBodyDto,
} from './blog-article.dto';
import { WordpressService } from '@/wordpress/wordpress.service';
import { BlogTermService } from './blog-term.service';

@Injectable()
export class BlogArticleService {
  constructor(
    @InjectRepository(BlogArticle)
    private readonly articleRepository: Repository<BlogArticle>,
    private readonly markdownService: MarkdownService,
    private readonly toolsService: ToolsService,
    private readonly wordpressService: WordpressService,
    private readonly blogTermService: BlogTermService,
  ) {}

  async page(query: BlogArticleListQueryDto) {
    return this.queryPage(query);
  }

  async publicList(query: BlogArticleListQueryDto) {
    return this.queryPage({
      ...query,
      status: 'publish',
    });
  }

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

  async save(body: BlogArticleBodyDto) {
    const articleEntity = await this.getArticleEntity(body);
    await this.syncArticleTerms(articleEntity);

    const article = this.articleRepository.create(articleEntity);
    const saved = await this.articleRepository.save(article);

    return this.toResponse(saved);
  }

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

  async categoryOptions(query: BlogArticleTermOptionsQueryDto = {}) {
    return this.blogTermService.options('category', query);
  }

  async tagOptions(query: BlogArticleTermOptionsQueryDto = {}) {
    return this.blogTermService.options('tag', query);
  }

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

    return this.toolsService.page(list.map((item) => this.toResponse(item)), total);
  }

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

  private async getWordpressImportEntity(source: Record<string, any>) {
    const rawContentHtml = source.contentHtml || source.content?.rendered || '';
    const contentHtml = await this.markdownService.sanitizeHtml(rawContentHtml);
    const contentMarkdown =
      source.contentMarkdown ||
      this.markdownService.extractSource(source.content?.raw) ||
      (await this.markdownService.renderHtmlToMarkdown(rawContentHtml));
    const status = (source.status === 'publish'
      ? 'publish'
      : 'draft') as BlogArticleStatus;

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

  private async syncArticleTerms(article: Partial<BlogArticle>) {
    if (article.categoryItems) {
      await this.blogTermService.syncTerms('category', article.categoryItems);
    }

    if (article.tagItems) {
      await this.blogTermService.syncTerms('tag', article.tagItems);
    }
  }

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

  private normalizeSlug(value: string) {
    return this.toolsService.normalizeSlugText(value);
  }

  private stripHtml(value: string) {
    return value
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseDate(value: unknown) {
    if (!value) return null;
    const date = new Date(`${value}`);

    return Number.isNaN(date.getTime()) ? null : date;
  }
}
