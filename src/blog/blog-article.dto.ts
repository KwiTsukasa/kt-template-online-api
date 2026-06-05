import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BlogArticleStatus, BlogArticleTerm } from './blog-article.entity';

export class BlogArticleListQueryDto {
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

  @ApiPropertyOptional()
  search?: string;

  @ApiPropertyOptional({
    enum: ['draft', 'pending', 'private', 'publish'],
  })
  status?: BlogArticleStatus | 'any';

  @ApiPropertyOptional({
    description: '分类 slug、名称或逗号分隔值',
  })
  categories?: string | string[];

  @ApiPropertyOptional({
    description: '标签 slug、名称或逗号分隔值',
  })
  tags?: string | string[];
}

export class BlogArticleBodyDto {
  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  slug?: string;

  @ApiPropertyOptional({
    enum: ['draft', 'pending', 'private', 'publish'],
  })
  status?: BlogArticleStatus;

  @ApiPropertyOptional()
  excerpt?: string;

  @ApiPropertyOptional()
  content?: string;

  @ApiPropertyOptional({
    enum: ['html', 'markdown'],
  })
  contentFormat?: 'html' | 'markdown';

  @ApiPropertyOptional()
  cover?: string;

  @ApiPropertyOptional()
  authorName?: string;

  @ApiPropertyOptional()
  categories?: Array<BlogArticleTerm | string>;

  @ApiPropertyOptional()
  tags?: Array<BlogArticleTerm | string>;
}

export class BlogArticleUpdateBodyDto extends BlogArticleBodyDto {
  @ApiProperty()
  id: string;
}

export class BlogArticleImportWordpressDto {
  @ApiPropertyOptional({
    default: true,
    description: '是否按 WordPress total 分页导入全部文章',
  })
  all?: boolean;

  @ApiPropertyOptional({
    default: 1,
    type: Number,
  })
  pageNo?: number;

  @ApiPropertyOptional({
    default: 100,
    type: Number,
  })
  pageSize?: number;

  @ApiPropertyOptional({
    default: false,
    description: '已存在同 slug 文章时是否覆盖',
  })
  overwrite?: boolean;
}

export class BlogArticleTermOptionsQueryDto {
  @ApiPropertyOptional({
    default: 1,
    type: Number,
  })
  pageNo?: number;

  @ApiPropertyOptional({
    default: 200,
    type: Number,
  })
  pageSize?: number;

  @ApiPropertyOptional({
    description: '分类或标签关键词',
  })
  search?: string;
}
