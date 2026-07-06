import type { MinioObjectResult } from './asset-minio.types';

export type BlogLive2DRuntimeAssetPath = string | string[];
export type BlogLive2DCharacter = 'pio' | 'tia';

export type BlogLive2DAssetRequest = {
  character: BlogLive2DCharacter;
  family: string;
  objectPath: BlogLive2DRuntimeAssetPath;
  origin?: string;
  referer?: string;
};

export type BlogLive2DAssetResult = MinioObjectResult;

