import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { FormatDateTime } from '@/common';

export class AdminNoticeDto {
  @ApiProperty({
    example: '2041700000000300001',
  })
  id: string;

  @ApiProperty({
    example: '系统公告',
  })
  title: string;

  @ApiProperty({
    example: '站内公告正文内容',
  })
  content: string;

  @ApiPropertyOptional({
    example: '站内公告摘要',
  })
  summary?: string;

  @ApiProperty({
    example: 1,
  })
  level: number;

  @ApiProperty({
    example: 1,
  })
  status: number;

  @ApiProperty({
    example: false,
  })
  isTop: boolean;

  @ApiPropertyOptional({
    example: '100001,100002',
  })
  notifyUsers?: string;

  @ApiPropertyOptional({
    example: '2041700000000100001',
  })
  createdBy?: string;

  @ApiProperty({
    example: false,
  })
  isDeleted: boolean;

  @ApiPropertyOptional({
    example: '2026-06-03 20:00:00',
  })
  @FormatDateTime()
  createTime?: Date;

  @ApiPropertyOptional({
    example: '2026-06-03 20:00:00',
  })
  @FormatDateTime()
  updateTime?: Date;
}

export class AdminNoticeQueryDto {
  @ApiPropertyOptional()
  page?: number | string;

  @ApiPropertyOptional()
  pageNo?: number | string;

  @ApiPropertyOptional()
  pageSize?: number | string;

  @ApiPropertyOptional()
  keyword?: string;

  @ApiPropertyOptional()
  level?: number | string;

  @ApiPropertyOptional()
  status?: number | string;

  @ApiPropertyOptional()
  isTop?: boolean | number | string;

  @ApiPropertyOptional()
  notifyUsers?: string;
}

export class AdminNoticeBodyDto {
  @ApiProperty({ example: '系统公告' })
  title: string;

  @ApiProperty({ example: '站内公告正文内容' })
  content: string;

  @ApiPropertyOptional({ example: '站内公告摘要' })
  summary?: string;

  @ApiPropertyOptional({ example: 1 })
  level?: number | string;

  @ApiPropertyOptional({ example: 1 })
  status?: number | string;

  @ApiPropertyOptional({ example: false })
  isTop?: boolean | number | string;

  @ApiPropertyOptional({ example: '100001,100002' })
  notifyUsers?: string;
}

export class AdminNoticeUpdateDto extends PartialType(AdminNoticeBodyDto) {
  @ApiProperty({
    example: '2041700000000300001',
  })
  id: string;
}
