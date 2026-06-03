import { PartialType } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DictDto {
  @ApiProperty({
    example: 'COMPONENT_TYPE',
    required: false,
  })
  dictCode?: string;

  @ApiProperty({
    example: '图表',
  })
  label: string;

  @ApiProperty({
    example: 1,
  })
  value: number | string;
}

export class AdminDictDto {
  @ApiProperty({
    example: '2041700000000300001',
  })
  id: string;

  @ApiProperty({
    example: 'COMPONENT_TYPE',
  })
  dictCode: string;

  @ApiProperty({
    example: '图表',
  })
  label: string;

  @ApiProperty({
    example: '1',
  })
  value: string;

  @ApiPropertyOptional({
    example: 'CHART',
  })
  childrenCode?: string;

  @ApiPropertyOptional({
    example: 1,
  })
  sort?: number;

  @ApiPropertyOptional({
    example: 1,
  })
  status?: number;

  @ApiPropertyOptional({
    example: '2026-06-03T12:00:00.000Z',
  })
  createTime?: Date;

  @ApiPropertyOptional({
    example: '2026-06-03T12:00:00.000Z',
  })
  updateTime?: Date;
}

export class AdminDictTreeDto extends AdminDictDto {
  @ApiProperty({
    example: '2041700000000300001/2041700000000300002',
  })
  treeKey: string;

  @ApiPropertyOptional({
    type: () => [AdminDictTreeDto],
  })
  children?: AdminDictTreeDto[];
}

export class AdminDictQueryDto {
  @ApiPropertyOptional()
  page?: number | string;

  @ApiPropertyOptional()
  pageNo?: number | string;

  @ApiPropertyOptional()
  pageSize?: number | string;

  @ApiPropertyOptional()
  keyword?: string;

  @ApiPropertyOptional()
  dictCode?: string;

  @ApiPropertyOptional()
  label?: string;

  @ApiPropertyOptional()
  value?: string;

  @ApiPropertyOptional()
  childrenCode?: string;

  @ApiPropertyOptional()
  status?: number | string;
}

export class AdminDictBodyDto {
  @ApiProperty({
    example: 'COMPONENT_TYPE',
  })
  dictCode: string;

  @ApiProperty({
    example: '图表',
  })
  label: string;

  @ApiProperty({
    example: '1',
  })
  value: string;

  @ApiPropertyOptional({
    example: 'CHART',
  })
  childrenCode?: string;

  @ApiPropertyOptional({
    example: 1,
  })
  sort?: number;

  @ApiPropertyOptional({
    example: 1,
  })
  status?: number;
}

export class AdminDictUpdateDto extends PartialType(AdminDictBodyDto) {
  @ApiProperty({
    example: '2041700000000300001',
  })
  id: string;
}
