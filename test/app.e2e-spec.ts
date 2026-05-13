import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import { Readable } from 'stream';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { SaveBodyInterceptor, ToolsService } from '../src/common';
import { ComponentController } from '../src/component/component.controller';
import { ComponentService } from '../src/component/component.service';
import { DictController } from '../src/dict/dict.controller';
import { DictService } from '../src/dict/dict.service';
import { MinioClientController } from '../src/minio/minio.controller';
import { MinioClientService } from '../src/minio/minio.service';
import {
  collectControllerRoutes,
  routeKey,
} from './helpers/controller-route.helper';

const component = {
  id: 'component-id',
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

const componentServiceMock = {
  all: jest.fn(),
  page: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  update: jest.fn(),
  find: jest.fn(),
};

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

const controllerClasses = [
  AppController,
  ComponentController,
  DictController,
  MinioClientController,
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
        id: 'frontend-id',
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
          provide: DictService,
          useValue: dictServiceMock,
        },
        {
          provide: MinioClientService,
          useValue: minioServiceMock,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: SaveBodyInterceptor,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
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
      data: false,
    });
  });
});
