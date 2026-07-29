import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  BlogArticleStatus,
  BlogArticleTerm,
} from '../infrastructure/persistence/blog-article.entity';

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
