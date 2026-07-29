import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { MarkdownService, ToolsService } from '../../src/common';
import { BlogArticleService } from '../../src/modules/blog/application/blog-article.service';
import { BlogTermService } from '../../src/modules/blog/application/blog-term.service';
import { BlogArticle } from '../../src/modules/blog/infrastructure/persistence/blog-article.entity';

describe('BlogArticleService', () => {
  let service: BlogArticleService;
  let markdownService: MarkdownService;
  let blogTermService: {
    options: jest.Mock;
    syncTerms: jest.Mock;
  };
  let repository: {
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn((payload) => ({ id: '1', ...payload })),
      createQueryBuilder: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(async (article) => article),
      update: jest.fn(),
    };
    markdownService = new MarkdownService();
    jest
      .spyOn(markdownService, 'renderToHtml')
      .mockResolvedValue('<h1>标题</h1>\n<p>正文</p>');
    jest
      .spyOn(markdownService, 'sanitizeHtml')
      .mockImplementation(async (html) =>
        `${html ?? ''}`.replace(/<script[\s\S]*?<\/script>/g, ''),
      );
    blogTermService = {
      options: jest.fn(),
      syncTerms: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BlogArticleService,
        ToolsService,
        {
          provide: MarkdownService,
          useValue: markdownService,
        },
        {
          provide: getRepositoryToken(BlogArticle),
          useValue: repository,
        },
        {
          provide: BlogTermService,
          useValue: blogTermService,
        },
      ],
    }).compile();

    service = moduleRef.get(BlogArticleService);
  });

  it('renders markdown and normalizes local article fields before saving', async () => {
    const result = await service.save({
      categories: ['技术'],
      content: '# 标题\n\n正文',
      contentFormat: 'markdown',
      status: 'publish',
      tags: ['Milkdown'],
      title: '测试 文章',
    });

    expect(markdownService.renderToHtml).toHaveBeenCalledWith('# 标题\n\n正文');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryItems: [{ name: '技术', slug: '技术' }],
        contentHtml: '<h1>标题</h1>\n<p>正文</p>',
        contentMarkdown: '# 标题\n\n正文',
        slug: '测试-文章',
        status: 'publish',
        tagItems: [{ name: 'Milkdown', slug: 'milkdown' }],
      }),
    );
    expect(blogTermService.syncTerms).toHaveBeenCalledWith('category', [
      { name: '技术', slug: '技术' },
    ]);
    expect(blogTermService.syncTerms).toHaveBeenCalledWith('tag', [
      { name: 'Milkdown', slug: 'milkdown' },
    ]);
    expect(repository.create.mock.calls[0][0].publishTime).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      categories: ['技术'],
      categoriesResolved: [{ name: '技术', slug: '技术' }],
      excerptText: '标题 正文',
      tags: ['Milkdown'],
      tagsResolved: [{ name: 'Milkdown', slug: 'milkdown' }],
    });
  });

  it('sanitizes html content without markdown rerendering when updating imported articles', async () => {
    const rawArgonCodeblock =
      '<pre class="wp-block-code hljs-codeblock" id="demo"><code class="hljs sql"><table class="hljs-ln"><tbody><tr><td class="hljs-ln-line hljs-ln-code">select 1;</td></tr></tbody></table></code><div class="hljs-control"><div class="hljs-control-btn hljs-control-copy"></div></div></pre><script>alert(1)</script>';
    const currentArticle = {
      contentHtml: '<p>旧正文</p>',
      contentMarkdown: '旧正文',
      id: '50',
      isDeleted: false,
      slug: 'migrated-post',
      status: 'publish',
      title: '迁移文章',
    };
    repository.findOne.mockResolvedValue(currentArticle);

    await service.update({
      content: rawArgonCodeblock,
      contentFormat: 'html',
      id: '50',
      title: '迁移文章',
    });

    expect(markdownService.renderToHtml).not.toHaveBeenCalled();
    expect(markdownService.sanitizeHtml).toHaveBeenCalledWith(
      rawArgonCodeblock,
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHtml:
          '<pre class="wp-block-code hljs-codeblock" id="demo"><code class="hljs sql"><table class="hljs-ln"><tbody><tr><td class="hljs-ln-line hljs-ln-code">select 1;</td></tr></tbody></table></code><div class="hljs-control"><div class="hljs-control-btn hljs-control-copy"></div></div></pre>',
        contentMarkdown: '旧正文',
      }),
    );
  });

  it('queries public list with publish status and maps response fields', async () => {
    const builder = createQueryBuilderMock([
      {
        categoryItems: [{ name: '技术', slug: 'tech' }],
        contentHtml: '<p>正文</p>',
        id: '1',
        isDeleted: false,
        slug: 'demo',
        status: 'publish',
        tagItems: [{ name: 'Milkdown', slug: 'milkdown' }],
        title: 'Demo',
      },
    ]);
    repository.createQueryBuilder.mockReturnValue(builder);

    const result = await service.publicList({
      pageNo: 1,
      pageSize: 10,
    });

    expect(builder.andWhere).toHaveBeenCalledWith('article.status = :status', {
      status: 'publish',
    });
    expect(result).toMatchObject({
      list: [
        {
          categories: ['技术'],
          categoriesResolved: [{ name: '技术', slug: 'tech' }],
          tags: ['Milkdown'],
          tagsResolved: [{ name: 'Milkdown', slug: 'milkdown' }],
        },
      ],
      total: 1,
    });
  });

  it('clamps only the public list page size to 100', async () => {
    const publicBuilder = createQueryBuilderMock([]);
    repository.createQueryBuilder.mockReturnValueOnce(publicBuilder);

    await service.publicList({
      pageNo: 1,
      pageSize: 1_000_000,
    });

    expect(publicBuilder.take).toHaveBeenCalledWith(100);

    const authenticatedBuilder = createQueryBuilderMock([]);
    repository.createQueryBuilder.mockReturnValueOnce(authenticatedBuilder);

    await service.page({
      pageNo: 1,
      pageSize: 1_000_000,
    });

    expect(authenticatedBuilder.take).toHaveBeenCalledWith(1_000_000);
  });

  it('uses local blog term service for category options', async () => {
    blogTermService.options.mockResolvedValue({
      list: [{ count: 2, id: 'tech', name: '技术', slug: 'tech' }],
      total: 1,
    });

    const result = await service.categoryOptions({
      pageNo: 1,
      pageSize: 10,
      search: '技',
    });

    expect(blogTermService.options).toHaveBeenCalledWith('category', {
      pageNo: 1,
      pageSize: 10,
      search: '技',
    });
    expect(result).toEqual({
      list: [
        {
          count: 2,
          id: 'tech',
          name: '技术',
          slug: 'tech',
        },
      ],
      total: 1,
    });
  });
});

/**
 * 创建 博客内容对象或配置。
 * @param list - 博客列表；使用 `length` 字段生成结果。
 */
function createQueryBuilderMock(list: Partial<BlogArticle>[]) {
  const builder = {
    addOrderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue([list as BlogArticle[], list.length]),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };

  return builder;
}
