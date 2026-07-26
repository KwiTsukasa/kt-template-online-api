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
import type { TcpProtocolMode } from './network-tcp-release-policy.service';

const DECIMAL_ID_PATTERN = /^\d{1,24}$/;

export class NetworkPortForwardGroupCreateDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, { message: '名称必须包含非空白字符' })
  name: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ enum: ['tcp', 'tcp_udp', 'udp'] })
  @IsIn(['tcp', 'tcp_udp', 'udp'])
  protocolMode: TcpProtocolMode;

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

export class NetworkPortForwardGroupUpdateDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf(isProvided)
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, { message: '名称必须包含非空白字符' })
  name?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiPropertyOptional({ enum: ['tcp', 'tcp_udp', 'udp'] })
  @ValidateIf(isProvided)
  @IsIn(['tcp', 'tcp_udp', 'udp'])
  protocolMode?: TcpProtocolMode;

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

export class NetworkPortForwardGroupListQueryDto {
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

  @ApiPropertyOptional({ enum: ['tcp', 'tcp_udp', 'udp'] })
  @IsOptional()
  @IsIn(['tcp', 'tcp_udp', 'udp'])
  protocolMode?: TcpProtocolMode;
}

export class NetworkPortForwardGroupParamsDto {
  @ApiProperty()
  @IsString()
  @Matches(DECIMAL_ID_PATTERN)
  groupId: string;
}

export class NetworkPortForwardGroupChannelParamsDto extends NetworkPortForwardGroupParamsDto {
  @ApiProperty({ enum: ['tcp', 'udp'] })
  @IsIn(['tcp', 'udp'])
  protocol: 'tcp' | 'udp';
}

function isProvided(_object: object, value: unknown): boolean {
  return value !== undefined;
}
