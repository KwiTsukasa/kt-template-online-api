import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WordpressPagedQueryDto {
  @ApiPropertyOptional({
    type: Number,
    default: 1,
    description: '页码',
  })
  pageNo?: number;

  @ApiPropertyOptional({
    type: Number,
    default: 10,
    description: '每页条数',
  })
  pageSize?: number;

  @ApiPropertyOptional({
    description: '关键词搜索',
  })
  search?: string;

  @ApiPropertyOptional({
    description: '排序字段',
  })
  orderby?: string;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: '排序方向',
  })
  order?: 'asc' | 'desc';
}

export class WordpressArticleListQueryDto extends WordpressPagedQueryDto {
  @ApiPropertyOptional({
    description: '文章状态，默认 any',
  })
  status?: string;

  @ApiPropertyOptional({
    description: '分类 ID，多个使用逗号分隔',
  })
  categories?: string;

  @ApiPropertyOptional({
    description: '标签 ID，多个使用逗号分隔',
  })
  tags?: string;

  @ApiPropertyOptional({
    description: '作者 ID',
  })
  author?: string;
}

export class WordpressTermListQueryDto extends WordpressPagedQueryDto {
  @ApiPropertyOptional({
    description: '是否隐藏空分类/标签',
  })
  hide_empty?: boolean;

  @ApiPropertyOptional({
    description: '分类父级 ID，仅分类模块使用',
  })
  parent?: string;
}

export class WordpressArticleBodyDto {
  @ApiProperty({
    description: '文章标题',
  })
  title: string;

  @ApiPropertyOptional({
    description: '文章内容',
  })
  content?: string;

  @ApiPropertyOptional({
    description: '文章摘要',
  })
  excerpt?: string;

  @ApiPropertyOptional({
    description: '文章状态，例如 publish、draft、pending、private',
  })
  status?: string;

  @ApiPropertyOptional({
    description: '文章别名',
  })
  slug?: string;

  @ApiPropertyOptional({
    description: '分类 ID 数组或逗号分隔字符串',
  })
  categories?: number[] | string;

  @ApiPropertyOptional({
    description: '标签 ID 数组或逗号分隔字符串',
  })
  tags?: number[] | string;

  @ApiPropertyOptional({
    description: '特色媒体 ID',
  })
  featured_media?: number;

  @ApiPropertyOptional({
    description: '是否置顶',
  })
  sticky?: boolean;
}

export class WordpressArticleUpdateBodyDto extends WordpressArticleBodyDto {
  @ApiProperty({
    description: 'WordPress 文章 ID',
  })
  id: number;
}

export class WordpressTermBodyDto {
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
  parent?: number;
}

export class WordpressTermUpdateBodyDto extends WordpressTermBodyDto {
  @ApiProperty({
    description: 'WordPress 分类/标签 ID',
  })
  id: number;
}
