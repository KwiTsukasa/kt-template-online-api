import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BlogTermListQueryDto {
  @ApiPropertyOptional({
    default: 1,
    type: Number,
  })
  pageNo?: number;

  @ApiPropertyOptional({
    default: 10,
    type: Number,
  })
  pageSize?: number;

  @ApiPropertyOptional({
    description: '分类或标签关键词',
  })
  search?: string;

  @ApiPropertyOptional({
    description: '是否隐藏没有关联文章的分类或标签',
  })
  hide_empty?: boolean;

  @ApiPropertyOptional({
    description: '父级分类 ID，仅分类模块使用',
  })
  parent?: string;
}

export class BlogTermBodyDto {
  @ApiProperty({
    description: '名称',
  })
  name: string;

  @ApiPropertyOptional({
    description: '别名',
  })
  slug?: string;

  @ApiPropertyOptional({
    description: '描述',
  })
  description?: string;

  @ApiPropertyOptional({
    description: '父级分类 ID，仅分类模块使用',
  })
  parent?: string;
}

export class BlogTermUpdateBodyDto extends BlogTermBodyDto {
  @ApiProperty({
    description: '本地分类或标签 ID',
  })
  id: string;
}
