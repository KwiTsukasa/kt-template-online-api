import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KtDateTime, KtDateTimeField } from '@/common';
import type { EnvironmentDashboardResponse } from '../../../environment-dashboard/domain/environment-dashboard.types';
import { EnvironmentDashboardResponseDto } from '../../../environment-dashboard/presentation/dto/environment-dashboard.dto';

export class MobileHomeNoticeItemDto {
  @ApiProperty({ description: '站内信唯一标识' })
  id!: string;

  @ApiProperty({ description: '站内信标题' })
  title!: string;

  @ApiProperty({ description: '站内信正文' })
  content!: string;

  @ApiPropertyOptional({ description: '站内信摘要' })
  summary?: string;

  @ApiProperty({ description: '未读状态为 1，已读状态为 0' })
  status!: number;

  @ApiProperty({ description: '消息严重级别' })
  severity!: string;

  @ApiProperty({ description: '消息来源' })
  source!: string;

  @ApiProperty({ description: '消息事件类型' })
  eventType!: string;

  @ApiProperty({ description: '相同事件累计发生次数' })
  occurrenceCount!: number;

  @ApiProperty({ description: '是否置顶' })
  isTop!: boolean;

  @ApiPropertyOptional({ description: '站内信创建时间' })
  @KtDateTimeField()
  createTime?: KtDateTime;

  @ApiPropertyOptional({ description: '事件最后出现时间' })
  @KtDateTimeField()
  lastSeenAt?: KtDateTime;
}

export class MobileHomeNoticeSnapshotDto {
  @ApiProperty({ type: [MobileHomeNoticeItemDto] })
  items!: MobileHomeNoticeItemDto[];

  @ApiProperty({ description: '当前筛选条件下的站内信总数' })
  total!: number;

  @ApiProperty({ description: '当前权威未读站内信数量' })
  unreadCount!: number;
}

export class MobileHomeBootstrapResponseDto {
  @ApiProperty({ type: EnvironmentDashboardResponseDto })
  environment!: EnvironmentDashboardResponse;

  @ApiProperty({ type: MobileHomeNoticeSnapshotDto })
  notices!: MobileHomeNoticeSnapshotDto;
}
