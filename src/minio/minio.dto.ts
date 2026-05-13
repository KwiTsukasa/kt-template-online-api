import { ApiProperty } from '@nestjs/swagger';

export class MinioBucketStatusDto {
  @ApiProperty({
    example: 'kt-template-online',
  })
  bucketName: string;

  @ApiProperty({
    example: true,
  })
  exists: boolean;
}

export class MinioUploadResultDto {
  @ApiProperty({
    example: 'kt-template-online',
  })
  bucketName: string;

  @ApiProperty({
    example: 'uploads/1715580000000-a1b2c3-demo.png',
  })
  objectName: string;

  @ApiProperty({
    example: '9b2cf535f27731c974343645a3985328',
  })
  etag: string;

  @ApiProperty({
    example: 2048,
  })
  size: number;

  @ApiProperty({
    example: 'image/png',
  })
  mimeType: string;

  @ApiProperty({
    example: 'http://127.0.0.1:9000/kt-template-online/uploads/demo.png',
  })
  url: string;
}

export class MinioObjectDto {
  @ApiProperty({
    example: 'uploads/demo.png',
  })
  name: string;

  @ApiProperty({
    example: 2048,
  })
  size: number;

  @ApiProperty({
    example: '9b2cf535f27731c974343645a3985328',
  })
  etag: string;

  @ApiProperty({
    example: '2026-05-13T02:30:00.000Z',
  })
  lastModified: string;
}
