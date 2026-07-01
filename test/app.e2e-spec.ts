import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Readable } from 'stream';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AdminAuthService } from '../src/modules/admin/identity/auth/admin-auth.service';
import { JwtAuthGuard } from '../src/modules/admin/identity/auth/jwt-auth.guard';
import { ComponentController } from '../src/modules/admin/platform-config/component/component.controller';
import { ComponentService } from '../src/modules/admin/platform-config/component/component.service';
import { DictController } from '../src/modules/admin/platform-config/dict/dict.controller';
import { DictService } from '../src/modules/admin/platform-config/dict/dict.service';
import { SystemLogController } from '../src/modules/admin/platform-config/system-log/system-log.controller';
import { SystemLogService } from '../src/modules/admin/platform-config/system-log/system-log.service';
import {
  ApiExceptionFilter,
  IS_PUBLIC_KEY,
  SaveBodyInterceptor,
  ToolsService,
} from '../src/common';
import { BlogArticleService } from '../src/modules/blog/application/blog-article.service';
import { BlogTermService } from '../src/modules/blog/application/blog-term.service';
import { BlogThemeConfigService } from '../src/modules/blog/application/blog-theme-config.service';
import { BlogArticleController } from '../src/modules/blog/contract/blog-article.controller';
import { BlogTermController } from '../src/modules/blog/contract/blog-term.controller';
import { BlogThemeConfigController } from '../src/modules/blog/contract/blog-theme-config.controller';
import { MinioClientService } from '../src/modules/asset/application/asset-minio.service';
import { MinioClientController } from '../src/modules/asset/contract/asset-minio.controller';
import { WordpressService } from '../src/modules/wordpress/application/wordpress.service';
import { WordpressArticleController } from '../src/modules/wordpress/contract/wordpress-article.controller';
import { WordpressAuthController } from '../src/modules/wordpress/contract/wordpress-auth.controller';
import { WordpressCategoryController } from '../src/modules/wordpress/contract/wordpress-category.controller';
import { WordpressTagController } from '../src/modules/wordpress/contract/wordpress-tag.controller';
import { WordpressThemeController } from '../src/modules/wordpress/contract/wordpress-theme.controller';
import { PinoLogger } from 'nestjs-pino';
import {
  collectControllerRoutes,
  routeKey,
} from './helpers/controller-route.helper';
import type { RouteTestCase } from './test.types';

const component = {
  id: '2041739550026043392',
  name: '基础折线图',
  type: 1,
  componentType: 1,
  typeMsg: '图表',
  componentTypeMsg: '折线图',
  image: '',
  template: '{}',
  createTime: '2026-05-13 10:30:00',
  updateTime: '2026-05-13 10:30:00',
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

const dictItem = {
  childrenCode: 'CHART',
  dictCode: 'COMPONENT_TYPE',
  id: '2041700000000300001',
  label: '图表',
  sort: 1,
  status: 1,
  value: '1',
};

const dictTreeItem = {
  ...dictItem,
  children: [
    {
      childrenCode: null,
      dictCode: 'CHART',
      id: '2041700000000300002',
      label: '折线图',
      sort: 1,
      status: 1,
      treeKey: '2041700000000300001/2041700000000300002',
      value: '1',
    },
  ],
  treeKey: '2041700000000300001',
};

const dictGroupItem = {
  dictCode: 'COMPONENT_TYPE',
  id: 'dict-code:COMPONENT_TYPE',
  itemCount: 2,
  label: 'COMPONENT_TYPE',
  value: 'COMPONENT_TYPE',
};

const systemLogItem = {
  context: 'ApiExceptionFilter',
  durationMs: 12,
  hostname: 'kt-template-online-api',
  id: '1760000000000000000-0-0',
  level: 'error',
  message: 'Loki smoke log',
  method: 'GET',
  path: '/system/logs',
  raw: '{"level":50,"msg":"Loki smoke log"}',
  requestId: 'request-id',
  statusCode: 500,
  timestamp: '2026-06-04 08:00:00',
  timestampNs: '1760000000000000000',
};

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
  lastModified: '2026-05-13 10:30:00',
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

const blogArticle = {
  authorName: 'KwiTsukasa',
  categories: ['技术'],
  categoriesResolved: [{ name: '技术', slug: 'tech' }],
  contentHtml: '<h1>本地文章</h1>',
  contentMarkdown: '# 本地文章',
  id: '2041800000000000001',
  slug: 'local-article',
  status: 'draft',
  tags: ['Milkdown'],
  tagsResolved: [{ name: 'Milkdown', slug: 'milkdown' }],
  title: '本地文章',
};

const wordpressTerm = {
  id: 1,
  name: 'WordPress 分类',
  slug: 'wordpress-category',
};

const blogTerm = {
  count: 1,
  description: '本地分类描述',
  id: '2041800000000000100',
  name: '技术',
  slug: 'tech',
};

const wordpressThemeConfig = {
  bodyClass: ['home', 'blog', 'wp-theme-argon'],
  darkmodeAutoSwitch: 'alwayson',
  enableCustomThemeColor: true,
  htmlClass: [
    'triple-column',
    'immersion-color',
    'toolbar-blur',
    'article-header-style-default',
  ],
  site: {
    description: '',
    home: 'https://blog.kwitsukasa.top',
    title: 'KwiTsukasa的小站',
    url: 'https://blog.kwitsukasa.top',
  },
  themeCardRadius: 4,
  themeColor: '#c3a1ed',
  themeColorRgb: '195,161,237',
  themeVersion: '1.3.5',
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

/**
 * 执行 测试断言流程。
 */
const unauthorizedException = () =>
  new HttpException(
    {
      msg: 'Unauthorized Exception',
      err: 'Unauthorized Exception',
    },
    HttpStatus.UNAUTHORIZED,
  );

const dictServiceMock = {
  codes: jest.fn(),
  getDictCodeOptions: jest.fn(),
  getDictByKey: jest.fn(),
  getComponentDictByType: jest.fn(),
  groups: jest.fn(),
  page: jest.fn(),
  remove: jest.fn(),
  save: jest.fn(),
  toggle: jest.fn(),
  tree: jest.fn(),
  update: jest.fn(),
};

const systemLogServiceMock = {
  levels: jest.fn(),
  page: jest.fn(),
  status: jest.fn(),
  summary: jest.fn(),
};

const pinoLoggerMock = {
  error: jest.fn(),
  setContext: jest.fn(),
  warn: jest.fn(),
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

const blogArticleServiceMock = {
  page: jest.fn(),
  detail: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  categoryOptions: jest.fn(),
  tagOptions: jest.fn(),
  publicList: jest.fn(),
  publicDetail: jest.fn(),
  importFromWordpress: jest.fn(),
};

const blogTermServiceMock = {
  detail: jest.fn(),
  options: jest.fn(),
  page: jest.fn(),
  remove: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

const blogThemeConfigServiceMock = {
  importFromWordpress: jest.fn(),
  publicConfig: jest.fn(),
  save: jest.fn(),
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
  publicArticleList: jest.fn(),
  publicArticleDetail: jest.fn(),
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
  themeConfig: jest.fn(),
};

const controllerClasses = [
  AppController,
  ComponentController,
  DictController,
  SystemLogController,
  BlogArticleController,
  BlogTermController,
  BlogThemeConfigController,
  MinioClientController,
  WordpressAuthController,
  WordpressArticleController,
  WordpressTagController,
  WordpressCategoryController,
  WordpressThemeController,
];
const controllerRoutes = collectControllerRoutes(controllerClasses);

const routeTestCases: Record<string, RouteTestCase> = {
  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /': async (server) => {
    await request(server).get('/').expect(301).expect('Location', '/api#/');
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/article/list': async (server) => {
    blogArticleServiceMock.page.mockResolvedValue({
      list: [blogArticle],
      total: 1,
    });

    const response = await request(server)
      .get('/blog/article/list')
      .query({ pageNo: 1, pageSize: 10, search: '本地' })
      .expect(200);

    expect(blogArticleServiceMock.page).toHaveBeenCalledWith({
      pageNo: '1',
      pageSize: '10',
      search: '本地',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [blogArticle],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/article/detail': async (server) => {
    blogArticleServiceMock.detail.mockResolvedValue(blogArticle);

    const response = await request(server)
      .get('/blog/article/detail')
      .query({ id: blogArticle.id })
      .expect(200);

    expect(blogArticleServiceMock.detail).toHaveBeenCalledWith(blogArticle.id);
    expect(response.body).toMatchObject({
      code: 200,
      data: blogArticle,
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/article/public/list': async (server) => {
    blogArticleServiceMock.publicList.mockResolvedValue({
      list: [blogArticle],
      total: 1,
    });

    const response = await request(server)
      .get('/blog/article/public/list')
      .query({ pageNo: 1, pageSize: 10 })
      .expect(200);

    expect(blogArticleServiceMock.publicList).toHaveBeenCalledWith({
      pageNo: '1',
      pageSize: '10',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [blogArticle],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/article/public/detail': async (server) => {
    blogArticleServiceMock.publicDetail.mockResolvedValue(blogArticle);

    const response = await request(server)
      .get('/blog/article/public/detail')
      .query({ slug: blogArticle.slug })
      .expect(200);

    expect(blogArticleServiceMock.publicDetail).toHaveBeenCalledWith({
      id: undefined,
      slug: blogArticle.slug,
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: blogArticle,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/article/save': async (server) => {
    blogArticleServiceMock.save.mockResolvedValue(blogArticle);

    const response = await request(server)
      .post('/blog/article/save')
      .send({
        content: '# 本地文章',
        contentFormat: 'markdown',
        title: '本地文章',
      })
      .expect(200);

    expect(blogArticleServiceMock.save).toHaveBeenCalledWith({
      content: '# 本地文章',
      contentFormat: 'markdown',
      title: '本地文章',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: blogArticle,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/article/update': async (server) => {
    blogArticleServiceMock.update.mockResolvedValue(blogArticle);

    const response = await request(server)
      .post('/blog/article/update')
      .send({
        content: '<pre class="wp-block-code hljs-codeblock"></pre>',
        contentFormat: 'html',
        id: blogArticle.id,
        title: '本地文章',
      })
      .expect(200);

    expect(blogArticleServiceMock.update).toHaveBeenCalledWith({
      content: '<pre class="wp-block-code hljs-codeblock"></pre>',
      contentFormat: 'html',
      id: blogArticle.id,
      title: '本地文章',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: blogArticle,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/article/remove': async (server) => {
    blogArticleServiceMock.remove.mockResolvedValue(true);

    const response = await request(server)
      .post('/blog/article/remove')
      .query({ id: blogArticle.id })
      .expect(200);

    expect(blogArticleServiceMock.remove).toHaveBeenCalledWith(blogArticle.id);
    expect(response.body).toMatchObject({
      code: 200,
      data: true,
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/article/category-options': async (server) => {
    blogArticleServiceMock.categoryOptions.mockResolvedValue({
      list: [{ count: 1, id: 'tech', name: '技术', slug: 'tech' }],
      total: 1,
    });

    const response = await request(server)
      .get('/blog/article/category-options')
      .query({ pageNo: 1, pageSize: 20, search: '技' })
      .expect(200);

    expect(blogArticleServiceMock.categoryOptions).toHaveBeenCalledWith({
      pageNo: '1',
      pageSize: '20',
      search: '技',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [{ count: 1, id: 'tech', name: '技术', slug: 'tech' }],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/article/tag-options': async (server) => {
    blogArticleServiceMock.tagOptions.mockResolvedValue({
      list: [{ count: 1, id: 'milkdown', name: 'Milkdown', slug: 'milkdown' }],
      total: 1,
    });

    const response = await request(server)
      .get('/blog/article/tag-options')
      .query({ pageNo: 1, pageSize: 20, search: 'milk' })
      .expect(200);

    expect(blogArticleServiceMock.tagOptions).toHaveBeenCalledWith({
      pageNo: '1',
      pageSize: '20',
      search: 'milk',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [
          { count: 1, id: 'milkdown', name: 'Milkdown', slug: 'milkdown' },
        ],
        total: 1,
      },
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/article/import-wordpress': async (server) => {
    blogArticleServiceMock.importFromWordpress.mockResolvedValue({
      created: 1,
      items: [
        {
          action: 'created',
          id: blogArticle.id,
          slug: blogArticle.slug,
          title: blogArticle.title,
        },
      ],
      skipped: 0,
      total: 1,
      updated: 0,
    });

    const response = await request(server)
      .post('/blog/article/import-wordpress')
      .send({
        overwrite: false,
        pageNo: 1,
        pageSize: 10,
      })
      .expect(200);

    expect(blogArticleServiceMock.importFromWordpress).toHaveBeenCalledWith({
      overwrite: false,
      pageNo: 1,
      pageSize: 10,
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        created: 1,
        skipped: 0,
        total: 1,
        updated: 0,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/category/list': async (server) => {
    blogTermServiceMock.page.mockResolvedValue({
      list: [blogTerm],
      total: 1,
    });

    const response = await request(server)
      .get('/blog/category/list')
      .query({ pageNo: 1, pageSize: 10, search: '技' })
      .expect(200);

    expect(blogTermServiceMock.page).toHaveBeenCalledWith('category', {
      pageNo: '1',
      pageSize: '10',
      search: '技',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [blogTerm],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/category/detail': async (server) => {
    blogTermServiceMock.detail.mockResolvedValue(blogTerm);

    const response = await request(server)
      .get('/blog/category/detail')
      .query({ id: blogTerm.id })
      .expect(200);

    expect(blogTermServiceMock.detail).toHaveBeenCalledWith(
      'category',
      blogTerm.id,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: blogTerm,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/category/save': async (server) => {
    blogTermServiceMock.save.mockResolvedValue(blogTerm);

    const response = await request(server)
      .post('/blog/category/save')
      .send({
        description: blogTerm.description,
        name: blogTerm.name,
        slug: blogTerm.slug,
      })
      .expect(200);

    expect(blogTermServiceMock.save).toHaveBeenCalledWith('category', {
      description: blogTerm.description,
      name: blogTerm.name,
      slug: blogTerm.slug,
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: blogTerm,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/category/update': async (server) => {
    blogTermServiceMock.update.mockResolvedValue(blogTerm);

    const response = await request(server)
      .post('/blog/category/update')
      .send({
        id: blogTerm.id,
        name: blogTerm.name,
      })
      .expect(200);

    expect(blogTermServiceMock.update).toHaveBeenCalledWith('category', {
      id: blogTerm.id,
      name: blogTerm.name,
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: blogTerm,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/category/remove': async (server) => {
    blogTermServiceMock.remove.mockResolvedValue(true);

    const response = await request(server)
      .post('/blog/category/remove')
      .query({ id: blogTerm.id })
      .expect(200);

    expect(blogTermServiceMock.remove).toHaveBeenCalledWith(
      'category',
      blogTerm.id,
    );
    expect(response.body).toMatchObject({
      code: 200,
      data: true,
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/tag/list': async (server) => {
    blogTermServiceMock.page.mockResolvedValue({
      list: [blogTerm],
      total: 1,
    });

    const response = await request(server)
      .get('/blog/tag/list')
      .query({ pageNo: 1, pageSize: 10, search: '技' })
      .expect(200);

    expect(blogTermServiceMock.page).toHaveBeenCalledWith('tag', {
      pageNo: '1',
      pageSize: '10',
      search: '技',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [blogTerm],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/tag/detail': async (server) => {
    blogTermServiceMock.detail.mockResolvedValue(blogTerm);

    const response = await request(server)
      .get('/blog/tag/detail')
      .query({ id: blogTerm.id })
      .expect(200);

    expect(blogTermServiceMock.detail).toHaveBeenCalledWith('tag', blogTerm.id);
    expect(response.body).toMatchObject({
      code: 200,
      data: blogTerm,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/tag/save': async (server) => {
    blogTermServiceMock.save.mockResolvedValue(blogTerm);

    const response = await request(server)
      .post('/blog/tag/save')
      .send({
        name: blogTerm.name,
        slug: blogTerm.slug,
      })
      .expect(200);

    expect(blogTermServiceMock.save).toHaveBeenCalledWith('tag', {
      name: blogTerm.name,
      slug: blogTerm.slug,
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: blogTerm,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/tag/update': async (server) => {
    blogTermServiceMock.update.mockResolvedValue(blogTerm);

    const response = await request(server)
      .post('/blog/tag/update')
      .send({
        id: blogTerm.id,
        name: blogTerm.name,
      })
      .expect(200);

    expect(blogTermServiceMock.update).toHaveBeenCalledWith('tag', {
      id: blogTerm.id,
      name: blogTerm.name,
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: blogTerm,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/tag/remove': async (server) => {
    blogTermServiceMock.remove.mockResolvedValue(true);

    const response = await request(server)
      .post('/blog/tag/remove')
      .query({ id: blogTerm.id })
      .expect(200);

    expect(blogTermServiceMock.remove).toHaveBeenCalledWith('tag', blogTerm.id);
    expect(response.body).toMatchObject({
      code: 200,
      data: true,
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/term/options': async (server) => {
    blogTermServiceMock.options.mockResolvedValue({
      list: [blogTerm],
      total: 1,
    });

    const response = await request(server)
      .get('/blog/term/options')
      .query({ kind: 'category', pageNo: 1, pageSize: 10 })
      .expect(200);

    expect(blogTermServiceMock.options).toHaveBeenCalledWith('category', {
      kind: 'category',
      pageNo: '1',
      pageSize: '10',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [blogTerm],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /blog/theme/config': async (server) => {
    blogThemeConfigServiceMock.publicConfig.mockResolvedValue(
      wordpressThemeConfig,
    );

    const response = await request(server)
      .get('/blog/theme/config')
      .expect(200);

    expect(blogThemeConfigServiceMock.publicConfig).toHaveBeenCalledWith();
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressThemeConfig,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/theme/save': async (server) => {
    blogThemeConfigServiceMock.save.mockResolvedValue(wordpressThemeConfig);

    const response = await request(server)
      .post('/blog/theme/save')
      .send({
        config: wordpressThemeConfig,
        source: 'local-admin',
      })
      .expect(200);

    expect(blogThemeConfigServiceMock.save).toHaveBeenCalledWith({
      config: wordpressThemeConfig,
      source: 'local-admin',
    });
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressThemeConfig,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /blog/theme/import-wordpress': async (server) => {
    blogThemeConfigServiceMock.importFromWordpress.mockResolvedValue(
      wordpressThemeConfig,
    );

    const response = await request(server)
      .post('/blog/theme/import-wordpress')
      .expect(200);

    expect(
      blogThemeConfigServiceMock.importFromWordpress,
    ).toHaveBeenCalledWith();
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressThemeConfig,
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /dict/list': async (server) => {
    dictServiceMock.page.mockResolvedValue({
      items: [dictItem],
      total: 1,
    });

    const response = await request(server)
      .get('/dict/list')
      .query({ dictCode: 'COMPONENT_TYPE', pageNo: 1, pageSize: 10 })
      .expect(200);

    expect(dictServiceMock.page).toHaveBeenCalledWith({
      dictCode: 'COMPONENT_TYPE',
      pageNo: '1',
      pageSize: '10',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: {
        items: [dictItem],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /dict/tree': async (server) => {
    dictServiceMock.tree.mockResolvedValue([dictTreeItem]);

    const response = await request(server)
      .get('/dict/tree')
      .query({ dictCode: 'COMPONENT_TYPE' })
      .expect(200);

    expect(dictServiceMock.tree).toHaveBeenCalledWith({
      dictCode: 'COMPONENT_TYPE',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: [dictTreeItem],
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /dict/groups': async (server) => {
    dictServiceMock.groups.mockResolvedValue({
      items: [dictGroupItem],
      total: 1,
    });

    const response = await request(server)
      .get('/dict/groups')
      .query({ keyword: 'COMPONENT', pageNo: 1, pageSize: 10 })
      .expect(200);

    expect(dictServiceMock.groups).toHaveBeenCalledWith({
      keyword: 'COMPONENT',
      pageNo: '1',
      pageSize: '10',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: {
        items: [dictGroupItem],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /dict/codes': async (server) => {
    dictServiceMock.getDictCodeOptions.mockResolvedValue([
      {
        label: 'COMPONENT_TYPE',
        value: 'COMPONENT_TYPE',
      },
    ]);

    const response = await request(server).get('/dict/codes').expect(200);

    expect(dictServiceMock.getDictCodeOptions).toHaveBeenCalledWith();
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: [
        {
          label: 'COMPONENT_TYPE',
          value: 'COMPONENT_TYPE',
        },
      ],
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /dict/save': async (server) => {
    dictServiceMock.save.mockResolvedValue(dictItem.id);

    const response = await request(server)
      .post('/dict/save')
      .send({
        childrenCode: 'CHART',
        dictCode: 'COMPONENT_TYPE',
        label: '图表',
        sort: 1,
        status: 1,
        value: '1',
      })
      .expect(200);

    expect(dictServiceMock.save).toHaveBeenCalledWith({
      childrenCode: 'CHART',
      dictCode: 'COMPONENT_TYPE',
      label: '图表',
      sort: 1,
      status: 1,
      value: '1',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: dictItem.id,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /dict/update': async (server) => {
    dictServiceMock.update.mockResolvedValue(null);

    const response = await request(server)
      .post('/dict/update')
      .send({
        id: dictItem.id,
        label: '图表',
      })
      .expect(200);

    expect(dictServiceMock.update).toHaveBeenCalledWith({
      id: dictItem.id,
      label: '图表',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: null,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'DELETE /dict/:id': async (server) => {
    dictServiceMock.remove.mockResolvedValue(null);

    const response = await request(server)
      .delete(`/dict/${dictItem.id}`)
      .expect(200);

    expect(dictServiceMock.remove).toHaveBeenCalledWith(dictItem.id);
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: null,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /dict/toggle': async (server) => {
    dictServiceMock.toggle.mockResolvedValue(null);

    const response = await request(server)
      .post('/dict/toggle')
      .query({ id: dictItem.id, status: 0 })
      .expect(200);

    expect(dictServiceMock.toggle).toHaveBeenCalledWith(dictItem.id, 0);
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: null,
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /system/logs': async (server) => {
    systemLogServiceMock.page.mockResolvedValue({
      items: [systemLogItem],
      total: 1,
    });

    const response = await request(server)
      .get('/system/logs')
      .query({ level: 'error', pageNo: 1, pageSize: 20 })
      .expect(200);

    expect(systemLogServiceMock.page).toHaveBeenCalledWith({
      level: 'error',
      pageNo: '1',
      pageSize: '20',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: {
        items: [systemLogItem],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /system/logs/levels': async (server) => {
    systemLogServiceMock.levels.mockReturnValue([
      { label: 'error', value: 'error' },
    ]);

    const response = await request(server)
      .get('/system/logs/levels')
      .expect(200);

    expect(systemLogServiceMock.levels).toHaveBeenCalledWith();
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: [{ label: 'error', value: 'error' }],
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /system/logs/status': async (server) => {
    systemLogServiceMock.status.mockReturnValue({
      app: 'kt-template-online-api',
      configured: true,
      env: 'test',
      host: 'http://loki:3100',
      selector: '{app="kt-template-online-api",env="test"}',
    });

    const response = await request(server)
      .get('/system/logs/status')
      .expect(200);

    expect(systemLogServiceMock.status).toHaveBeenCalledWith();
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: {
        app: 'kt-template-online-api',
        configured: true,
        env: 'test',
        host: 'http://loki:3100',
        selector: '{app="kt-template-online-api",env="test"}',
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /system/logs/summary': async (server) => {
    systemLogServiceMock.summary.mockResolvedValue([
      { count: 1, level: 'error' },
    ]);

    const response = await request(server)
      .get('/system/logs/summary')
      .query({ rangeMinutes: 30 })
      .expect(200);

    expect(systemLogServiceMock.summary).toHaveBeenCalledWith({
      rangeMinutes: '30',
    });
    expect(response.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: [{ count: 1, level: 'error' }],
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'POST /wordpress/auth/login': async (server) => {
    wordpressServiceMock.loginWithConfiguredAdmin.mockResolvedValue(
      wordpressLoginResult,
    );

    const response = await request(server)
      .post('/wordpress/auth/login')
      .expect(201);

    expect(
      wordpressServiceMock.loginWithConfiguredAdmin,
    ).toHaveBeenCalledWith();
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /wordpress/article/public/list': async (server) => {
    wordpressServiceMock.publicArticleList.mockResolvedValue({
      list: [wordpressArticle],
      total: 1,
    });

    const response = await request(server)
      .get('/wordpress/article/public/list')
      .query({
        pageNo: 1,
        pageSize: 10,
        search: '文章',
      })
      .expect(200);

    expect(wordpressServiceMock.publicArticleList).toHaveBeenCalledWith({
      pageNo: '1',
      pageSize: '10',
      search: '文章',
    });
    expect(wordpressServiceMock.getAuthContext).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      code: 200,
      data: {
        list: [wordpressArticle],
        total: 1,
      },
    });
  },

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /wordpress/article/public/detail': async (server) => {
    wordpressServiceMock.publicArticleDetail.mockResolvedValue(
      wordpressArticle,
    );

    const response = await request(server)
      .get('/wordpress/article/public/detail')
      .query({ slug: 'wordpress-article' })
      .expect(200);

    expect(wordpressServiceMock.publicArticleDetail).toHaveBeenCalledWith({
      id: undefined,
      slug: 'wordpress-article',
    });
    expect(wordpressServiceMock.getAuthContext).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressArticle,
    });
  },

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 执行 测试回调。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
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

  /**
   * 读取 测试回调数据。
   * @param server - server 输入；驱动 `request()` 的 测试步骤。
   */
  'GET /wordpress/theme/config': async (server) => {
    wordpressServiceMock.themeConfig.mockResolvedValue(wordpressThemeConfig);

    const response = await request(server)
      .get('/wordpress/theme/config')
      .expect(200);

    expect(wordpressServiceMock.themeConfig).toHaveBeenCalledWith();
    expect(wordpressServiceMock.getAuthContext).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      code: 200,
      data: wordpressThemeConfig,
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
          provide: SystemLogService,
          useValue: systemLogServiceMock,
        },
        {
          provide: BlogArticleService,
          useValue: blogArticleServiceMock,
        },
        {
          provide: BlogTermService,
          useValue: blogTermServiceMock,
        },
        {
          provide: BlogThemeConfigService,
          useValue: blogThemeConfigServiceMock,
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
          provide: PinoLogger,
          useValue: pinoLoggerMock,
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

  it('keeps Blog Web runtime endpoints public for WordPress replacement', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        BlogArticleController.prototype.publicList,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        BlogArticleController.prototype.publicDetail,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        BlogThemeConfigController.prototype.config,
      ),
    ).toBe(true);
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
      err: 'false',
    });
  });

  it('serializes object error details as a string for frontend parsing', async () => {
    wordpressServiceMock.checkAuth.mockRejectedValue(
      new HttpException(
        {
          msg: 'WordPress 请求失败',
          err: {
            code: 'WORDPRESS_NETWORK_ERROR',
            message: 'connect ECONNREFUSED 127.0.0.1:8080',
          },
        },
        HttpStatus.BAD_GATEWAY,
      ),
    );

    const response = await request(app.getHttpServer())
      .get('/wordpress/auth/check')
      .expect(502);

    expect(response.body).toEqual({
      code: 502,
      msg: 'WordPress 请求失败',
      err: 'connect ECONNREFUSED 127.0.0.1:8080',
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

    await request(app.getHttpServer()).get('/wordpress/auth/check').expect(401);

    expect(wordpressServiceMock.checkAuth).not.toHaveBeenCalled();
  });
});
