import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty } from '@nestjs/swagger';

type SwaggerSchema = Record<string, any>;

type ApiResponseOptions = {
  description?: string;
  schema?: SwaggerSchema;
  example: any;
};

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
