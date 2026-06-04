import type { OpenAPIObject } from '@nestjs/swagger';

export type ApiResponseOptions = {
  description?: string;
  schema?: SwaggerSchema;
  example: any;
};

export type SwaggerComponents = NonNullable<OpenAPIObject['components']>;

export type SwaggerDocumentGroup = {
  matcher: SwaggerPathMatcher;
  name: string;
  path: string;
};

export type SwaggerOperation = Record<string, any>;

export type SwaggerPathMatcher = (path: string) => boolean;

export type SwaggerSchema = Record<string, any>;
