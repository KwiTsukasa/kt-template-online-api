import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MEDIA_GOVERNANCE_CONTENT_KINDS,
  MEDIA_GOVERNANCE_MEDIA_TYPES,
  MediaGovernanceContentKind,
  MediaGovernanceMediaType,
  MediaGovernanceProviderRefDto,
} from './media-governance.dto';

const MAX_RELEASE_YEAR = new Date().getFullYear() + 2;
const MEDIA_GOVERNANCE_RSS_IDENTITY_PROVIDERS = ['bangumi', 'tmdb'] as const;

export class MediaGovernanceSeriesSeasonFactDto {
  @ApiProperty({ maximum: 99, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(99)
  seasonNumber: number;

  @ApiPropertyOptional({ default: 1, maximum: 2000, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  episodeStart?: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  title: string;

  @ApiProperty({ maximum: 2000, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2000)
  episodeCount: number;

  @ApiPropertyOptional({ maximum: MAX_RELEASE_YEAR, minimum: 1888 })
  @IsOptional()
  @IsInt()
  @Min(1888)
  @Max(MAX_RELEASE_YEAR)
  releaseYear?: number;
}

export class MediaGovernanceSeriesExternalRefDto {
  @ApiProperty({ type: MediaGovernanceProviderRefDto })
  @ValidateNested()
  @Type(() => MediaGovernanceProviderRefDto)
  providerRef: MediaGovernanceProviderRefDto;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  title?: string;

  @ApiPropertyOptional({ maximum: MAX_RELEASE_YEAR, minimum: 1888 })
  @IsOptional()
  @IsInt()
  @Min(1888)
  @Max(MAX_RELEASE_YEAR)
  releaseYear?: number;
}

export class MediaGovernanceTaskEpisodeRangeDto {
  @ApiProperty({ maxLength: 96 })
  @IsString()
  @Matches(/^media-task-[A-Za-z0-9-]{20,80}$/)
  taskId: string;

  @ApiProperty({ maximum: 99, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(99)
  seasonNumber: number;

  @ApiProperty({ maximum: 2000, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2000)
  episodeStart: number;

  @ApiProperty({ maximum: 2000, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2000)
  episodeEnd: number;
}

export class MediaGovernanceSeriesReconcileDto {
  @ApiProperty({ type: MediaGovernanceProviderRefDto })
  @ValidateNested()
  @Type(() => MediaGovernanceProviderRefDto)
  canonicalProviderRef: MediaGovernanceProviderRefDto;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  title: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  originalTitle?: string;

  @ApiProperty({ maximum: MAX_RELEASE_YEAR, minimum: 1888 })
  @IsInt()
  @Min(1888)
  @Max(MAX_RELEASE_YEAR)
  releaseYear: number;

  @ApiProperty({ type: [MediaGovernanceSeriesSeasonFactDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceSeriesSeasonFactDto)
  seasons: MediaGovernanceSeriesSeasonFactDto[];

  @ApiPropertyOptional({ type: [MediaGovernanceSeriesExternalRefDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceSeriesExternalRefDto)
  externalRefs?: MediaGovernanceSeriesExternalRefDto[];

  @ApiPropertyOptional({ type: [MediaGovernanceTaskEpisodeRangeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceTaskEpisodeRangeDto)
  taskBindings?: MediaGovernanceTaskEpisodeRangeDto[];
}

export class MediaGovernanceSeriesPageQueryDto {
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

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}

export class MediaGovernanceEpisodePageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class MediaGovernanceMagnetBatchItemDto {
  @ApiProperty({ maximum: 2000, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2000)
  episodeNumber: number;

  @ApiProperty({ maxLength: 4096 })
  @IsString()
  @MaxLength(4096)
  @Matches(/^magnet:\?xt=urn:btih:/i)
  magnetUri: string;
}

export class MediaGovernanceMagnetBatchCreateDto {
  @ApiProperty({ enum: MEDIA_GOVERNANCE_CONTENT_KINDS })
  @IsIn(MEDIA_GOVERNANCE_CONTENT_KINDS)
  contentKind: MediaGovernanceContentKind;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  releaseGroup?: string;

  @ApiProperty({
    maxItems: 16,
    minItems: 1,
    type: [MediaGovernanceMagnetBatchItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceMagnetBatchItemDto)
  items: MediaGovernanceMagnetBatchItemDto[];
}

export class MediaGovernanceRssIdentitySelectionDto {
  @ApiProperty({ enum: MEDIA_GOVERNANCE_RSS_IDENTITY_PROVIDERS })
  @IsIn(MEDIA_GOVERNANCE_RSS_IDENTITY_PROVIDERS)
  provider: 'bangumi' | 'tmdb';

  @ApiProperty({ maxLength: 32 })
  @IsString()
  @MaxLength(32)
  @Matches(/^[1-9]\d*$/)
  providerId: string;

  @ApiPropertyOptional({ maximum: MAX_RELEASE_YEAR, minimum: 1888 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1888)
  @Max(MAX_RELEASE_YEAR)
  releaseYear?: number;
}

export class MediaGovernanceCatalogIdentitySearchQueryDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  keyword: string;

  @ApiProperty({ enum: MEDIA_GOVERNANCE_MEDIA_TYPES })
  @IsIn(MEDIA_GOVERNANCE_MEDIA_TYPES)
  workType: MediaGovernanceMediaType;
}

export class MediaGovernanceSeriesCreateDto {
  @ApiProperty({ type: MediaGovernanceRssIdentitySelectionDto })
  @ValidateNested()
  @Type(() => MediaGovernanceRssIdentitySelectionDto)
  identity: MediaGovernanceRssIdentitySelectionDto;

  @ApiProperty({ enum: MEDIA_GOVERNANCE_MEDIA_TYPES })
  @IsIn(MEDIA_GOVERNANCE_MEDIA_TYPES)
  workType: MediaGovernanceMediaType;
}

export class MediaGovernanceWorkCreateDto extends MediaGovernanceSeriesCreateDto {}

export class MediaGovernanceWorkTaskCreateDto {
  @ApiPropertyOptional({ maxItems: 100, type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(99, { each: true })
  seasonNumbers?: number[];
}

export class MediaGovernanceRssSubscriptionCreateDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  name: string;

  @ApiProperty({ maxLength: 2048 })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  feedUrl: string;

  @ApiProperty({ enum: MEDIA_GOVERNANCE_CONTENT_KINDS })
  @IsIn(MEDIA_GOVERNANCE_CONTENT_KINDS)
  contentKind: MediaGovernanceContentKind;

  @ApiProperty({ type: MediaGovernanceRssIdentitySelectionDto })
  @ValidateNested()
  @Type(() => MediaGovernanceRssIdentitySelectionDto)
  identity: MediaGovernanceRssIdentitySelectionDto;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  releaseGroup?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  includePattern?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  episodePattern?: string;

  @ApiPropertyOptional({ default: 15, maximum: 1440, minimum: 5 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  pollIntervalMinutes?: number;
}

export class MediaGovernanceRssIdentitySearchQueryDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  keyword: string;
}

export class MediaGovernanceRssDiscoverySearchDto extends MediaGovernanceRssIdentitySelectionDto {}

export class MediaGovernanceRssSubscriptionStateDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision: number;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class MediaGovernanceRssSubscriptionRebindDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class MediaGovernanceRssContextRepairTaskDto {
  @ApiProperty({ maxLength: 96 })
  @IsString()
  @Matches(/^media-task-[A-Za-z0-9-]{20,80}$/)
  taskId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class MediaGovernanceRssContextRepairDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision: number;

  @ApiProperty({ type: MediaGovernanceRssIdentitySelectionDto })
  @ValidateNested()
  @Type(() => MediaGovernanceRssIdentitySelectionDto)
  identity: MediaGovernanceRssIdentitySelectionDto;

  @ApiProperty({ maxLength: 96 })
  @IsString()
  @Matches(/^media-work-[A-Za-z0-9-]{20,80}$/)
  sourceWorkId: string;

  @ApiProperty({
    maxItems: 16,
    minItems: 1,
    type: [MediaGovernanceRssContextRepairTaskDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceRssContextRepairTaskDto)
  tasks: MediaGovernanceRssContextRepairTaskDto[];
}
