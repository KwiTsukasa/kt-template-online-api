import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type {
  ApiResponseOptions,
  SwaggerComponents,
  SwaggerOperation,
  SwaggerSchema,
} from '../types';

const primitiveTypeMap = {
  string: String,
  number: Number,
  boolean: Boolean,
};

const setClassName = (target: Type<any>, name: string) => {
  Object.defineProperty(target, 'name', {
    value: name,
  });

  return target;
};

export class PaginatedDto<TData> {
  @ApiProperty()
  total: number;

  @ApiProperty({
    type: Array,
  })
  list: TData[];
}

export class ApiResponseDto<TData> {
  @ApiProperty({
    example: 200,
  })
  code: number;

  @ApiProperty({
    example: '操作成功',
  })
  msg: string;

  @ApiProperty()
  data: TData;
}

const getResponseExample = (example: any) => ({
  code: 200,
  msg: '操作成功',
  data: example,
});

export const ApiSuccessResponse = ({
  description = '操作成功',
  schema,
  example,
}: ApiResponseOptions) => {
  const primitiveType = primitiveTypeMap[schema?.type] || Object;

  class ApiSuccessResponseDto extends ApiResponseDto<any> {
    @ApiProperty({
      type: primitiveType,
      description: schema?.description,
    })
    declare data: any;
  }

  setClassName(ApiSuccessResponseDto, `ApiResponseOf${primitiveType.name}`);

  return applyDecorators(
    ApiExtraModels(ApiSuccessResponseDto),
    ApiOkResponse({
      description,
      type: ApiSuccessResponseDto,
      example: getResponseExample(example),
    }),
  );
};

export const ApiModelResponse = <TModel extends Type<any>>(
  model: TModel,
  example: any,
  description?: string,
) => {
  class ApiModelResponseDto extends ApiResponseDto<TModel> {
    @ApiProperty({
      type: model,
    })
    declare data: TModel;
  }

  setClassName(ApiModelResponseDto, `ApiResponseOf${model.name}`);

  return applyDecorators(
    ApiExtraModels(ApiModelResponseDto, model),
    ApiOkResponse({
      description: description || '操作成功',
      type: ApiModelResponseDto,
      example: getResponseExample(example),
    }),
  );
};

export const ApiArrayResponse = <TModel extends Type<any>>(
  model: TModel,
  example: any[],
  description?: string,
) => {
  class ApiArrayResponseDto extends ApiResponseDto<TModel[]> {
    @ApiProperty({
      type: [model],
    })
    declare data: TModel[];
  }

  setClassName(ApiArrayResponseDto, `ApiResponseOf${model.name}Array`);

  return applyDecorators(
    ApiExtraModels(ApiArrayResponseDto, model),
    ApiOkResponse({
      description: description || '操作成功',
      type: ApiArrayResponseDto,
      example: getResponseExample(example),
    }),
  );
};

export const ApiPageResponse = <TModel extends Type<any>>(
  model: TModel,
  example: any[],
  total = 1,
  description?: string,
) => {
  class PageResponseDto extends PaginatedDto<TModel> {
    @ApiProperty({
      type: [model],
    })
    declare list: TModel[];
  }

  class ApiPageResponseDto extends ApiResponseDto<PageResponseDto> {
    @ApiProperty({
      type: PageResponseDto,
    })
    declare data: PageResponseDto;
  }

  setClassName(PageResponseDto, `PaginatedResponseOf${model.name}`);
  setClassName(ApiPageResponseDto, `ApiResponseOfPaginated${model.name}`);

  return applyDecorators(
    ApiExtraModels(ApiPageResponseDto, PageResponseDto, PaginatedDto, model),
    ApiOkResponse({
      description: description || '操作成功',
      type: ApiPageResponseDto,
      example: getResponseExample({
        list: example,
        total,
      }),
    }),
  );
};

export const ApiFileDownloadResponse = (description = '文件下载成功') =>
  applyDecorators(
    ApiOkResponse({
      description,
      content: {
        'application/octet-stream': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    }),
  );

const operationMethods = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'options',
  'head',
];

const standardErrorSchema = {
  type: 'object',
  required: ['code', 'msg', 'err'],
  properties: {
    code: {
      type: 'integer',
      description: '错误状态码',
      example: 400,
    },
    msg: {
      type: 'string',
      description: '错误提示',
      example: '操作失败',
    },
    err: {
      type: 'string',
      description: '错误详情',
      example: 'Bad Request',
    },
  },
};

export const applySwaggerResponseExamples = (document: OpenAPIObject) => {
  const components = ensureDocumentComponents(document);
  components.schemas.KtApiErrorResponse ||= standardErrorSchema;

  Object.entries(document.paths).forEach(([path, pathItem]) => {
    Object.entries(pathItem || {}).forEach(([method, operation]) => {
      if (!operationMethods.includes(method)) return;
      applyOperationResponseExamples(document, path, method, operation as any);
    });
  });

  return document;
};

function applyOperationResponseExamples(
  document: OpenAPIObject,
  path: string,
  method: string,
  operation: SwaggerOperation,
) {
  operation.responses ||= {};

  if (path === '/') {
    operation.responses['301'] = {
      description: '重定向到 Swagger 文档',
    };
    return;
  }

  if (isBinaryResponsePath(path)) {
    if (!operation.responses['200']?.content) {
      operation.responses['200'] = {
        description: '文件流响应',
        content: {
          'application/octet-stream': {
            schema: {
              type: 'string',
              format: 'binary',
            },
          },
        },
      };
    }
    applyErrorResponses(operation);
    return;
  }

  if (isRuntimeHealthPath(path)) {
    const plainResponse = buildPlainJsonResponse(
      runtimeHealthExample(),
      'API 运行时健康检查',
    );
    operation.responses['200'] = mergeJsonResponse(
      operation.responses['200'],
      plainResponse,
    );
    applyErrorResponses(operation);
    return;
  }

  const dataExample = getOperationDataExample(path, method, operation);
  const successSchema = createOperationSuccessSchema(
    document,
    path,
    method,
    dataExample,
  );
  const successResponse = buildSuccessResponse(dataExample, successSchema);
  const currentResponse = operation.responses['200'];

  operation.responses['200'] = mergeJsonResponse(
    currentResponse,
    successResponse,
  );
  applyErrorResponses(operation);
}

function applyErrorResponses(operation: SwaggerOperation) {
  operation.responses['400'] ||= buildErrorResponse(
    400,
    'Bad Request',
    '请求参数不合法',
  );
  operation.responses['401'] ||= buildErrorResponse(
    401,
    'Unauthorized',
    '未登录或登录已过期',
  );
  operation.responses['500'] ||= buildErrorResponse(
    500,
    'Internal Server Error',
    '服务内部错误',
  );
}

function buildSuccessResponse(dataExample: any, schema: SwaggerSchema) {
  const example = getResponseExample(dataExample);

  return {
    description: '操作成功',
    content: {
      'application/json': {
        schema,
        example,
        examples: {
          success: {
            summary: '成功响应',
            value: example,
          },
        },
      },
    },
  };
}

function buildPlainJsonResponse(example: any, description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaFromExample(example),
        example,
        examples: {
          success: {
            summary: '成功响应',
            value: example,
          },
        },
      },
    },
  };
}

function buildErrorResponse(status: number, summary: string, message: string) {
  return {
    description: message,
    content: {
      'application/json': {
        schema: {
          $ref: '#/components/schemas/KtApiErrorResponse',
        },
        example: {
          code: status,
          msg: message,
          err: summary,
        },
        examples: {
          error: {
            summary,
            value: {
              code: status,
              msg: message,
              err: summary,
            },
          },
        },
      },
    },
  };
}

function createOperationSuccessSchema(
  document: OpenAPIObject,
  path: string,
  method: string,
  dataExample: any,
) {
  const components = ensureDocumentComponents(document);
  const componentName = `${toPascalCase(method)}${toPascalCase(path)}Response`;
  const dataSchemaName = `${componentName}Data`;
  const dataSchema = schemaFromExample(
    dataExample,
    'data',
    components,
    dataSchemaName,
  );
  components.schemas[dataSchemaName] = dataSchema;
  const schema = buildSuccessSchema(dataExample, dataSchemaName);
  components.schemas[componentName] = schema;

  return {
    $ref: `#/components/schemas/${componentName}`,
  };
}

function buildSuccessSchema(
  dataExample: any,
  dataSchemaName: string,
): SwaggerSchema {
  const example = getResponseExample(dataExample);

  return {
    type: 'object',
    required: ['code', 'msg', 'data'],
    description: '统一成功响应结构',
    example,
    properties: {
      code: {
        type: 'integer',
        description: '成功状态码，固定为 200',
        example: 200,
      },
      msg: {
        type: 'string',
        description: '成功提示',
        example: '操作成功',
      },
      data: {
        allOf: [
          {
            $ref: `#/components/schemas/${dataSchemaName}`,
          },
        ],
        description: '业务数据；成功响应不会返回 err 字段',
        example: dataExample,
      },
    },
  };
}

function mergeJsonResponse(currentResponse: any, standardResponse: any) {
  if (!currentResponse?.content?.['application/json']) {
    return {
      ...standardResponse,
      description: currentResponse?.description || standardResponse.description,
    };
  }

  const jsonContent = currentResponse.content['application/json'];

  return {
    ...currentResponse,
    description: currentResponse.description || standardResponse.description,
    content: {
      ...currentResponse.content,
      'application/json': {
        ...jsonContent,
        schema: standardResponse.content['application/json'].schema,
        example:
          jsonContent.example ||
          standardResponse.content['application/json'].example,
        examples: {
          ...standardResponse.content['application/json'].examples,
          ...jsonContent.examples,
        },
      },
    },
  };
}

function schemaFromExample(
  example: any,
  propertyName = 'data',
  components?: SwaggerComponents,
  schemaName?: string,
): SwaggerSchema {
  if (Array.isArray(example)) {
    const itemSchemaName = schemaName
      ? `${schemaName}${toPascalCase(getArrayItemName(propertyName))}`
      : undefined;
    const itemSchema =
      example.length > 0
        ? schemaFromExample(
            example[0],
            getArrayItemName(propertyName),
            components,
            itemSchemaName,
          )
        : { type: 'object' };

    if (components && itemSchemaName && itemSchema.type === 'object') {
      components.schemas[itemSchemaName] = itemSchema;
    }

    return {
      type: 'array',
      description: getPropertyDescription(propertyName),
      example,
      items:
        components && itemSchemaName && itemSchema.type === 'object'
          ? {
              $ref: `#/components/schemas/${itemSchemaName}`,
            }
          : itemSchema,
    };
  }

  if (example === null) {
    return {
      nullable: true,
      description: getPropertyDescription(propertyName),
      example: null,
    };
  }

  if (typeof example === 'boolean') {
    return {
      type: 'boolean',
      description: getPropertyDescription(propertyName),
      example,
    };
  }
  if (typeof example === 'number') {
    return {
      type: Number.isInteger(example) ? 'integer' : 'number',
      description: getPropertyDescription(propertyName),
      example,
    };
  }
  if (typeof example === 'string') {
    return {
      type: 'string',
      description: getPropertyDescription(propertyName),
      example,
    };
  }

  if (typeof example === 'object') {
    const properties = Object.entries(example).reduce<
      Record<string, SwaggerSchema>
    >((acc, [key, value]) => {
      acc[key] = schemaFromExample(
        value,
        key,
        components,
        schemaName ? `${schemaName}${toPascalCase(key)}` : undefined,
      );
      return acc;
    }, {});

    return {
      type: 'object',
      description: getPropertyDescription(propertyName),
      required: Object.keys(properties),
      example,
      properties,
    };
  }

  return {
    type: 'object',
    description: getPropertyDescription(propertyName),
  };
}

function ensureDocumentComponents(document: OpenAPIObject): SwaggerComponents {
  document.components ||= {};
  document.components.schemas ||= {};

  return document.components;
}

function toPascalCase(value: string) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((item) => `${item.charAt(0).toUpperCase()}${item.slice(1)}`)
    .join('');
}

function getArrayItemName(propertyName: string) {
  if (propertyName === 'items') return 'item';
  if (propertyName.endsWith('s')) return propertyName.slice(0, -1);

  return `${propertyName}Item`;
}

function getPropertyDescription(propertyName: string) {
  const descriptionMap: Record<string, string> = {
    ['access' + 'Token']: 'Admin 访问令牌',
    accountCount: '账号总数',
    available: '是否可用',
    bucketName: 'Bucket 名称',
    categories: 'WordPress 分类 ID 列表',
    code: '响应状态码',
    command: '命令触发词',
    commandId: '在线命令 ID',
    connectStatus: 'OneBot 反向 WS 连接状态',
    connectionMode: '连接模式',
    connectionRole: 'OneBot 连接角色',
    containerName: 'NapCat 容器名称',
    containerStatus: 'NapCat 容器运行状态',
    count: '数量',
    data: '业务数据',
    description: '描述',
    enabled: '是否启用',
    err: '错误详情',
    etag: '对象 ETag',
    expireAt: '过期时间',
    id: '唯一 ID',
    image: '图片地址',
    items: '列表数据',
    key: '唯一键',
    keyword: '匹配关键词',
    lastConnectedAt: '最后连接时间',
    lastError: '最近异常',
    lastHeartbeatAt: 'OneBot/容器最后心跳时间',
    lastLoginAt: '最近扫码登录时间',
    lastMessage: '最后一条消息',
    lastModified: '最后修改时间',
    matchType: '匹配方式',
    message: '消息内容',
    mimeType: '文件 MIME 类型',
    mode: '过滤模式',
    msg: '响应消息',
    name: '名称',
    napcat: 'NapCat 容器运行信息',
    nickname: '昵称',
    objectName: '对象名称',
    onlineAccountCount: '在线账号数',
    path: '路由路径',
    pluginKey: '插件能力 Key',
    preciseUser: '是否精确到 QQ 号',
    qrcode: '二维码内容',
    realName: '真实姓名',
    ['refresh' + 'Token']: '刷新令牌',
    reply: '回复内容',
    replyContent: '回复内容',
    roles: '角色列表',
    selfId: '机器人 QQ 号',
    sessionId: '扫码会话 ID',
    size: '文件大小',
    slug: 'WordPress slug',
    status: '状态',
    tags: 'WordPress 标签 ID 列表',
    targetId: '目标 ID',
    targetType: '目标类型',
    timezone: '时区',
    title: '标题',
    todayMessageCount: '今日消息数',
    todaySendCount: '今日发送数',
    total: '总条数',
    triggerMode: '触发方式',
    webuiPort: 'NapCat WebUI 端口',
    type: '类型',
    url: '访问地址',
    userId: '用户 QQ 号',
    username: '用户名',
    wordpressAuth: 'WordPress 授权信息',
    wordpressAvailable: 'WordPress 是否可用',
    wordpressError: 'WordPress 登录错误',
  };

  return descriptionMap[propertyName] || propertyName;
}

function getOperationDataExample(
  path: string,
  method: string,
  operation: SwaggerOperation,
) {
  const normalizedPath = path.toLowerCase();
  const summary = operation.summary || operation.description || '';

  if (normalizedPath.includes('/auth/login')) return adminLoginExample();
  if (normalizedPath.includes('/auth/refresh')) return '<access-token>';
  if (normalizedPath.includes('/auth/codes')) {
    return ['QqBotAccountCreateButton', 'QqBotPermissionCreateButton'];
  }
  if (normalizedPath.includes('/scan/')) return qqbotScanExample();
  if (normalizedPath.includes('/dashboard/summary')) return dashboardExample();
  if (isPageResponsePath(normalizedPath)) {
    return {
      items: [itemExampleByPath(normalizedPath)],
      total: 1,
    };
  }
  if (isArrayResponsePath(normalizedPath))
    return [itemExampleByPath(normalizedPath)];
  if (isBooleanResponsePath(normalizedPath, method, summary)) return true;
  if (normalizedPath.includes('/check')) return { available: true };
  if (normalizedPath.includes('/config')) return permissionConfigExample();
  if (normalizedPath.includes('/health')) return [pluginHealthExample()];
  if (normalizedPath.includes('/test'))
    return { matched: true, reply: '测试回复' };
  if (normalizedPath.includes('/upload')) return minioUploadExample();
  if (normalizedPath.includes('/url')) {
    return 'http://127.0.0.1:9000/kt-template-online/uploads/demo.png';
  }

  return itemExampleByPath(normalizedPath);
}

function isPageResponsePath(path: string) {
  if (path.startsWith('/wordpress/')) return false;
  return (
    path.endsWith('/list') ||
    path.endsWith('/log/list') ||
    path.includes('/allowlist') ||
    path.includes('/blocklist')
  );
}

function isArrayResponsePath(path: string) {
  return (
    (path.startsWith('/wordpress/') && path.endsWith('/list')) ||
    path.includes('/alllist') ||
    path.includes('/enabled') ||
    path.includes('/options') ||
    path.includes('/codes') ||
    path.includes('/menu/all') ||
    path.includes('/operation/list') ||
    path.includes('/event/list') ||
    path.includes('/dict/')
  );
}

function isBooleanResponsePath(path: string, method: string, summary: string) {
  return (
    method === 'delete' ||
    path.includes('/delete') ||
    path.includes('/remove') ||
    path.includes('/toggle') ||
    path.includes('/kick') ||
    path.includes('/cancel') ||
    path.includes('/bind/') ||
    path.includes('/unbind/') ||
    summary.includes('是否')
  );
}

function isBinaryResponsePath(path: string) {
  return path.includes('/download') || path.includes('/resource-proxy');
}

function isRuntimeHealthPath(path: string) {
  return path.toLowerCase() === '/health/runtime';
}

function itemExampleByPath(path: string) {
  if (path.includes('/qqbot/account')) return qqbotAccountExample();
  if (path.includes('/qqbot/command')) return qqbotCommandExample();
  if (path.includes('/qqbot/rule')) return qqbotRuleExample();
  if (path.includes('/qqbot/message')) return qqbotMessageExample();
  if (path.includes('/qqbot/conversation')) return qqbotConversationExample();
  if (path.includes('/qqbot/permission')) return qqbotPermissionExample();
  if (path.includes('/qqbot/plugin')) return qqbotPluginExample();
  if (path.includes('/qqbot/send')) return qqbotSendLogExample();
  if (path.includes('/wordpress/article')) return wordpressArticleExample();
  if (path.includes('/wordpress/category'))
    return wordpressTaxonomyExample('NAS');
  if (path.includes('/wordpress/tag'))
    return wordpressTaxonomyExample('Docker');
  if (path.includes('/system/menu') || path.includes('/menu/'))
    return adminMenuExample();
  if (path.includes('/system/dept')) return adminDeptExample();
  if (path.includes('/system/role')) return adminRoleExample();
  if (path.includes('/dict')) return adminDictExample();
  if (path.includes('/component')) return componentExample();
  if (path.includes('/user')) return adminUserExample();
  if (path.includes('/timezone')) return { timezone: 'Asia/Shanghai' };
  if (path.includes('/minio')) return minioObjectExample();

  return {
    id: '1000000000000000001',
    name: 'KT 示例数据',
    status: 1,
  };
}

function adminLoginExample() {
  return {
    id: '1000000000000000001',
    username: 'admin',
    realName: '管理员',
    roles: ['SuperAdmin'],
    ['access' + 'Token']: '<access-token>',
    wordpressAuth: null,
    wordpressAvailable: true,
    wordpressError: null,
  };
}

function adminDictExample() {
  return {
    id: '2041700000000300001',
    dictCode: 'COMPONENT_TYPE',
    label: '图表',
    value: '1',
    childrenCode: 'CHART',
    sort: 1,
    status: 1,
    createTime: '2026-06-03 20:00:00',
    updateTime: '2026-06-03 20:00:00',
  };
}

function adminUserExample() {
  return {
    id: '1000000000000000001',
    username: 'admin',
    realName: '管理员',
    avatar: '/api/minio/download?objectName=avatars/admin/avatar.jpg',
    status: 1,
  };
}

function adminMenuExample() {
  return {
    id: '1000000000000000001',
    name: 'QqBot',
    path: '/qqbot',
    component: 'LAYOUT',
    meta: {
      title: 'QQBot',
      icon: 'lucide:bot',
    },
    children: [],
  };
}

function adminDeptExample() {
  return {
    id: '1000000000000000001',
    name: 'KT 项目组',
    parentId: '0',
    status: 1,
  };
}

function adminRoleExample() {
  return {
    id: '1000000000000000001',
    roleName: '超级管理员',
    roleCode: 'SuperAdmin',
    status: 1,
  };
}

function componentExample() {
  return {
    id: '1000000000000000001',
    name: 'KT 表格组件',
    type: 'table',
    image: 'http://127.0.0.1:9000/kt-template-online/components/table.png',
  };
}

function qqbotAccountExample() {
  return {
    connectStatus: 'online',
    connectionMode: 'reverse-ws',
    enabled: true,
    id: '1000000000000000001',
    lastHeartbeatAt: '2026-06-02 20:00:00',
    name: '主账号',
    napcat: {
      bindStatus: 'bound',
      containerName: 'kt-qqbot-napcat-1914728559',
      containerOnline: true,
      containerStatus: 'running',
      lastLoginAt: '2026-06-02 19:55:00',
      oneBotOnline: true,
      qqLoginMessage: 'QQ 已登录',
      qqLoginStatus: 'online',
      webuiOnline: true,
      webuiPort: 6100,
    },
    selfId: '1914728559',
  };
}

function qqbotCommandExample() {
  return {
    id: '1000000000000000001',
    name: 'FFLogs 查询',
    command: '/fflogs 角色名 服务器',
    pluginKey: 'fflogs',
    enabled: true,
  };
}

function qqbotRuleExample() {
  return {
    id: '1000000000000000001',
    name: '关键词回复',
    matchType: 'keyword',
    keyword: 'test',
    replyContent: '测试',
    enabled: true,
  };
}

function qqbotConversationExample() {
  return {
    id: '1000000000000000001',
    selfId: '1914728559',
    targetType: 'private',
    targetId: '2354598417',
    lastMessage: 'test',
  };
}

function qqbotMessageExample() {
  return {
    id: '1000000000000000001',
    selfId: '1914728559',
    messageType: 'private',
    direction: 'receive',
    userId: '2354598417',
    message: 'test',
  };
}

function qqbotPermissionExample() {
  return {
    id: '1000000000000000001',
    selfId: '1914728559',
    targetType: 'qq',
    targetId: '2354598417',
    userId: '',
    preciseUser: false,
    enabled: true,
  };
}

function qqbotPluginExample() {
  return {
    key: 'fflogs',
    name: 'FFLogs 查询',
    triggerMode: 'command',
    description: '查询 FFLogs 角色公开排名',
  };
}

function qqbotSendLogExample() {
  return {
    id: '1000000000000000001',
    selfId: '1914728559',
    targetType: 'private',
    targetId: '2354598417',
    message: '测试',
    status: 'success',
  };
}

function qqbotScanExample() {
  return {
    sessionId: 'KT_SCAN_20260602120000',
    qrcode: 'data:image/png;base64,MOCK_QRCODE',
    status: 'waiting',
    expireAt: '2026-06-02 20:05:00',
  };
}

function dashboardExample() {
  return {
    accountCount: 1,
    onlineAccountCount: 1,
    todayMessageCount: 10,
    todaySendCount: 3,
  };
}

function permissionConfigExample() {
  return {
    mode: 'blocklist',
    enabled: true,
  };
}

function pluginHealthExample() {
  return {
    key: 'fflogs',
    name: 'FFLogs 查询',
    available: true,
    message: '插件可用',
  };
}

function runtimeHealthExample() {
  return {
    service: 'kt-template-online-api',
    checkedAt: '2026-06-13T00:00:00.000Z',
    status: 'degraded',
    checks: [
      {
        name: 'process',
        status: 'live',
        critical: true,
        message: 'NestJS process is responding',
      },
      {
        name: 'config:QQBOT_NAPCAT_IMAGE',
        status: 'degraded',
        critical: false,
        message: 'QQBOT_NAPCAT_IMAGE is not configured',
      },
    ],
  };
}

function wordpressArticleExample() {
  return {
    id: 1,
    title: '飞牛 NAS Docker、Jenkins 与 k3d/K8s 一体化技术方案',
    status: 'publish',
    categories: [1],
    tags: [1],
  };
}

function wordpressTaxonomyExample(name: string) {
  return {
    id: 1,
    name,
    slug: name.toLowerCase(),
    count: 1,
  };
}

function minioObjectExample() {
  return {
    name: 'uploads/demo.png',
    size: 2048,
    etag: '9b2cf535f27731c974343645a3985328',
    lastModified: '2026-06-02 20:00:00',
  };
}

function minioUploadExample() {
  return {
    bucketName: 'kt-template-online',
    objectName: 'uploads/demo.png',
    etag: '9b2cf535f27731c974343645a3985328',
    size: 2048,
    mimeType: 'image/png',
    url: 'http://127.0.0.1:9000/kt-template-online/uploads/demo.png',
  };
}
