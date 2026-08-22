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

/**
 * 通过 `isBinaryResponsePath` 判断输入是否满足函数约束。
 * @param document - 决定操作响应Examples内容、边界或目标的 `document` 值。
 * @param path - 必须保持在受控根目录内的路径。
 * @param method - 决定操作响应Examples内容、边界或目标的 `method` 值。
 * @param operation - 在当前锁、事务或错误边界内执行的受控回调。
 */
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

/**
 * 根据`operation`更新错误响应定义。
 * @param operation - 在当前锁、事务或错误边界内执行的受控回调。
 */
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

/**
 * 根据`dataExample`、`schema`构造Success响应；从 `getResponseExample` 读取Success响应。
 * @param dataExample - 决定Success响应内容、边界或目标的 `dataExample` 值。
 * @param schema - 决定Success响应内容、边界或目标的 `schema` 值。
 * @returns 包含 `description`、`content` 字段的Success响应。
 */
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

/**
 * 根据`example`、`description`构造包含 `description`、`content` 字段的结果。
 * @param example - 决定包含 `description`、`content` 字段的结果内容、边界或目标的 `example` 值。
 * @param description - 决定包含 `description`、`content` 字段的结果内容、边界或目标的 `description` 值。
 * @returns 包含 `description`、`content` 字段的包含 `description`、`content` 字段的。
 */
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

/**
 * 根据`status`、`summary`、`message`构造包含 `description`、`content` 字段的结果。
 * @param status - 决定包含 `description`、`content` 字段的结果内容、边界或目标的 `status` 值。
 * @param summary - 决定包含 `description`、`content` 字段的结果内容、边界或目标的 `summary` 值。
 * @param message - 包含正文、发送目标与账号身份的待处理消息。
 * @returns 包含 `description`、`content` 字段的包含 `description`、`content` 字段的。
 */
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

/**
 * 通过 `ensureDocumentComponents` 强制满足前置条件。
 * @param document - 决定操作SuccessHTML 清理规则内容、边界或目标的 `document` 值。
 * @param path - 必须保持在受控根目录内的路径。
 * @param method - 决定操作SuccessHTML 清理规则内容、边界或目标的 `method` 值。
 * @param dataExample - 决定操作SuccessHTML 清理规则内容、边界或目标的 `dataExample` 值。
 * @returns 包含 `$ref` 字段的操作SuccessHTML 清理规则。
 */
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

/**
 * 根据`dataExample`、`dataSchemaName`构造SuccessHTML 清理规则；从 `getResponseExample` 读取SuccessHTML 清理规则。
 * @param dataExample - 决定SuccessHTML 清理规则内容、边界或目标的 `dataExample` 值。
 * @param dataSchemaName - 决定SuccessHTML 清理规则内容、边界或目标的 `dataSchemaName` 值。
 * @returns 包含 `type`、`required`、`description`、`example`、`properties` 字段的SuccessHTML 清理规则。
 */
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

/**
 * 根据`currentResponse`、`standardResponse`更新包含 `description`、`content` 字段的结果；当 `!currentResponse?.content?.['application/json']` 成立时返回 `{ ...standardResponse, description: current…`。
 * @param currentResponse - 用于包含 `description`、`content` 字段的结果的领域对象，包含 `content`、`description` 字段。
 * @param standardResponse - 用于包含 `description`、`content` 字段的结果的领域对象，包含 `description`、`content` 字段。
 * @returns 包含 `description`、`content` 字段的包含 `description`、`content` 字段的。
 */
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

/**
 * 根据`example`、`propertyName`、`components`处理HTML 清理规则示例；当 `Array.isArray(example)` 成立时返回 `{ type: 'array', description: getPropertyDe…`。
 * @param example - 用于HTML 清理规则示例的领域对象，包含 `length`、`0` 字段。
 * @param propertyName - 决定HTML 清理规则示例内容、边界或目标的 `propertyName` 值；省略时默认采用 `'data'`。
 * @param components - 用于HTML 清理规则示例的领域对象，包含 `schemas` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param schemaName - 决定HTML 清理规则示例内容、边界或目标的 `schemaName` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `type`、`description` 字段的HTML 清理规则示例；无法解析或未命中时为 `null`。
 */
function schemaFromExample(
  example: any,
  propertyName = 'data',
  components?: SwaggerComponents,
  schemaName?: string,
): SwaggerSchema {
  if (Array.isArray(example)) {
    const itemSchemaName = (() => {
      if (schemaName) {
        return `${schemaName}${toPascalCase(getArrayItemName(propertyName))}`;
      }
      return undefined;
    })();
    const itemSchema = (() => {
      if (example.length > 0) {
        return schemaFromExample(
          example[0],
          getArrayItemName(propertyName),
          components,
          itemSchemaName,
        );
      }
      return { type: 'object' };
    })();

    if (components && itemSchemaName && itemSchema.type === 'object') {
      components.schemas[itemSchemaName] = itemSchema;
    }

    return {
      type: 'array',
      description: getPropertyDescription(propertyName),
      example,
      items: (() => {
        if (components && itemSchemaName && itemSchema.type === 'object') {
          return {
            $ref: `#/components/schemas/${itemSchemaName}`,
          };
        }
        return itemSchema;
      })(),
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
      type: (() => {
        if (Number.isInteger(example)) {
          return 'integer';
        }
        return 'number';
      })(),
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
        (() => {
          if (schemaName) {
            return `${schemaName}${toPascalCase(key)}`;
          }
          return undefined;
        })(),
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

/**
 * 确保Document组件定义存在且保持一致；缺失时根据`document`补齐对应状态。
 * @param document - 用于Document组件定义的领域对象，包含 `components` 字段。
 * @returns Document组件定义。
 */
function ensureDocumentComponents(document: OpenAPIObject): SwaggerComponents {
  document.components ||= {};
  document.components.schemas ||= {};

  return document.components;
}

/**
 * 将非字母数字分隔的各文本段首字母大写后连接为 PascalCase 名称。
 * @param value - 可能含空格、连字符或其他分隔符的原始名称。
 * @returns 仅由有效文本段组成的 PascalCase 名称；没有有效片段时为空字符串。
 */
function toPascalCase(value: string) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((item) => `${item.charAt(0).toUpperCase()}${item.slice(1)}`)
    .join('');
}

/**
 * 通过 `propertyName.endsWith` 判断输入是否满足函数约束。
 * @param propertyName - 决定数组内容条目名称内容、边界或目标的 `propertyName` 值。
 * @returns 当前状态对应的数组内容条目名称，取值为 `'item'`。
 */
function getArrayItemName(propertyName: string) {
  if (propertyName === 'items') return 'item';
  if (propertyName.endsWith('s')) return propertyName.slice(0, -1);

  return `${propertyName}Item`;
}

/**
 * 按`propertyName`读取属性说明文本。
 * @param propertyName - 决定属性说明文本内容、边界或目标的 `propertyName` 值。
 * @returns 规范化后的属性说明文本；主值为空时采用 `propertyName` 兜底。
 */
function getPropertyDescription(propertyName: string) {
  const descriptionMap: Record<string, string> = {
    ['access' + 'Token']: 'Admin 访问令牌',
    accountCount: '账号总数',
    available: '是否可用',
    bucketName: 'Bucket 名称',
    categories: '文章分类列表',
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
    slug: '资源 slug',
    status: '状态',
    tags: '文章标签列表',
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
  };

  return descriptionMap[propertyName] || propertyName;
}

/**
 * 按路径、方法和 OpenAPI 操作读取示例；权限码接口返回当前 Bot 操作码。
 * @param path - 必须保持在受控根目录内的路径。
 * @param method - 决定操作数据示例内容、边界或目标的 `method` 值。
 * @param operation - 在当前锁、事务或错误边界内执行的受控回调。
 * @returns 满足操作数据示例约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
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
    return ['BotAccountCreateButton', 'BotPermissionCreateButton'];
  }
  if (normalizedPath.includes('/scan/')) return botScanExample();
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

/**
 * 通过 `path.endsWith` 判断输入是否满足函数约束。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 满足分页结果响应路径约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isPageResponsePath(path: string) {
  return (
    path.endsWith('/list') ||
    path.endsWith('/log/list') ||
    path.includes('/allowlist') ||
    path.includes('/blocklist')
  );
}

/**
 * 根据路径中的全量列表、可用项、选项或字典标记，判断 OpenAPI 响应是否应使用数组结构。
 * @param path - `path` 通过 `includes` 筛选或判定其中的内容。
 * @returns 返回 `path.includes('/alllist') || path.includes('/enabled') || path.includes…` 的判定结果；条件成立为 `true`，否则为 `false`。
 */
function isArrayResponsePath(path: string) {
  return (
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

/**
 * 根据`path`、`method`、`summary`与当前约束判定布尔值响应路径。
 * @param path - 必须保持在受控根目录内的路径。
 * @param method - 决定布尔值响应路径内容、边界或目标的 `method` 值。
 * @param summary - 决定布尔值响应路径内容、边界或目标的 `summary` 值。
 * @returns 满足布尔值响应路径约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
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

/**
 * 仅将下载与资源代理路径识别为 OpenAPI 二进制响应。
 * @param path - `path` 通过 `includes` 筛选或判定其中的内容。
 * @returns 返回 `path.includes('/download') || path.includes('/resource-proxy')` 的判定结果；条件成立为 `true`，否则为 `false`。
 */
function isBinaryResponsePath(path: string) {
  return path.includes('/download') || path.includes('/resource-proxy');
}

/**
 * 根据`path`与当前约束判定运行态健康状态路径。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 满足运行态健康状态路径约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isRuntimeHealthPath(path: string) {
  return path.toLowerCase() === '/health/runtime';
}

/**
 * 根据`path`拼接稳定的条目示例路径，用于隔离对应资源或存储记录。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 包含 `id`、`name`、`status` 字段的条目示例路径。
 */
function itemExampleByPath(path: string) {
  if (path.includes('/bot-adapter/')) return botAccountExample();
  if (path.includes('/bot/command')) return botCommandExample();
  if (path.includes('/bot/rule')) return botRuleExample();
  if (path.includes('/bot/message')) return botMessageExample();
  if (path.includes('/bot/conversation')) return botConversationExample();
  if (path.includes('/bot/permission')) return botPermissionExample();
  if (path.includes('/bot/send')) return botSendLogExample();
  if (path.includes('/plugin-platform')) return pluginPlatformExample();
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

/**
 * 根据当前运行态处理adminLogin示例。
 * @returns 包含 `id`、`username`、`realName`、`roles`、`['access' + 'Token']` 字段的adminLogin示例。
 */
function adminLoginExample() {
  return {
    id: '1000000000000000001',
    username: 'admin',
    realName: '管理员',
    roles: ['SuperAdmin'],
    ['access' + 'Token']: '<access-token>',
  };
}

/**
 * 根据当前运行态处理admin字典示例。
 * @returns 包含 `id`、`dictCode`、`label`、`value`、`childrenCode` 字段的admin字典示例。
 */
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

/**
 * 根据当前运行态处理admin用户示例。
 * @returns 包含 `id`、`username`、`realName`、`avatar`、`status` 字段的admin用户示例。
 */
function adminUserExample() {
  return {
    id: '1000000000000000001',
    username: 'admin',
    realName: '管理员',
    avatar: '/api/minio/download?objectName=avatars/admin/avatar.jpg',
    status: 1,
  };
}

/**
 * 根据当前运行态处理admin菜单示例。
 * @returns 包含 `id`、`name`、`path`、`component`、`meta` 字段的admin菜单示例。
 */
function adminMenuExample() {
  return {
    id: '1000000000000000001',
    name: 'Bot',
    path: '/bot',
    component: 'LAYOUT',
    meta: {
      title: 'Bot 管理',
      icon: 'lucide:bot',
    },
    children: [],
  };
}

/**
 * 根据当前运行态处理包含 `id`、`name`、`parentId`、`status` 字段的结果。
 * @returns 包含 `id`、`name`、`parentId`、`status` 字段的admin部门示例。
 */
function adminDeptExample() {
  return {
    id: '1000000000000000001',
    name: 'KT 项目组',
    parentId: '0',
    status: 1,
  };
}

/**
 * 根据当前运行态处理admin角色示例。
 * @returns 包含 `id`、`roleName`、`roleCode`、`status` 字段的admin角色示例。
 */
function adminRoleExample() {
  return {
    id: '1000000000000000001',
    roleName: '超级管理员',
    roleCode: 'SuperAdmin',
    status: 1,
  };
}

/**
 * 根据当前运行态处理包含 `id`、`name`、`type`、`image` 字段的结果。
 * @returns 包含 `id`、`name`、`type`、`image` 字段的包含 `id`、`name`、`type`、`image` 字段的。
 */
function componentExample() {
  return {
    id: '1000000000000000001',
    name: 'KT 表格组件',
    type: 'table',
    image: 'http://127.0.0.1:9000/kt-template-online/components/table.png',
  };
}

/**
 * 根据当前运行态构造 Bot 连接账号示例。
 * @returns 包含 `connectStatus`、`connectionMode`、`enabled`、`id`、`lastHeartbeatAt` 字段的 Bot 账号示例。
 */
function botAccountExample() {
  return {
    connectStatus: 'online',
    connectionMode: 'reverse-ws',
    enabled: true,
    id: '1000000000000000001',
    lastHeartbeatAt: '2026-06-02 20:00:00',
    name: '主账号',
    napcat: {
      bindStatus: 'bound',
      containerName: 'kt-napcat-1914728559',
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

/**
 * 根据当前运行态构造 Bot 命令示例。
 * @returns 包含 `id`、`name`、`command`、`pluginKey`、`enabled` 字段的 Bot 命令示例。
 */
function botCommandExample() {
  return {
    id: '1000000000000000001',
    name: 'FFLogs 查询',
    command: '/fflogs 角色名 服务器',
    pluginKey: 'fflogs',
    enabled: true,
  };
}

/**
 * 根据当前运行态构造 Bot 自动回复规则示例。
 * @returns 包含 `id`、`name`、`matchType`、`keyword`、`replyContent` 字段的 Bot 规则示例。
 */
function botRuleExample() {
  return {
    id: '1000000000000000001',
    name: '关键词回复',
    matchType: 'keyword',
    keyword: 'test',
    replyContent: '测试',
    enabled: true,
  };
}

/**
 * 根据当前运行态构造 Bot 会话示例。
 * @returns 包含 `id`、`selfId`、`targetType`、`targetId`、`lastMessage` 字段的 Bot 会话示例。
 */
function botConversationExample() {
  return {
    id: '1000000000000000001',
    selfId: '1914728559',
    targetType: 'private',
    targetId: '2354598417',
    lastMessage: 'test',
  };
}

/**
 * 根据当前运行态构造 Bot 消息示例。
 * @returns 包含 `id`、`selfId`、`messageType`、`direction`、`userId` 字段的 Bot 消息示例。
 */
function botMessageExample() {
  return {
    id: '1000000000000000001',
    selfId: '1914728559',
    messageType: 'private',
    direction: 'receive',
    userId: '2354598417',
    message: 'test',
  };
}

/**
 * 根据当前运行态构造 Bot 权限名单示例。
 * @returns 包含 `id`、`selfId`、`targetType`、`targetId`、`userId` 字段的 Bot 权限示例。
 */
function botPermissionExample() {
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

/**
 * 根据当前运行态构造平台无关插件示例。
 * @returns 包含 `key`、`name`、`triggerMode`、`description` 字段的插件平台示例。
 */
function pluginPlatformExample() {
  return {
    key: 'fflogs',
    name: 'FFLogs 查询',
    triggerMode: 'command',
    description: '查询 FFLogs 角色公开排名',
  };
}

/**
 * 根据当前运行态构造 Bot 发送日志示例。
 * @returns 包含 `id`、`selfId`、`targetType`、`targetId`、`message` 字段的 Bot 日志示例。
 */
function botSendLogExample() {
  return {
    id: '1000000000000000001',
    selfId: '1914728559',
    targetType: 'private',
    targetId: '2354598417',
    message: '测试',
    status: 'success',
  };
}

/**
 * 根据当前运行态构造 NapCat 扫码会话示例。
 * @returns 包含 `sessionId`、`qrcode`、`status`、`expireAt` 字段的扫码会话示例。
 */
function botScanExample() {
  return {
    sessionId: 'KT_SCAN_20260602120000',
    qrcode: 'data:image/png;base64,MOCK_QRCODE',
    status: 'waiting',
    expireAt: '2026-06-02 20:05:00',
  };
}

/**
 * 根据当前运行态处理dashboard示例。
 * @returns 包含 `accountCount`、`onlineAccountCount`、`todayMessageCount`、`todaySendCount` 字段的dashboard示例。
 */
function dashboardExample() {
  return {
    accountCount: 1,
    onlineAccountCount: 1,
    todayMessageCount: 10,
    todaySendCount: 3,
  };
}

/**
 * 根据当前运行态处理包含 `mode`、`enabled` 字段的结果。
 * @returns 包含 `mode`、`enabled` 字段的包含 `mode`、`enabled` 字段的。
 */
function permissionConfigExample() {
  return {
    mode: 'blocklist',
    enabled: true,
  };
}

/**
 * 根据当前运行态处理插件健康状态示例。
 * @returns 包含 `key`、`name`、`available`、`message` 字段的插件健康状态示例。
 */
function pluginHealthExample() {
  return {
    key: 'fflogs',
    name: 'FFLogs 查询',
    available: true,
    message: '插件可用',
  };
}

/**
 * 根据当前运行态处理运行态健康状态示例。
 * @returns 包含 `service`、`checkedAt`、`status`、`checks` 字段的运行态健康状态示例。
 */
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
        name: 'config:NAPCAT_IMAGE',
        status: 'degraded',
        critical: false,
        message: 'NAPCAT_IMAGE is not configured',
      },
    ],
  };
}

/**
 * 根据当前运行态处理minio对象示例。
 * @returns 包含 `name`、`size`、`etag`、`lastModified` 字段的minio对象示例。
 */
function minioObjectExample() {
  return {
    name: 'uploads/demo.png',
    size: 2048,
    etag: '9b2cf535f27731c974343645a3985328',
    lastModified: '2026-06-02 20:00:00',
  };
}

/**
 * 根据当前运行态处理minioUpload示例。
 * @returns 包含 `bucketName`、`objectName`、`etag`、`size`、`mimeType` 字段的minioUpload示例。
 */
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
