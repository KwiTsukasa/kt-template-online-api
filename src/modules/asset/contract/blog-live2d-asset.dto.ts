import { ApiProperty } from '@nestjs/swagger';

export class BlogLive2DManifestDto {
  @ApiProperty({ example: 'pio' })
  character: string;

  @ApiProperty({ example: 'moc' })
  family: string;

  @ApiProperty({ example: true })
  desktopOnly: boolean;

  @ApiProperty({
    example: '/api/blog/live2d/pio/moc/index.json',
  })
  entry: string;
}

