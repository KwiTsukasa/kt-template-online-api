import type { Readable } from 'stream';

export type MinioUploadFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export type MinioUploadObjectOptions = {
  bucketName?: string;
  file: MinioUploadFile;
  objectName?: string;
};

export type MinioListObjectOptions = {
  bucketName?: string;
  prefix?: string;
  recursive?: boolean;
};

export type MinioObjectResult = {
  bucketName: string;
  objectName: string;
  stat: {
    etag: string;
    lastModified: Date;
    metaData: Record<string, any>;
    size: number;
    versionId?: string | null;
  };
  stream: Readable;
};
