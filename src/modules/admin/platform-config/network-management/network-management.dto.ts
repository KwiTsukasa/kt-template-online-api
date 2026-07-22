import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  KeeperStatus,
  PortForwardProtocol,
  PortForwardSyncStatus,
} from './network-management.types';

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
