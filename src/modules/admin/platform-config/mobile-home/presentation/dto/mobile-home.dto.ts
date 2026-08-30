import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
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

export class MobileHomeEntityAttributeDto {
  @ApiProperty()
  key!: string;

  @ApiProperty({ nullable: true })
  value!: boolean | number | string | null | number[];
}

export class MobileHomeEntitySnapshotDto {
  @ApiPropertyOptional()
  areaId?: string;

  @ApiProperty({ type: [MobileHomeEntityAttributeDto] })
  attributes!: MobileHomeEntityAttributeDto[];

  @ApiPropertyOptional()
  deviceId?: string;

  @ApiProperty()
  domain!: string;

  @ApiProperty()
  entityId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  state!: string;

  @ApiPropertyOptional()
  updatedAt?: string;
}

export class MobileHomeAreaSnapshotDto {
  @ApiProperty()
  entityCount!: number;

  @ApiPropertyOptional()
  floorId?: string;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class MobileHomeSceneSnapshotDto {
  @ApiProperty({ enum: ['automation', 'scene', 'script'] })
  domain!: 'automation' | 'scene' | 'script';

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  entityId!: string;

  @ApiPropertyOptional()
  lastChanged?: string;

  @ApiProperty()
  name!: string;
}

export class MobileHomeActivitySnapshotDto {
  @ApiPropertyOptional()
  entityId?: string;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  observedAt!: string;

  @ApiProperty({ enum: ['info', 'success', 'warning'] })
  severity!: 'info' | 'success' | 'warning';

  @ApiProperty()
  summary!: string;
}

export class MobileHomeEnergyPointDto {
  @ApiProperty()
  observedAt!: string;

  @ApiProperty()
  value!: number;
}

export class MobileHomeEnergyEntitySnapshotDto {
  @ApiProperty()
  entityId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [MobileHomeEnergyPointDto] })
  points!: MobileHomeEnergyPointDto[];

  @ApiProperty()
  state!: number;

  @ApiProperty()
  unit!: string;
}

export class MobileHomeHomeSnapshotResponseDto {
  @ApiProperty({ type: [MobileHomeActivitySnapshotDto] })
  activities!: MobileHomeActivitySnapshotDto[];

  @ApiProperty({ type: [MobileHomeAreaSnapshotDto] })
  areas!: MobileHomeAreaSnapshotDto[];

  @ApiProperty()
  connected!: boolean;

  @ApiProperty({ type: [MobileHomeEnergyEntitySnapshotDto] })
  energy!: MobileHomeEnergyEntitySnapshotDto[];

  @ApiProperty({ type: [MobileHomeEntitySnapshotDto] })
  entities!: MobileHomeEntitySnapshotDto[];

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty({ type: [MobileHomeSceneSnapshotDto] })
  scenes!: MobileHomeSceneSnapshotDto[];
}

export class MobileHomeServiceCallRequestDto {
  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-z_]+$/u)
  domain!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-z_]+\.[A-Za-z0-9_]+$/u)
  entityId!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/u)
  requestId!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-z_]+$/u)
  service!: string;
}

export class MobileHomeServiceCallResponseDto {
  @ApiPropertyOptional({ type: MobileHomeEntitySnapshotDto })
  entity?: MobileHomeEntitySnapshotDto;

  @ApiProperty()
  requestId!: string;
}

export class MobileHomeAssistRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  conversationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 2000)
  text!: string;
}

export class MobileHomeAssistResponseDto {
  @ApiProperty()
  continueConversation!: boolean;

  @ApiPropertyOptional()
  conversationId?: string;

  @ApiProperty()
  responseType!: string;

  @ApiProperty()
  speech!: string;
}

export class MobileGameAppSnapshotDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  imagePath?: string;

  @ApiProperty()
  name!: string;
}

export class MobileGameSnapshotResponseDto {
  @ApiProperty({ type: [MobileGameAppSnapshotDto] })
  apps!: MobileGameAppSnapshotDto[];

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty()
  host!: string;

  @ApiProperty()
  httpsPort!: number;

  @ApiProperty()
  managementReady!: boolean;

  @ApiProperty()
  streamPort!: number;

  @ApiProperty()
  virtualGamepadReady!: boolean;
}

export class MobileGamePinRequestDto {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  name!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{4}$/u)
  pin!: string;
}

export class MobileGamePinResponseDto {
  @ApiProperty()
  accepted!: boolean;
}
