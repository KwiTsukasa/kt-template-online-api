import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { MarkdownService, ToolsService } from '../../src/common';
import { BlogArticleService } from '../../src/modules/blog/application/blog-article.service';
import { BlogTermService } from '../../src/modules/blog/application/blog-term.service';
import { BlogArticle } from '../../src/modules/blog/infrastructure/persistence/blog-article.entity';
import { WordpressService } from '../../src/modules/wordpress/application/wordpress.service';

describe('BlogArticleService', () => {
  let service: BlogArticleService;
  let markdownService: MarkdownService;
  let wordpressService: {
    publicArticleDetail: jest.Mock;
    publicArticleList: jest.Mock;
  };
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
      .spyOn(markdownService, 'renderHtmlToMarkdown')
      .mockResolvedValue('# 导入标题\n\n导入正文');
    jest
      .spyOn(markdownService, 'sanitizeHtml')
      .mockImplementation(async (html) =>
        `${html ?? ''}`.replace(/<script[\s\S]*?<\/script>/g, ''),
      );
    wordpressService = {
      publicArticleDetail: jest.fn(),
      publicArticleList: jest.fn(),
    };
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
          provide: WordpressService,
          useValue: wordpressService,
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

  it('imports WordPress public articles into local blog articles', async () => {
    wordpressService.publicArticleList.mockResolvedValue({
      list: [{ id: 50, slug: 'wordpress-post' }],
      total: 1,
    });
    wordpressService.publicArticleDetail.mockResolvedValue({
      authorName: 'WordPress 作者',
      categoriesResolved: [{ id: 1, name: 'NAS', slug: 'nas' }],
      contentHtml: '<h1>导入标题</h1><p>导入正文</p><script>alert(1)</script>',
      date: '2026-06-05T10:30:00',
      excerptText: '导入摘要',
      id: 50,
      slug: 'wordpress-post',
      status: 'publish',
      tagsResolved: [{ id: 2, name: 'Milkdown', slug: 'milkdown' }],
      title: { rendered: '导入标题' },
    });
    repository.findOne.mockResolvedValue(null);

    const result = await service.importFromWordpress({
      pageNo: 1,
      pageSize: 10,
    });

    expect(wordpressService.publicArticleList).toHaveBeenCalledWith({
      pageNo: 1,
      pageSize: 10,
    });
    expect(wordpressService.publicArticleDetail).toHaveBeenCalledWith({
      id: 50,
      slug: 'wordpress-post',
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        authorName: 'WordPress 作者',
        categoryItems: [{ id: '1', name: 'NAS', slug: 'nas' }],
        contentHtml: '<h1>导入标题</h1><p>导入正文</p>',
        contentMarkdown: '# 导入标题\n\n导入正文',
        excerpt: '导入摘要',
        slug: 'wordpress-post',
        status: 'publish',
        tagItems: [{ id: '2', name: 'Milkdown', slug: 'milkdown' }],
        title: '导入标题',
      }),
    );
    expect(blogTermService.syncTerms).toHaveBeenCalledWith('category', [
      { id: '1', name: 'NAS', slug: 'nas' },
    ]);
    expect(blogTermService.syncTerms).toHaveBeenCalledWith('tag', [
      { id: '2', name: 'Milkdown', slug: 'milkdown' },
    ]);
    expect(repository.create.mock.calls[0][0].publishTime).toBeInstanceOf(Date);
    expect(markdownService.sanitizeHtml).toHaveBeenCalledWith(
      '<h1>导入标题</h1><p>导入正文</p><script>alert(1)</script>',
    );
    expect(markdownService.renderHtmlToMarkdown).toHaveBeenCalledWith(
      '<h1>导入标题</h1><p>导入正文</p><script>alert(1)</script>',
    );
    expect(result).toMatchObject({
      created: 1,
      skipped: 0,
      total: 1,
      updated: 0,
      items: [
        {
          action: 'created',
          id: '1',
          slug: 'wordpress-post',
          title: '导入标题',
        },
      ],
    });
  });

  it('imports all WordPress article pages when all is enabled', async () => {
    wordpressService.publicArticleList
      .mockResolvedValueOnce({
        list: [
          { id: 50, slug: 'wordpress-post-1' },
          { id: 51, slug: 'wordpress-post-2' },
        ],
        total: 3,
      })
      .mockResolvedValueOnce({
        list: [{ id: 52, slug: 'wordpress-post-3' }],
        total: 3,
      });
    wordpressService.publicArticleDetail.mockImplementation(async ({ id }) => ({
      contentHtml: `<p>导入正文 ${id}</p>`,
      date: '2026-06-05T10:30:00',
      id,
      slug: `wordpress-post-${Number(id) - 49}`,
      status: 'publish',
      title: { rendered: `导入标题 ${id}` },
    }));
    repository.findOne.mockResolvedValue(null);

    const result = await service.importFromWordpress({
      all: true,
      pageNo: 1,
      pageSize: 2,
    });

    expect(wordpressService.publicArticleList).toHaveBeenNthCalledWith(1, {
      pageNo: 1,
      pageSize: 2,
    });
    expect(wordpressService.publicArticleList).toHaveBeenNthCalledWith(2, {
      pageNo: 2,
      pageSize: 2,
    });
    expect(wordpressService.publicArticleDetail).toHaveBeenCalledTimes(3);
    expect(repository.save).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      created: 3,
      pageCount: 2,
      skipped: 0,
      total: 3,
      updated: 0,
    });
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
