import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MarkdownService, ToolsService } from '../../src/common';
import { BlogArticleService } from '../../src/modules/blog/application/blog-article.service';
import { BlogArticleController } from '../../src/modules/blog/contract/blog-article.controller';
import { BlogArticle } from '../../src/modules/blog/infrastructure/persistence/blog-article.entity';
import { BlogTermService } from '../../src/modules/blog/application/blog-term.service';
import { JwtAuthGuard } from '../../src/modules/admin/identity/auth/jwt-auth.guard';
import { WordpressService } from '../../src/modules/wordpress/application/wordpress.service';

describe('Blog article public pagination HTTP contract (e2e)', () => {
  let app: INestApplication;
  const builder = {
    addOrderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogArticleController],
      providers: [
        BlogArticleService,
        MarkdownService,
        ToolsService,
        {
          provide: getRepositoryToken(BlogArticle),
          useValue: {
            createQueryBuilder: jest.fn(() => builder),
          },
        },
        {
          provide: BlogTermService,
          useValue: {},
        },
        {
          provide: WordpressService,
          useValue: {},
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: () => true,
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes pageSize=100 to TypeORM when HTTP input requests one million rows', async () => {
    await request(app.getHttpServer())
      .get('/blog/article/public/list?pageNo=1&pageSize=1000000')
      .expect(200);

    expect(builder.take).toHaveBeenCalledWith(100);
  });
});
