import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { ToolsService } from '../../src/common';
import { BlogArticle } from '../../src/blog/blog-article.entity';
import { BlogTerm } from '../../src/blog/blog-term.entity';
import { BlogTermService } from '../../src/blog/blog-term.service';

describe('BlogTermService', () => {
  let service: BlogTermService;
  let termRepository: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let articleRepository: {
    find: jest.Mock;
  };

  beforeEach(async () => {
    termRepository = {
      create: jest.fn((payload) => payload),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(async (payload) => ({ id: 'term-id', ...payload })),
      update: jest.fn(),
    };
    articleRepository = {
      find: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BlogTermService,
        ToolsService,
        {
          provide: getRepositoryToken(BlogTerm),
          useValue: termRepository,
        },
        {
          provide: getRepositoryToken(BlogArticle),
          useValue: articleRepository,
        },
      ],
    }).compile();

    service = moduleRef.get(BlogTermService);
  });

  it('lists local terms with article counts and hide empty support', async () => {
    termRepository.find.mockResolvedValue([
      { id: '1', kind: 'category', name: '技术', slug: 'tech' },
      { id: '2', kind: 'category', name: '生活', slug: 'life' },
    ]);
    articleRepository.find.mockResolvedValue([
      { categoryItems: [{ name: '技术', slug: 'tech' }] },
      { categoryItems: [{ name: '技术', slug: 'tech' }] },
    ]);

    const result = await service.page('category', {
      hide_empty: true,
      pageNo: 1,
      pageSize: 10,
    });

    expect(termRepository.find).toHaveBeenCalledWith({
      where: {
        isDeleted: false,
        kind: 'category',
      },
    });
    expect(result).toMatchObject({
      list: [
        {
          count: 2,
          id: '1',
          name: '技术',
          slug: 'tech',
        },
      ],
      total: 1,
    });
  });

  it('merges stored terms and article-only terms for article options', async () => {
    termRepository.find.mockResolvedValue([
      { id: '1', kind: 'category', name: '草稿分类', slug: 'draft' },
    ]);
    articleRepository.find.mockResolvedValue([
      { categoryItems: [{ name: '技术', slug: 'tech' }] },
    ]);

    const result = await service.options('category', {
      pageNo: 1,
      pageSize: 10,
    });

    expect(result).toMatchObject({
      list: [
        {
          count: 1,
          id: 'tech',
          name: '技术',
          slug: 'tech',
        },
        {
          count: 0,
          id: '1',
          name: '草稿分类',
          slug: 'draft',
        },
      ],
      total: 2,
    });
  });

  it('syncs article terms into local taxonomy once by slug', async () => {
    termRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'exists', name: 'Milkdown', slug: 'milkdown' });

    await service.syncTerms('tag', [
      { name: 'Milkdown', slug: 'milkdown' },
      { name: 'Milkdown', slug: 'milkdown' },
    ]);

    expect(termRepository.save).toHaveBeenCalledTimes(1);
    expect(termRepository.create).toHaveBeenCalledWith({
      kind: 'tag',
      name: 'Milkdown',
      slug: 'milkdown',
    });
  });
});
