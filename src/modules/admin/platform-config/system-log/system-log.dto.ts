import { ApiPropertyOptional } from '@nestjs/swagger';
import { KtDateTime, KtDateTimeField } from '@/common';

export class SystemLogQueryDto {
  @ApiPropertyOptional({
    description: '日志级别：debug/info/warning/error/critical',
  })
  level?: string;

  @ApiPropertyOptional({ description: '全文关键字' })
  keyword?: string;

  @ApiPropertyOptional({ description: 'Nest 日志上下文' })
  context?: string;

  @ApiPropertyOptional({ description: '请求路径关键字' })
  path?: string;

  @ApiPropertyOptional({ description: '请求 ID' })
  requestId?: string;

  @ApiPropertyOptional({ description: '开始时间 ISO 字符串或时间戳' })
  startTime?: string;

  @ApiPropertyOptional({ description: '结束时间 ISO 字符串或时间戳' })
  endTime?: string;

  @ApiPropertyOptional({ description: '相对结束时间向前查询分钟数' })
  rangeMinutes?: number | string;

  @ApiPropertyOptional({ description: '页码' })
  page?: number | string;

  @ApiPropertyOptional({ description: '页码' })
  pageNo?: number | string;

  @ApiPropertyOptional({ description: '每页条数' })
  pageSize?: number | string;

  @ApiPropertyOptional({ description: 'Loki 单次查询最大拉取条数' })
  limit?: number | string;
}

export class SystemLogDto {
  @ApiPropertyOptional({ description: '唯一行 ID' })
  id: string;

  @ApiPropertyOptional({ description: '日志时间' })
  @KtDateTimeField()
  timestamp: KtDateTime;

  @ApiPropertyOptional({ description: 'Loki 纳秒时间戳' })
  timestampNs: string;

  @ApiPropertyOptional({ description: '日志级别' })
  level: string;

  @ApiPropertyOptional({ description: '日志上下文' })
  context?: string;

  @ApiPropertyOptional({ description: '消息' })
  message: string;

  @ApiPropertyOptional({ description: 'HTTP 方法' })
  method?: string;

  @ApiPropertyOptional({ description: '请求路径' })
  path?: string;

  @ApiPropertyOptional({ description: 'HTTP 状态码' })
  statusCode?: number;

  @ApiPropertyOptional({ description: '耗时，毫秒' })
  durationMs?: number;

  @ApiPropertyOptional({ description: '请求 ID' })
  requestId?: string;

  @ApiPropertyOptional({ description: '主机名' })
  hostname?: string;

  @ApiPropertyOptional({ description: '原始日志行' })
  raw: string;
}

export class SystemLogSummaryDto {
  @ApiPropertyOptional({ description: '日志级别' })
  level: string;

  @ApiPropertyOptional({ description: '数量' })
  count: number;
}

export class SystemLogStatusDto {
  @ApiPropertyOptional({ description: '是否已配置 Loki 查询地址' })
  configured: boolean;

  @ApiPropertyOptional({ description: '默认 LogQL selector' })
  selector: string;

  @ApiPropertyOptional({ description: '日志应用标签' })
  app: string;

  @ApiPropertyOptional({ description: '日志环境标签' })
  env: string;

  @ApiPropertyOptional({ description: 'Loki 地址脱敏展示' })
  host?: string;
}
