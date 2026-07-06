import { ApiProperty } from '@nestjs/swagger';

export class BlogLive2DManifestDto {
  @ApiProperty({ enum: ['pio', 'tia'], example: 'tia' })
  character: string;

  @ApiProperty({ example: 'moc' })
  family: string;

  @ApiProperty({ example: true })
  desktopOnly: boolean;

  @ApiProperty({
    example: '/api/blog/live2d/tia/moc/index.json',
  })
  entry: string;
}

