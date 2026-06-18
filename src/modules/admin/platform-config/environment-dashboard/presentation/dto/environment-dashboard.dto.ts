import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EnvironmentEvidenceDto {
  @ApiProperty({ description: '观测来源名称', example: 'Jenkins Build' })
  source!: string;

  @ApiProperty({
    description: '证据来源类型，unwired 表示只读观测配置未接入',
    example: 'unwired',
  })
  sourceKind!: string;

  @ApiProperty({ description: '面向运维的证据摘要' })
  summary!: string;

  @ApiPropertyOptional({ description: '证据采集时间 ISO 字符串' })
  observedAt?: string;

  @ApiPropertyOptional({ description: '证据过期时间 ISO 字符串' })
  expiresAt?: string;

  @ApiPropertyOptional({ description: '已脱敏的附加元数据' })
  metadata?: Record<string, unknown>;
}

export class EnvironmentSignalDto {
  @ApiProperty({ description: '稳定信号 ID' })
  id!: string;

  @ApiProperty({ description: '信号展示名称' })
  label!: string;

  @ApiProperty({ description: '信号健康状态', example: 'unwired' })
  status!: string;

  @ApiProperty({ description: '信号来源类型', example: 'unwired' })
  sourceKind!: string;

  @ApiProperty({ description: '信号摘要' })
  summary!: string;

  @ApiProperty({ type: [EnvironmentEvidenceDto] })
  evidence!: EnvironmentEvidenceDto[];

  @ApiPropertyOptional({ description: '信号观测时间 ISO 字符串' })
  observedAt?: string;

  @ApiPropertyOptional({ description: '信号新鲜度窗口，秒' })
  staleAfterSeconds?: number;
}

export class EnvironmentServiceDto {
  @ApiProperty({ description: '稳定服务 ID' })
  id!: string;

  @ApiProperty({ description: '服务展示名称' })
  label!: string;

  @ApiProperty({ description: '服务聚合健康状态' })
  status!: string;

  @ApiProperty({ description: '服务摘要' })
  summary!: string;

  @ApiProperty({ type: [EnvironmentSignalDto] })
  signals!: EnvironmentSignalDto[];
}

export class EnvironmentNodeDto {
  @ApiProperty({ description: '稳定节点 ID' })
  id!: string;

  @ApiProperty({ description: '节点展示名称' })
  label!: string;

  @ApiPropertyOptional({ description: '节点聚合健康状态' })
  status?: string;

  @ApiProperty({ type: [EnvironmentServiceDto] })
  services!: EnvironmentServiceDto[];
}

export class EnvironmentSiteDto {
  @ApiProperty({ description: '稳定站点 ID', example: 'nas-prod' })
  id!: string;

  @ApiProperty({ description: '站点展示名称' })
  label!: string;

  @ApiProperty({ description: '站点聚合状态' })
  status!: string;

  @ApiProperty({ description: '站点摘要' })
  summary!: string;

  @ApiProperty({ type: [EnvironmentNodeDto] })
  nodes!: EnvironmentNodeDto[];
}

export class EnvironmentDashboardSummaryDto {
  @ApiProperty({ description: '总信号数' })
  totalSignals!: number;

  @ApiProperty({ description: '按健康状态聚合的信号数' })
  byStatus!: Record<string, number>;
}

export class EnvironmentTopologyNodeDto {
  @ApiProperty({ description: '拓扑节点 ID' })
  id!: string;

  @ApiProperty({ description: '拓扑节点名称' })
  label!: string;

  @ApiProperty({ description: '所属站点 ID' })
  siteId!: string;

  @ApiProperty({ description: '拓扑节点状态' })
  status!: string;
}

export class EnvironmentTopologyEdgeDto {
  @ApiProperty({ description: '拓扑边 ID' })
  id!: string;

  @ApiProperty({ description: '起点 ID' })
  source!: string;

  @ApiProperty({ description: '终点 ID' })
  target!: string;

  @ApiProperty({ description: '关系标签' })
  label!: string;
}

export class EnvironmentTopologyDto {
  @ApiProperty({ type: [EnvironmentTopologyNodeDto] })
  nodes!: EnvironmentTopologyNodeDto[];

  @ApiProperty({ type: [EnvironmentTopologyEdgeDto] })
  edges!: EnvironmentTopologyEdgeDto[];
}

export class EnvironmentActionDto {
  @ApiProperty({ description: '动作 ID' })
  id!: string;

  @ApiProperty({ description: '动作展示名称' })
  label!: string;

  @ApiProperty({ description: '动作是否可执行' })
  enabled!: boolean;

  @ApiPropertyOptional({ description: '禁用原因' })
  disabledReason?: string;
}

export class EnvironmentEventDto {
  @ApiProperty({ description: '事件 ID' })
  eventId!: string;

  @ApiProperty({ description: '事件 topic' })
  topic!: string;

  @ApiProperty({ description: '所属站点 ID' })
  siteId!: string;

  @ApiProperty({ description: '事件严重级别' })
  severity!: string;

  @ApiProperty({ description: '事件来源类型' })
  sourceKind!: string;

  @ApiProperty({ description: '事件观测时间 ISO 字符串' })
  observedAt!: string;

  @ApiProperty({ description: '事件摘要' })
  summary!: string;
}

export class EnvironmentDashboardResponseDto {
  @ApiProperty({ description: '快照生成时间 ISO 字符串' })
  generatedAt!: string;

  @ApiProperty({ description: '快照刷新时间 ISO 字符串' })
  refreshedAt!: string;

  @ApiProperty({ type: EnvironmentDashboardSummaryDto })
  summary!: EnvironmentDashboardSummaryDto;

  @ApiProperty({ type: [EnvironmentSiteDto] })
  sites!: EnvironmentSiteDto[];

  @ApiProperty({ type: EnvironmentTopologyDto })
  topology!: EnvironmentTopologyDto;

  @ApiProperty({ type: [EnvironmentActionDto] })
  actions!: EnvironmentActionDto[];

  @ApiProperty({ type: [EnvironmentEventDto] })
  events!: EnvironmentEventDto[];
}

export class EnvironmentStreamEventDto {
  @ApiProperty({ description: 'SSE 事件类型', example: 'environment-event' })
  type!: string;

  @ApiPropertyOptional({ description: 'SSE 事件 ID' })
  id?: string;

  @ApiPropertyOptional({ description: '已脱敏事件数据' })
  data?: Record<string, unknown>;
}
