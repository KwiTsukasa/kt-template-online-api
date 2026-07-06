import type { MinioObjectResult } from './asset-minio.types';

export type BlogLive2DRuntimeAssetPath = string | string[];

export type BlogLive2DAssetRequest = {
  family: string;
  objectPath: BlogLive2DRuntimeAssetPath;
  origin?: string;
  referer?: string;
};

export type BlogLive2DAssetResult = MinioObjectResult;

