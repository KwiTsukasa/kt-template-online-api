import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MEDIA_CODEX_AGENT_TOOLS,
  type MediaCodexAgentTool,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MEDIA_GOVERNANCE_MEDIA_TYPES = [
  'tv',
  'movie',
  'theatrical',
] as const;
export const MEDIA_GOVERNANCE_PROVIDERS = ['tmdb', 'tvdb', 'bangumi'] as const;
export const MEDIA_GOVERNANCE_CONTENT_KINDS = [
  'embedded_subtitle_media',
  'burned_in_subtitle_media',
  'bundled_sidecar_media',
  'subtitleless_media',
  'sidecar_subtitle_package',
] as const;
export const MEDIA_GOVERNANCE_SOURCE_ROLES = [
  'primary_media',
  'supplemental_subtitle',
] as const;

export type MediaGovernanceMediaType =
  (typeof MEDIA_GOVERNANCE_MEDIA_TYPES)[number];
export type MediaGovernanceProvider =
  (typeof MEDIA_GOVERNANCE_PROVIDERS)[number];
export type MediaGovernanceContentKind =
  (typeof MEDIA_GOVERNANCE_CONTENT_KINDS)[number];
export type MediaGovernanceSourceRole =
  (typeof MEDIA_GOVERNANCE_SOURCE_ROLES)[number];

const MAX_RELEASE_YEAR = new Date().getFullYear() + 2;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SEASON_NUMBER_PATTERN = /^S\d{2}$/i;

export class MediaGovernanceProviderRefDto {
  @ApiProperty({ enum: MEDIA_GOVERNANCE_PROVIDERS })
  @IsIn(MEDIA_GOVERNANCE_PROVIDERS)
  provider: MediaGovernanceProvider;

  @ApiProperty({ example: '105476', maxLength: 64 })
  @IsString()
  @Matches(PROVIDER_ID_PATTERN)
  providerId: string;
}

export class MediaGovernanceTaskCreateDto {
  @ApiProperty({ enum: MEDIA_GOVERNANCE_MEDIA_TYPES })
  @IsIn(MEDIA_GOVERNANCE_MEDIA_TYPES)
  mediaType: MediaGovernanceMediaType;

  @ApiProperty({ example: '异世界迷宫黑心企业', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  titleHint: string;

  @ApiPropertyOptional({
    description: 'TV 季号；特别篇或番外篇使用 S00',
    example: ['S00', 'S01'],
    maxItems: 100,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(SEASON_NUMBER_PATTERN, { each: true })
  seasonNumbers?: string[];

  @ApiPropertyOptional({
    description: '首播或上映年份，用于缩小同名作品候选范围',
    maximum: MAX_RELEASE_YEAR,
    minimum: 1888,
  })
  @IsOptional()
  @IsInt()
  @Min(1888)
  @Max(MAX_RELEASE_YEAR)
  releaseYear?: number;

  @ApiPropertyOptional({
    description: '媒体资料库唯一作品编号，填错会关联到另一部作品',
    type: MediaGovernanceProviderRefDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaGovernanceProviderRefDto)
  providerRef?: MediaGovernanceProviderRefDto;
}

export class MediaGovernanceTaskPageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  runState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  governanceProfile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gateReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  metadataStatus?: string;
}

export class MediaGovernanceRevisionCommandDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class MediaGovernanceSourceClassificationDto extends MediaGovernanceRevisionCommandDto {
  @ApiProperty({ enum: MEDIA_GOVERNANCE_SOURCE_ROLES })
  @IsIn(MEDIA_GOVERNANCE_SOURCE_ROLES)
  sourceRole: MediaGovernanceSourceRole;

  @ApiProperty({ enum: MEDIA_GOVERNANCE_CONTENT_KINDS })
  @IsIn(MEDIA_GOVERNANCE_CONTENT_KINDS)
  contentKind: MediaGovernanceContentKind;

  @ApiPropertyOptional({ maxItems: 100, type: [String] })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(SEASON_NUMBER_PATTERN, { each: true })
  seasonNumbers?: string[];

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  releaseGroup?: string;
}

export class MediaGovernanceMagnetSourceCreateDto extends MediaGovernanceSourceClassificationDto {
  @ApiProperty({ maxLength: 4096 })
  @IsString()
  @MaxLength(4096)
  @Matches(/^magnet:\?/, { message: '只接受 magnet URI' })
  magnetUri: string;
}

export class MediaGovernanceSubtitleMappingDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  episodeNumber: number;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @Matches(/^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/)
  relativePath: string;
}

export class MediaGovernanceSubtitleContractDto extends MediaGovernanceRevisionCommandDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(0, { each: true })
  expectedEpisodeNumbers: number[];

  @ApiProperty({ type: [MediaGovernanceSubtitleMappingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceSubtitleMappingDto)
  mappings: MediaGovernanceSubtitleMappingDto[];

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  @Matches(/\S/)
  releaseGroup: string;

  @ApiProperty({ maxLength: 96 })
  @IsString()
  @MaxLength(96)
  sourceId: string;
}

export class MediaGovernanceOperatorDecisionDto extends MediaGovernanceRevisionCommandDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  selectedCandidateId: string;

  @ApiProperty({ maxLength: 400 })
  @IsString()
  @MaxLength(400)
  @Matches(/\S/)
  reason: string;
}

export class MediaGovernanceAgentToolCallDto {
  @IsObject()
  arguments: Record<string, unknown>;

  @Matches(/^[a-f0-9]{64}$/)
  capsuleSha256: string;

  @Matches(/^[a-f0-9]{64}$/)
  manifestSha256: string;

  @Matches(/^[a-f0-9]{64}$/)
  policySha256: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;

  @IsInt()
  @Min(1)
  taskRevision: number;

  @IsIn(MEDIA_CODEX_AGENT_TOOLS)
  tool: MediaCodexAgentTool;
}

const MEDIA_GOVERNANCE_AGENT_EVENT_TYPES = [
  'agent-blocked',
  'agent-heartbeat',
  'agent-thread-mapped',
  'agent-turn-completed',
  'agent-turn-started',
] as const;

export class MediaGovernanceAgentEventDto {
  @Matches(/^[a-f0-9]{64}$/)
  capsuleSha256: string;

  @IsString()
  @MaxLength(160)
  eventId: string;

  @IsString()
  @MaxLength(64)
  observedAt: string;

  @Matches(/^[a-f0-9]{64}$/)
  policySha256: string;

  @IsInt()
  @Min(1)
  sequence: number;

  @IsIn(['active', 'blocked', 'closed'])
  status: 'active' | 'blocked' | 'closed';

  @IsString()
  @MaxLength(400)
  @Matches(/\S/)
  summary: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;

  @IsInt()
  @Min(1)
  taskRevision: number;

  @IsString()
  @MaxLength(96)
  threadId: string;

  @IsIn(MEDIA_GOVERNANCE_AGENT_EVENT_TYPES)
  type: (typeof MEDIA_GOVERNANCE_AGENT_EVENT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(96)
  turnId: null | string;
}
