import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import { Readable } from 'stream';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AdminAuthService } from '../src/admin/auth/admin-auth.service';
import { JwtAuthGuard } from '../src/admin/auth/jwt-auth.guard';
import { ComponentController } from '../src/admin/component/component.controller';
import { ComponentService } from '../src/admin/component/component.service';
import { DictController } from '../src/admin/dict/dict.controller';
import { DictService } from '../src/admin/dict/dict.service';
import {
  ApiExceptionFilter,
  SaveBodyInterceptor,
  ToolsService,
} from '../src/common';
import { MinioClientController } from '../src/minio/minio.controller';
import { MinioClientService } from '../src/minio/minio.service';
import { WordpressArticleController } from '../src/wordpress/wordpress-article.controller';
import { WordpressAuthController } from '../src/wordpress/wordpress-auth.controller';
import { WordpressCategoryController } from '../src/wordpress/wordpress-category.controller';
import { WordpressService } from '../src/wordpress/wordpress.service';
import { WordpressTagController } from '../src/wordpress/wordpress-tag.controller';
import {
  collectControllerRoutes,
  routeKey,
} from './helpers/controller-route.helper';

const component = {
  id: '2041739550026043392',
  name: '基础折线图',
  type: 1,
  componentType: 1,
  typeMsg: '图表',
  componentTypeMsg: '折线图',
  image: '',
  template: '{}',
  createTime: '2026-05-13T02:30:00.000Z',
  updateTime: '2026-05-13T02:30:00.000Z',
  is_deleted: false,
};

const dictOptions = [
  {
    label: '图表',
    value: 1,
  },
];

const chartOptions = [
  {
    label: '折线图',
    value: 1,
  },
];

const uploadResult = {
  bucketName: 'kt-template-online',
  objectName: 'uploads/demo.txt',
  etag: 'etag',
  size: 4,
  mimeType: 'text/plain',
  url: 'http://127.0.0.1:9000/kt-template-online/uploads/demo.txt',
};

const objectStat = {
  name: 'uploads/demo.txt',
  size: 4,
  etag: 'etag',
  lastModified: '2026-05-13T02:30:00.000Z',
};

const wordpressAuthContext = {
  authorization: 'Bearer wordpress-client-token',
};

const wordpressUser = {
  id: 1,
  name: 'WordPress Admin',
  slug: 'wordpress-admin',
};

const wordpressLoginResult = {
  auth: {
    nonce: 'wordpress-rest-nonce',
    type: 'cookie',
  },
  cookie: 'wordpress_logged_in_demo=1',
  user: wordpressUser,
};

const wordpressArticle = {
  id: 1,
  title: {
    rendered: 'WordPress 文章',
  },
  status: 'draft',
};

const wordpressTerm = {
  id: 1,
  name: 'WordPress 分类',
  slug: 'wordpress-category',
};

const componentServiceMock = {
  all: jest.fn(),
  page: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  update: jest.fn(),
  find: jest.fn(),
};

const authServiceMock = {
  currentUser: jest.fn(),
};

const unauthorizedException = () =>
  new HttpException(
    {
      msg: 'Unauthorized Exception',
      err: 'Unauthorized Exception',
    },
    HttpStatus.UNAUTHORIZED,
  );

const dictServiceMock = {
  getDictByKey: jest.fn(),
  getComponentDictByType: jest.fn(),
};

const minioServiceMock = {
  checkConnection: jest.fn(),
  ensureBucket: jest.fn(),
  uploadObject: jest.fn(),
  listObjects: jest.fn(),
  getPresignedUrl: jest.fn(),
  getObject: jest.fn(),
  removeObject: jest.fn(),
};

const wordpressServiceMock = {
  getAuthContext: jest.fn(),
  loginWithConfiguredAdmin: jest.fn(),
  setAuthCookie: jest.fn(),
  clearAuthCookie: jest.fn(),
  checkAuth: jest.fn(),
  articleList: jest.fn(),
  articleDetail: jest.fn(),
  articleSave: jest.fn(),
  articleUpdate: jest.fn(),
  articleRemove: jest.fn(),
  tagList: jest.fn(),
  tagDetail: jest.fn(),
  tagSave: jest.fn(),
  tagUpdate: jest.fn(),
  tagRemove: jest.fn(),
  categoryList: jest.fn(),
  categoryDetail: jest.fn(),
  categorySave: jest.fn(),
  categoryUpdate: jest.fn(),
  categoryRemove: jest.fn(),
};

const controllerClasses = [
  AppController,
  ComponentController,
  DictController,
  MinioClientController,
  WordpressAuthController,
  WordpressArticleController,
  WordpressTagController,
  WordpressCategoryController,
];
const controllerRoutes = collectControllerRoutes(controllerClasses);

type HttpServer = Parameters<typeof request>[0];
type RouteTestCase = (server: HttpServer) => Promise<void>;

const routeTestCases: Record<string, RouteTestCase> = {
  'GET /': async (server) => {
    await request(server).get('/').expect(301).expect('Location', '/api#/');
  },

  'GET /component/allList': async (server) => {
    componentServiceMock.all.mockResolvedValue([component]);

    const response = await request(server)
      .get('/component/allList')
      .expect(200);

    expect(componentServiceMock.all).toHaveBeenCalledWith();
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: [component],
    });
  },

  'GET /component/list': async (server) => {
    componentServiceMock.page.mockResolvedValue({
      list: [component],
      total: 1,
    });

    const response = await request(server)
      .get('/component/list')
      .query({
        pageNo: 1,
        pageSize: 10,
        name: '折线',
      })
      .expect(200);

    expect(componentServiceMock.page).toHaveBeenCalledWith({
      pageNo: '1',
      pageSize: '10',
      name: '折线',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: {
        list: [component],
        total: 1,
      },
    });
  },

  'POST /component/save': async (server) => {
    componentServiceMock.save.mockResolvedValue({
      id: component.id,
    });

    const response = await request(server)
      .post('/component/save')
      .send({
        id: '2041739550026043999',
        name: component.name,
        type: component.type,
        componentType: component.componentType,
        image: '',
        template: '{}',
      })
      .expect(200);

    expect(componentServiceMock.save).toHaveBeenCalledWith({
      name: component.name,
      type: component.type,
      componentType: component.componentType,
      image: '',
      template: '{}',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: component.id,
    });
  },

  'POST /component/remove': async (server) => {
    componentServiceMock.remove.mockResolvedValue(true);

    const response = await request(server)
      .post('/component/remove')
      .query({ id: component.id })
      .expect(200);

    expect(componentServiceMock.remove).toHaveBeenCalledWith(component.id);
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: true,
    });
  },

  'POST /component/update': async (server) => {
    componentServiceMock.update.mockResolvedValue(true);

    const response = await request(server)
      .post('/component/update')
      .send({
        id: component.id,
        name: component.name,
      })
      .expect(200);

    expect(componentServiceMock.update).toHaveBeenCalledWith({
      id: component.id,
      name: component.name,
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: true,
    });
  },

  'GET /component/detail': async (server) => {
    componentServiceMock.find.mockResolvedValue(component);

    const response = await request(server)
      .get('/component/detail')
      .query({ id: component.id })
      .expect(200);

    expect(componentServiceMock.find).toHaveBeenCalledWith(component.id);
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: component,
    });
  },

  'GET /dict/getDictByKey': async (server) => {
    dictServiceMock.getDictByKey.mockResolvedValue(dictOptions);

    const response = await request(server)
      .get('/dict/getDictByKey')
      .query({ dictKey: 'COMPONENT_TYPE' })
      .expect(200);

    expect(dictServiceMock.getDictByKey).toHaveBeenCalledWith('COMPONENT_TYPE');
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: dictOptions,
    });
  },

  'GET /dict/getComponentDictByType': async (server) => {
    dictServiceMock.getComponentDictByType.mockResolvedValue(chartOptions);

    const response = await request(server)
      .get('/dict/getComponentDictByType')
      .query({ type: 1 })
      .expect(200);

    expect(dictServiceMock.getComponentDictByType).toHaveBeenCalledWith(1);
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: chartOptions,
    });
  },

  'GET /minio/check': async (server) => {
    minioServiceMock.checkConnection.mockResolvedValue({
      bucketName: 'demo-bucket',
      exists: true,
    });

    const response = await request(server)
      .get('/minio/check')
      .query({ bucketName: 'demo-bucket' })
      .expect(200);

    expect(minioServiceMock.checkConnection).toHaveBeenCalledWith(
      'demo-bucket',
    );
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: {
        bucketName: 'demo-bucket',
        exists: true,
      },
    });
  },

  'POST /minio/bucket': async (server) => {
    minioServiceMock.ensureBucket.mockResolvedValue('demo-bucket');

    const response = await request(server)
      .post('/minio/bucket')
      .query({ bucketName: 'demo-bucket' })
      .expect(201);

    expect(minioServiceMock.ensureBucket).toHaveBeenCalledWith('demo-bucket');
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: 'demo-bucket',
    });
  },

  'POST /minio/upload': async (server) => {
    minioServiceMock.uploadObject.mockResolvedValue(uploadResult);

    const response = await request(server)
      .post('/minio/upload')
      .field('objectName', 'uploads/demo.txt')
      .attach('file', Buffer.from('demo'), {
        filename: 'demo.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    expect(minioServiceMock.uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'uploads/demo.txt',
        file: expect.objectContaining({
          originalname: 'demo.txt',
          mimetype: 'text/plain',
          size: 4,
        }),
      }),
    );
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: uploadResult,
    });
  },

  'GET /minio/list': async (server) => {
    minioServiceMock.listObjects.mockResolvedValue([objectStat]);

    const response = await request(server)
      .get('/minio/list')
      .query({
        bucketName: 'demo-bucket',
        prefix: 'uploads/',
        recursive: 'false',
      })
      .expect(200);

    expect(minioServiceMock.listObjects).toHaveBeenCalledWith({
      bucketName: 'demo-bucket',
      prefix: 'uploads/',
      recursive: false,
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: [objectStat],
    });
  },

  'GET /minio/url': async (server) => {
    minioServiceMock.getPresignedUrl.mockResolvedValue(
      'http://127.0.0.1:9000/kt-template-online/uploads/demo.txt',
    );

    const response = await request(server)
      .get('/minio/url')
      .query({
        objectName: 'uploads/demo.txt',
        bucketName: 'demo-bucket',
        expiry: 60,
      })
      .expect(200);

    expect(minioServiceMock.getPresignedUrl).toHaveBeenCalledWith(
      'uploads/demo.txt',
      'demo-bucket',
      60,
    );
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: 'http://127.0.0.1:9000/kt-template-online/uploads/demo.txt',
    });
  },

  'GET /minio/resource-proxy': async (server) => {
    const body = Buffer.from('proxy-content');
    const originalFetch = global.fetch;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn().mockReturnValue('text/css; charset=utf-8'),
      },
      arrayBuffer: jest
        .fn()
        .mockResolvedValue(
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        ),
    } as any);

    try {
      const response = await request(server)
        .get('/minio/resource-proxy')
        .query({ url: 'https://example.com/assets/style.css' })
        .expect(200);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/assets/style.css',
        expect.objectContaining({
          redirect: 'follow',
          signal: expect.any(AbortSignal),
        }),
      );
      expect(response.headers['content-type']).toContain('text/css');
      expect(response.text).toBe('proxy-content');
    } finally {
      global.fetch = originalFetch;
    }
  },

  'GET /minio/download': async (server) => {
    minioServiceMock.getObject.mockResolvedValue({
      stream: Readable.from(['file-content']),
      stat: {
        size: 12,
        etag: 'etag',
        lastModified: new Date('2026-05-13T02:30:00.000Z'),
        metaData: {
          'content-type': 'text/plain',
        },
      },
      bucketName: 'demo-bucket',
      objectName: 'uploads/demo.txt',
    });

    const response = await request(server)
      .get('/minio/download')
      .query({
        objectName: 'uploads/demo.txt',
        bucketName: 'demo-bucket',
      })
      .expect(200);

    expect(minioServiceMock.getObject).toHaveBeenCalledWith(
      'uploads/demo.txt',
      'demo-bucket',
    );
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toBe('file-content');
  },

  'DELETE /minio/remove': async (server) => {
    minioServiceMock.removeObject.mockResolvedValue(true);

    const response = await request(server)
      .delete('/minio/remove')
      .query({
        objectName: 'uploads/demo.txt',
        bucketName: 'demo-bucket',
      })
      .expect(200);

    expect(minioServiceMock.removeObject).toHaveBeenCalledWith(
      'uploads/demo.txt',
      'demo-bucket',
    );
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: true,
    });
  },

  'GET /wordpress/auth/check': async (server) => {
    wordpressServiceMock.checkAuth.mockResolvedValue(wordpressUser);

    const response = await request(server)
      .get('/wordpress/auth/check')
      .expect(200);

    expect(wordpressServiceMock.checkAuth).toHaveBeenCalledWith(
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressUser,
    });
  },

  'POST /wordpress/auth/login': async (server) => {
    wordpressServiceMock.loginWithConfiguredAdmin.mockResolvedValue(
      wordpressLoginResult,
    );

    const response = await request(server)
      .post('/wordpress/auth/login')
      .expect(201);

    expect(wordpressServiceMock.loginWithConfiguredAdmin).toHaveBeenCalledWith();
    expect(wordpressServiceMock.setAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
      wordpressLoginResult.cookie,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        auth: wordpressLoginResult.auth,
        user: wordpressUser,
      },
    });
  },

  'POST /wordpress/auth/logout': async (server) => {
    const response = await request(server)
      .post('/wordpress/auth/logout')
      .expect(201);

    expect(wordpressServiceMock.clearAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: true,
    });
  },

  'GET /wordpress/article/list': async (server) => {
    wordpressServiceMock.articleList.mockResolvedValue({
      list: [wordpressArticle],
      total: 1,
    });

    const response = await request(server)
      .get('/wordpress/article/list')
      .query({
        pageNo: 1,
        pageSize: 10,
        search: '文章',
      })
      .expect(200);

    expect(wordpressServiceMock.articleList).toHaveBeenCalledWith(
      {
        pageNo: '1',
        pageSize: '10',
        search: '文章',
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [wordpressArticle],
        total: 1,
      },
    });
  },

  'GET /wordpress/article/detail': async (server) => {
    wordpressServiceMock.articleDetail.mockResolvedValue(wordpressArticle);

    const response = await request(server)
      .get('/wordpress/article/detail')
      .query({ id: 1 })
      .expect(200);

    expect(wordpressServiceMock.articleDetail).toHaveBeenCalledWith(
      '1',
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressArticle,
    });
  },

  'POST /wordpress/article/save': async (server) => {
    wordpressServiceMock.articleSave.mockResolvedValue(wordpressArticle);

    const response = await request(server)
      .post('/wordpress/article/save')
      .send({
        id: 999,
        title: 'WordPress 文章',
        content: '文章内容',
      })
      .expect(200);

    expect(wordpressServiceMock.articleSave).toHaveBeenCalledWith(
      {
        title: 'WordPress 文章',
        content: '文章内容',
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressArticle,
    });
  },

  'POST /wordpress/article/update': async (server) => {
    wordpressServiceMock.articleUpdate.mockResolvedValue(wordpressArticle);

    const response = await request(server)
      .post('/wordpress/article/update')
      .send({
        id: 1,
        title: 'WordPress 文章',
      })
      .expect(200);

    expect(wordpressServiceMock.articleUpdate).toHaveBeenCalledWith(
      {
        id: 1,
        title: 'WordPress 文章',
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressArticle,
    });
  },

  'POST /wordpress/article/remove': async (server) => {
    wordpressServiceMock.articleRemove.mockResolvedValue(true);

    const response = await request(server)
      .post('/wordpress/article/remove')
      .query({
        id: 1,
        force: 'false',
      })
      .expect(200);

    expect(wordpressServiceMock.articleRemove).toHaveBeenCalledWith(
      '1',
      false,
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: true,
    });
  },

  'GET /wordpress/tag/list': async (server) => {
    wordpressServiceMock.tagList.mockResolvedValue({
      list: [wordpressTerm],
      total: 1,
    });

    const response = await request(server)
      .get('/wordpress/tag/list')
      .query({
        pageNo: 1,
        pageSize: 10,
        search: '分类',
      })
      .expect(200);

    expect(wordpressServiceMock.tagList).toHaveBeenCalledWith(
      {
        pageNo: '1',
        pageSize: '10',
        search: '分类',
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [wordpressTerm],
        total: 1,
      },
    });
  },

  'GET /wordpress/tag/detail': async (server) => {
    wordpressServiceMock.tagDetail.mockResolvedValue(wordpressTerm);

    const response = await request(server)
      .get('/wordpress/tag/detail')
      .query({ id: 1 })
      .expect(200);

    expect(wordpressServiceMock.tagDetail).toHaveBeenCalledWith(
      '1',
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressTerm,
    });
  },

  'POST /wordpress/tag/save': async (server) => {
    wordpressServiceMock.tagSave.mockResolvedValue(wordpressTerm);

    const response = await request(server)
      .post('/wordpress/tag/save')
      .send({
        id: 999,
        name: 'WordPress 标签',
      })
      .expect(200);

    expect(wordpressServiceMock.tagSave).toHaveBeenCalledWith(
      {
        name: 'WordPress 标签',
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressTerm,
    });
  },

  'POST /wordpress/tag/update': async (server) => {
    wordpressServiceMock.tagUpdate.mockResolvedValue(wordpressTerm);

    const response = await request(server)
      .post('/wordpress/tag/update')
      .send({
        id: 1,
        name: 'WordPress 标签',
      })
      .expect(200);

    expect(wordpressServiceMock.tagUpdate).toHaveBeenCalledWith(
      {
        id: 1,
        name: 'WordPress 标签',
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressTerm,
    });
  },

  'POST /wordpress/tag/remove': async (server) => {
    wordpressServiceMock.tagRemove.mockResolvedValue(true);

    const response = await request(server)
      .post('/wordpress/tag/remove')
      .query({ id: 1 })
      .expect(200);

    expect(wordpressServiceMock.tagRemove).toHaveBeenCalledWith(
      '1',
      true,
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: true,
    });
  },

  'GET /wordpress/category/list': async (server) => {
    wordpressServiceMock.categoryList.mockResolvedValue({
      list: [wordpressTerm],
      total: 1,
    });

    const response = await request(server)
      .get('/wordpress/category/list')
      .query({
        pageNo: 1,
        pageSize: 10,
        search: '分类',
      })
      .expect(200);

    expect(wordpressServiceMock.categoryList).toHaveBeenCalledWith(
      {
        pageNo: '1',
        pageSize: '10',
        search: '分类',
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [wordpressTerm],
        total: 1,
      },
    });
  },

  'GET /wordpress/category/detail': async (server) => {
    wordpressServiceMock.categoryDetail.mockResolvedValue(wordpressTerm);

    const response = await request(server)
      .get('/wordpress/category/detail')
      .query({ id: 1 })
      .expect(200);

    expect(wordpressServiceMock.categoryDetail).toHaveBeenCalledWith(
      '1',
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressTerm,
    });
  },

  'POST /wordpress/category/save': async (server) => {
    wordpressServiceMock.categorySave.mockResolvedValue(wordpressTerm);

    const response = await request(server)
      .post('/wordpress/category/save')
      .send({
        id: 999,
        name: 'WordPress 分类',
        parent: 0,
      })
      .expect(200);

    expect(wordpressServiceMock.categorySave).toHaveBeenCalledWith(
      {
        name: 'WordPress 分类',
        parent: 0,
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressTerm,
    });
  },

  'POST /wordpress/category/update': async (server) => {
    wordpressServiceMock.categoryUpdate.mockResolvedValue(wordpressTerm);

    const response = await request(server)
      .post('/wordpress/category/update')
      .send({
        id: 1,
        name: 'WordPress 分类',
        parent: 0,
      })
      .expect(200);

    expect(wordpressServiceMock.categoryUpdate).toHaveBeenCalledWith(
      {
        id: 1,
        name: 'WordPress 分类',
        parent: 0,
      },
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressTerm,
    });
  },

  'POST /wordpress/category/remove': async (server) => {
    wordpressServiceMock.categoryRemove.mockResolvedValue(true);

    const response = await request(server)
      .post('/wordpress/category/remove')
      .query({ id: 1 })
      .expect(200);

    expect(wordpressServiceMock.categoryRemove).toHaveBeenCalledWith(
      '1',
      true,
      wordpressAuthContext,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: true,
    });
  },
};

describe('KT Template Online API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: controllerClasses,
      providers: [
        AppService,
        ToolsService,
        Reflector,
        {
          provide: ComponentService,
          useValue: componentServiceMock,
        },
        {
          provide: AdminAuthService,
          useValue: authServiceMock,
        },
        JwtAuthGuard,
        {
          provide: DictService,
          useValue: dictServiceMock,
        },
        {
          provide: MinioClientService,
          useValue: minioServiceMock,
        },
        {
          provide: WordpressService,
          useValue: wordpressServiceMock,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: SaveBodyInterceptor,
        },
        {
          provide: APP_FILTER,
          useClass: ApiExceptionFilter,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authServiceMock.currentUser.mockResolvedValue({
      id: '2041739550026043001',
      username: 'admin',
    });
    wordpressServiceMock.getAuthContext.mockReturnValue(wordpressAuthContext);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps generated e2e cases aligned with controller routes', () => {
    expect(Object.keys(routeTestCases).sort()).toEqual(
      controllerRoutes.map(routeKey).sort(),
    );
  });

  describe('generated route smoke tests', () => {
    controllerRoutes.forEach((route) => {
      const key = routeKey(route);

      it(`${key} -> ${route.controllerName}.${route.handlerName}`, async () => {
        const testCase = routeTestCases[key];

        expect(testCase).toBeDefined();
        await testCase(app.getHttpServer());
      });
    });
  });

  it('returns component update failure in a unified response shape', async () => {
    componentServiceMock.update.mockResolvedValue(false);

    const response = await request(app.getHttpServer())
      .post('/component/update')
      .send({
        id: component.id,
        name: component.name,
      })
      .expect(200);

    expect(response.body).toEqual({
      code: 400,
      msg: '操作失败',
      err: false,
    });
  });

  it('protects dict, minio and wordpress endpoints with jwt auth', async () => {
    authServiceMock.currentUser.mockRejectedValue(unauthorizedException());

    await request(app.getHttpServer())
      .get('/dict/getDictByKey')
      .query({ dictKey: 'COMPONENT_TYPE' })
      .expect(401)
      .expect(({ body }) => {
        expect(body).toEqual({
          code: 401,
          msg: 'Unauthorized Exception',
          err: 'Unauthorized Exception',
        });
      });

    expect(dictServiceMock.getDictByKey).not.toHaveBeenCalled();

    jest.clearAllMocks();
    authServiceMock.currentUser.mockRejectedValue(unauthorizedException());

    await request(app.getHttpServer()).get('/minio/check').expect(401);

    expect(minioServiceMock.checkConnection).not.toHaveBeenCalled();

    jest.clearAllMocks();
    authServiceMock.currentUser.mockRejectedValue(unauthorizedException());

    await request(app.getHttpServer())
      .get('/wordpress/auth/check')
      .expect(401);

    expect(wordpressServiceMock.checkAuth).not.toHaveBeenCalled();
  });
});
