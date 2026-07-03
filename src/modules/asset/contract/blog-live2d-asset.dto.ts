import { ApiProperty } from '@nestjs/swagger';

export class BlogLive2DManifestDto {
  @ApiProperty({ example: 'pio' })
  character: string;

  @ApiProperty({ example: 'v1' })
  version: string;

  @ApiProperty({ example: true })
  desktopOnly: boolean;

  @ApiProperty({
    example: '/api/blog/live2d/pio/v1/pio.model3.json',
  })
  model3: string;
}

