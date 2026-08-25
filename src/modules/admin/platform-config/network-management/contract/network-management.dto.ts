import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  NetworkDdnsRecordType,
  NetworkDdnsSourceType,
  NetworkDdnsSyncStatus,
  KeeperStatus,
  PortForwardProtocol,
  PortForwardSyncStatus,
} from './network-management.types';

const DNS_DOMAIN_PATTERN =
  /^(?=.{1,253}\.?$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.?$/i;
const DNS_SUB_DOMAIN_PATTERN =
  /^(?:@|[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*)$/i;
const DECIMAL_ID_PATTERN = /^\d{1,24}$/;

@ValidatorConstraint({ async: false, name: 'networkDdnsPortForwardId' })
class NetworkDdnsPortForwardIdConstraint implements ValidatorConstraintInterface {
  /**
   * 校验 A/IPv4 与 AAAA/IP4P 来源必须携带十进制端口转发 ID，而 Agent IPv6 禁止携带该字段。
   * @param value - 参与网络DDNS端口转发标识约束记录比较、格式化或输出的候选值。
   * @param args - 用于网络DDNS端口转发标识约束记录的领域对象，包含 `object` 字段。
   * @returns 满足网络DDNS端口转发标识约束记录约束时为 `true`；不满足、未命中或显式失败分支为 `false`；没有可用结果或提前结束时为 `undefined`。
   */
  validate(value: unknown, args: ValidationArguments): boolean {
    const input = args.object as {
      recordType?: unknown;
      sourceType?: unknown;
    };
    if (
      (input.recordType === 'A' && input.sourceType === 'port_forward_ipv4') ||
      (input.recordType === 'AAAA' && input.sourceType === 'port_forward_ip4p')
    ) {
      return typeof value === 'string' && DECIMAL_ID_PATTERN.test(value);
    }
    if (input.recordType === 'AAAA' && input.sourceType === 'agent_ipv6') {
      return value === undefined;
    }
    return true;
  }

  /**
   * 返回端口转发标识与来源类型不匹配时使用的固定校验消息。
   * @returns 明确端口来源必填 ID、Agent IPv6 禁止 ID 的固定英文错误文本。
   */
  defaultMessage(): string {
    return 'portForwardId is required for port-forward sources and forbidden for Agent IPv6';
  }
}

export class NetworkPortForwardCreateDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, { message: 'name must contain a non-whitespace character' })
  name: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ enum: ['tcp', 'udp'] })
  @IsIn(['tcp', 'udp'])
  protocol: PortForwardProtocol;

  @ApiProperty({ maximum: 65535, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(65535)
  externalPort: number;

  @ApiProperty({ maximum: 65535, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(65535)
  internalPort: number;
}

export class NetworkPortForwardUpdateDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf(isProvided)
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, { message: 'name must contain a non-whitespace character' })
  name?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiPropertyOptional({ enum: ['tcp', 'udp'] })
  @ValidateIf(isProvided)
  @IsIn(['tcp', 'udp'])
  protocol?: PortForwardProtocol;

  @ApiPropertyOptional({ maximum: 65535, minimum: 1 })
  @ValidateIf(isProvided)
  @IsInt()
  @Min(1)
  @Max(65535)
  externalPort?: number;

  @ApiPropertyOptional({ maximum: 65535, minimum: 1 })
  @ValidateIf(isProvided)
  @IsInt()
  @Min(1)
  @Max(65535)
  internalPort?: number;
}

export class NetworkPortForwardListQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number;

  @ApiPropertyOptional({ maximum: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ['tcp', 'udp'] })
  @IsOptional()
  @IsIn(['tcp', 'udp'])
  protocol?: PortForwardProtocol;

  @ApiPropertyOptional({
    enum: ['conflict', 'deleting', 'failed', 'pending', 'synced', 'syncing'],
  })
  @IsOptional()
  @IsIn(['conflict', 'deleting', 'failed', 'pending', 'synced', 'syncing'])
  syncStatus?: PortForwardSyncStatus;
}

export class NetworkEndpointHistoryQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number;

  @ApiPropertyOptional({ maximum: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class NetworkDdnsRecordInputDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, { message: 'name must contain a non-whitespace character' })
  name: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ enum: ['A', 'AAAA'] })
  @IsIn(['A', 'AAAA'])
  recordType: NetworkDdnsRecordType;

  @ApiProperty({
    enum: ['agent_ipv6', 'port_forward_ip4p', 'port_forward_ipv4'],
  })
  @IsIn(['agent_ipv6', 'port_forward_ip4p', 'port_forward_ipv4'])
  sourceType: NetworkDdnsSourceType;

  @ApiPropertyOptional({
    description: 'A 或 IP4P AAAA 记录使用的端口转发 Snowflake ID',
  })
  @Validate(NetworkDdnsPortForwardIdConstraint)
  portForwardId?: string;

  @ApiProperty({ maxLength: 253 })
  @IsString()
  @Length(1, 253)
  @Matches(DNS_DOMAIN_PATTERN)
  domain: string;

  @ApiProperty({ maxLength: 253 })
  @IsString()
  @Length(1, 253)
  @Matches(DNS_SUB_DOMAIN_PATTERN)
  subDomain: string;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class NetworkDdnsListQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number;

  @ApiPropertyOptional({ maximum: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ['A', 'AAAA'] })
  @IsOptional()
  @IsIn(['A', 'AAAA'])
  recordType?: NetworkDdnsRecordType;

  @ApiPropertyOptional({
    enum: [
      'disabled',
      'failed',
      'pending',
      'synced',
      'syncing',
      'waiting_source',
    ],
  })
  @IsOptional()
  @IsIn([
    'disabled',
    'failed',
    'pending',
    'synced',
    'syncing',
    'waiting_source',
  ])
  syncStatus?: NetworkDdnsSyncStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(parseBooleanQuery)
  @IsBoolean()
  enabled?: boolean;
}

export class NetworkDdnsSourceOptionsQueryDto {
  @ApiProperty({ enum: ['A', 'AAAA'] })
  @IsIn(['A', 'AAAA'])
  recordType: NetworkDdnsRecordType;
}

export class NetworkPortForwardResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  remark?: string | null;

  @ApiProperty({ enum: ['tcp', 'udp'] })
  protocol: PortForwardProtocol;

  @ApiProperty()
  externalPort: number;

  @ApiProperty()
  internalPort: number;

  @ApiProperty()
  targetIpv4: string;

  @ApiProperty()
  keeperDesiredEnabled: boolean;

  @ApiProperty({ enum: ['active', 'disabled', 'failed', 'stale', 'starting'] })
  keeperStatus: KeeperStatus;

  @ApiProperty({
    enum: ['conflict', 'deleting', 'failed', 'pending', 'synced', 'syncing'],
  })
  syncStatus: PortForwardSyncStatus;

  @ApiProperty()
  desiredRevision: string;

  @ApiProperty()
  reportedRevision: string;

  @ApiPropertyOptional({ nullable: true })
  currentPublicEndpoint?: string | null;
}

/**
 * 根据`_object`、`value`与当前约束判定值是否已提供。
 * @param _object - 为兼容既有调用签名保留；当前实现不会读取该参数。
 * @param value - 待判定是否满足值是否已提供约束的候选值。
 * @returns 满足值是否已提供约束时为 `true`；不满足、未命中或显式失败分支为 `false`；没有可用结果或提前结束时为 `undefined`。
 */
function isProvided(_object: object, value: unknown): boolean {
  return value !== undefined;
}

/**
 * 从当前运行态解析布尔查询。
 * @returns 满足布尔查询约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function parseBooleanQuery({ value }: TransformFnParams): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}
