import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
    example: 'error',
  })
  severity: string;

  @ApiProperty({
    example: 'api',
  })
  source: string;

  @ApiProperty({
    example: 'api.error',
  })
  eventType: string;

  @ApiPropertyOptional({
    example: 'api:error:GET:/boom:500',
  })
  dedupeKey?: string;

  @ApiProperty({
    example: 1,
  })
  occurrenceCount: number;

  @ApiProperty({
    example: 'super',
  })
  notifyRoleCode: string;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown>;

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

  @ApiPropertyOptional({
    example: '2026-06-03 20:00:00',
  })
  @FormatDateTime()
  firstSeenAt?: Date;

  @ApiPropertyOptional({
    example: '2026-06-03 20:00:00',
  })
  @FormatDateTime()
  lastSeenAt?: Date;
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
  severity?: string;

  @ApiPropertyOptional()
  source?: string;

  @ApiPropertyOptional()
  eventType?: string;

  @ApiPropertyOptional()
  notifyRoleCode?: string;

  @ApiPropertyOptional()
  isTop?: boolean | number | string;

  @ApiPropertyOptional()
  notifyUsers?: string;
}
