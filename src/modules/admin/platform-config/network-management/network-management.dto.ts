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
   * Enforces the A-required and AAAA-forbidden source-ID discriminated union.
   * @param value - Candidate port-forward identifier.
   * @param args - Validation context containing the sibling record type.
   * @returns True only for an A decimal string or an omitted AAAA field.
   */
  validate(value: unknown, args: ValidationArguments): boolean {
    const input = args.object as { recordType?: unknown };
    if (input.recordType === 'A') {
      return typeof value === 'string' && DECIMAL_ID_PATTERN.test(value);
    }
    if (input.recordType === 'AAAA') return value === undefined;
    return true;
  }

  /**
   * Returns a stable request-contract error without echoing the supplied value.
   * @returns Safe validation message.
   */
  defaultMessage(): string {
    return 'portForwardId is required for A and forbidden for AAAA';
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

  @ApiProperty({ enum: ['agent_ipv6', 'port_forward_ipv4'] })
  @IsIn(['agent_ipv6', 'port_forward_ipv4'])
  sourceType: NetworkDdnsSourceType;

  @ApiPropertyOptional({ description: 'A 记录使用的端口转发 Snowflake ID' })
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
 * Runs update validation for every supplied value, including explicit null.
 * @param _object - DTO instance required by class-validator's predicate contract.
 * @param value - Candidate property value.
 * @returns True unless the property was omitted entirely.
 */
function isProvided(_object: object, value: unknown): boolean {
  return value !== undefined;
}

/**
 * Converts literal HTTP query booleans without treating every non-empty string as true.
 * @param params - class-transformer field input.
 * @returns Parsed boolean or the original invalid value for class-validator to reject.
 */
function parseBooleanQuery({ value }: TransformFnParams): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}
