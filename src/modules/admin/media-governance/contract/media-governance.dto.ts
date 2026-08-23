import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MEDIA_GOVERNANCE_EXECUTOR_ACTIONS,
  type MediaGovernanceExecutorAction,
} from './media-governance-executor.contract';
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
export const MEDIA_GOVERNANCE_SELECTED_FILE_ROLES = [
  'font',
  'subtitle',
  'video',
] as const;
export const MEDIA_GOVERNANCE_SUBTITLE_LANGUAGES = [
  'en',
  'ja',
  'zh-CN',
  'zh-TW',
] as const;

export type MediaGovernanceMediaType =
  (typeof MEDIA_GOVERNANCE_MEDIA_TYPES)[number];
export type MediaGovernanceProvider =
  (typeof MEDIA_GOVERNANCE_PROVIDERS)[number];
export type MediaGovernanceContentKind =
  (typeof MEDIA_GOVERNANCE_CONTENT_KINDS)[number];
export type MediaGovernanceSourceRole =
  (typeof MEDIA_GOVERNANCE_SOURCE_ROLES)[number];
export type MediaGovernanceSelectedFileRole =
  (typeof MEDIA_GOVERNANCE_SELECTED_FILE_ROLES)[number];
export type MediaGovernanceSubtitleLanguage =
  (typeof MEDIA_GOVERNANCE_SUBTITLE_LANGUAGES)[number];

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

  @ApiPropertyOptional({
    description:
      '与现行本地权威媒体账本绑定的内部作品编号；新任务省略时会在首次本地治理前自动分配',
    example: 'media-063',
  })
  @IsOptional()
  @Matches(/^media-\d{3}$/)
  workItemId?: string;
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

  @ApiPropertyOptional({
    description: '按作品名或任务编号模糊查找',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

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

export class MediaGovernanceTaskIdentityUpdateDto extends MediaGovernanceRevisionCommandDto {
  @ApiPropertyOptional({ enum: MEDIA_GOVERNANCE_MEDIA_TYPES })
  @IsOptional()
  @IsIn(MEDIA_GOVERNANCE_MEDIA_TYPES)
  mediaType?: MediaGovernanceMediaType;

  @ApiPropertyOptional({
    description: '修正后的 TV 季号；电影或剧场版传空数组',
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
    description: '媒体资料库唯一作品编号，填错会关联到另一部作品',
    nullable: true,
    type: MediaGovernanceProviderRefDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaGovernanceProviderRefDto)
  providerRef?: MediaGovernanceProviderRefDto | null;

  @ApiPropertyOptional({
    description: '首播或上映年份，用于缩小同名作品候选范围',
    maximum: MAX_RELEASE_YEAR,
    minimum: 1888,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1888)
  @Max(MAX_RELEASE_YEAR)
  releaseYear?: number | null;

  @ApiPropertyOptional({
    description: '下载前可修正的作品展示名称',
    maxLength: 200,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  titleHint?: string;
}

export class MediaGovernanceCatalogIdentityRestoreDto extends MediaGovernanceRevisionCommandDto {
  @ApiProperty({
    description: '从密封历史目录恢复的用户主资料库编号',
    type: MediaGovernanceProviderRefDto,
  })
  @ValidateNested()
  @Type(() => MediaGovernanceProviderRefDto)
  providerRef: MediaGovernanceProviderRefDto;

  @ApiProperty({
    description: '从密封历史目录恢复的首播或上映年份',
    maximum: MAX_RELEASE_YEAR,
    minimum: 1888,
  })
  @IsInt()
  @Min(1888)
  @Max(MAX_RELEASE_YEAR)
  releaseYear: number;
}

export class MediaGovernanceDescriptorRedeemDto {
  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  descriptorGrantId: string;

  @Matches(/^[a-f0-9]{64}$/)
  descriptorSha256: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  runId: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  sourceId: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;
}

export class MediaGovernancePlanRedeemDto {
  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  planGrantId: string;

  @Matches(/^[a-f0-9]{64}$/)
  planSha256: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  runId: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;
}

export const MEDIA_GOVERNANCE_EXECUTOR_EVENT_TYPES = [
  'run-started',
  'source-inspected',
  'source-probed',
  'peer-progress',
  'download-progress',
  'governance-progress',
  'run-paused',
  'run-resumed',
  'run-succeeded',
  'run-failed',
] as const;

export class MediaGovernanceExecutorManifestEntryDto {
  @IsBoolean()
  executable: false;

  @IsInt()
  @Min(0)
  index: number;

  @IsString()
  @MaxLength(1_024)
  @Matches(/^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/)
  relativePath: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes: number;
}

export class MediaGovernanceExecutorPayloadFileDto {
  @IsInt()
  @Min(0)
  index: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  mtimeMs: number;

  @IsString()
  @MaxLength(2_048)
  @Matches(/^\/vol2\/1000\/\.kt-media-governance-staging\//)
  path: string;

  @IsString()
  @MaxLength(1_024)
  @Matches(/^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/)
  relativePath: string;

  @Matches(/^[a-f0-9]{64}$/)
  sha256: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes: number;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  sourceId: string;
}

export class MediaGovernanceExecutorProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  completedBytes: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  completedItems: number;

  @IsString()
  @MaxLength(160)
  etaLabel: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  speedBytesPerSecond: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalBytes: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalItems: number;
}

export class MediaGovernanceExecutorWriteBoundariesDto {
  @IsInt()
  @Min(0)
  cloud: number;

  @IsInt()
  @Min(0)
  databaseDirect: number;

  @IsInt()
  @Min(0)
  mechanicalScan: number;

  @IsInt()
  @Min(0)
  ui: number;
}

export class MediaGovernanceExecutorMetadataUnitDto {
  @IsBoolean()
  accepted: boolean;

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  missingA: string[];

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  missingB: string[];

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  missingC: string[];

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  unitId: string;
}

export class MediaGovernanceExecutorMetadataIdentityDto {
  @IsIn(MEDIA_GOVERNANCE_PROVIDERS)
  provider: MediaGovernanceProvider;

  @IsString()
  @Matches(PROVIDER_ID_PATTERN)
  providerId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerTitle?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1870)
  @Max(MAX_RELEASE_YEAR)
  releaseYear?: null | number;
}

export class MediaGovernanceExecutorMetadataDto {
  @IsBoolean()
  canAccept: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaGovernanceExecutorMetadataIdentityDto)
  identity?: MediaGovernanceExecutorMetadataIdentityDto;

  @IsInt()
  @Min(0)
  @Max(2)
  repairAttempts: number;

  @IsIn(['media-admin-metadata-verification-v1'])
  schemaVersion: 'media-admin-metadata-verification-v1';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceExecutorMetadataUnitDto)
  units: MediaGovernanceExecutorMetadataUnitDto[];

  @ValidateNested()
  @Type(() => MediaGovernanceExecutorWriteBoundariesDto)
  writeBoundaries: MediaGovernanceExecutorWriteBoundariesDto;
}

export class MediaGovernanceExecutorAcceptanceDto {
  @IsInt()
  @Min(0)
  acceptedFiles: number;

  @IsInt()
  @Min(1)
  acceptedUnits: number;

  @IsInt()
  @Min(0)
  activeDownloadOwners: number;

  @IsBoolean()
  canClose: boolean;

  @IsInt()
  @Min(0)
  cloudWrites: number;

  @IsInt()
  @Min(0)
  databaseDirectWrites: number;

  @IsInt()
  @Min(0)
  mechanicalScans: number;

  @IsIn(['media-admin-local-acceptance-v1'])
  schemaVersion: 'media-admin-local-acceptance-v1';

  @IsInt()
  @Min(0)
  stagingResiduals: number;

  @IsInt()
  @Min(0)
  uiWrites: number;
}

export class MediaGovernanceExecutorEventDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaGovernanceExecutorAcceptanceDto)
  acceptance?: MediaGovernanceExecutorAcceptanceDto;

  @IsIn(MEDIA_GOVERNANCE_EXECUTOR_ACTIONS)
  action: MediaGovernanceExecutorAction;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  evidenceSha256?: string;

  @IsIn(MEDIA_GOVERNANCE_EXECUTOR_EVENT_TYPES)
  eventType: (typeof MEDIA_GOVERNANCE_EXECUTOR_EVENT_TYPES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20_000)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceExecutorManifestEntryDto)
  manifest?: MediaGovernanceExecutorManifestEntryDto[];

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  manifestSha256?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaGovernanceExecutorMetadataDto)
  metadata?: MediaGovernanceExecutorMetadataDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20_000)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceExecutorPayloadFileDto)
  payloadFiles?: MediaGovernanceExecutorPayloadFileDto[];

  @IsString()
  @MaxLength(64)
  observedAt: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaGovernanceExecutorProgressDto)
  progress?: MediaGovernanceExecutorProgressDto;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  runId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence: number;

  @IsOptional()
  @IsIn([
    'download_stalled',
    'insufficient_throughput',
    'local_connectivity_degraded',
    'magnet_metadata_unavailable',
    'no_complete_peer',
    'partial_availability',
    'source_runtime_available',
    'source_runtime_unavailable',
    'tracker_auth_failed',
    'tracker_unreachable',
  ])
  sourceHealthReason?: string;

  @IsOptional()
  @IsIn(['degraded', 'inconclusive', 'unavailable', 'viable'])
  sourceHealth?: 'degraded' | 'inconclusive' | 'unavailable' | 'viable';

  @IsOptional()
  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  sourceId?: string;

  @IsString()
  @MaxLength(400)
  @Matches(/\S/)
  summary: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskRevision: number;
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
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    return [value];
  })
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

export class MediaGovernanceSelectedFileMappingDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  index: number;

  @ApiProperty({ enum: MEDIA_GOVERNANCE_SELECTED_FILE_ROLES })
  @IsIn(MEDIA_GOVERNANCE_SELECTED_FILE_ROLES)
  fileRole: MediaGovernanceSelectedFileRole;

  @ApiProperty({ maxLength: 96 })
  @IsString()
  @MaxLength(96)
  @Matches(/\S/)
  unitId: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  episodeNumber?: number;

  @ApiPropertyOptional({ enum: MEDIA_GOVERNANCE_SUBTITLE_LANGUAGES })
  @IsOptional()
  @IsIn(MEDIA_GOVERNANCE_SUBTITLE_LANGUAGES)
  language?: MediaGovernanceSubtitleLanguage;
}

export class MediaGovernanceSourceSelectionDto extends MediaGovernanceRevisionCommandDto {
  @ApiProperty({ maxItems: 20000, minItems: 1, type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20000)
  @IsInt({ each: true })
  @Min(0, { each: true })
  selectedFileIndices: number[];

  @ApiProperty({
    maxItems: 20000,
    minItems: 1,
    type: [MediaGovernanceSelectedFileMappingDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => MediaGovernanceSelectedFileMappingDto)
  fileMappings: MediaGovernanceSelectedFileMappingDto[];
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

export class MediaGovernanceAgentSessionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSequence = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 200;
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

export class MediaGovernanceLlmConversationContextDto {
  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/)
  clientMessageId: string;

  @IsString()
  @MaxLength(20_000)
  @Matches(/\S/)
  content: string;

  @IsString()
  @Matches(/^[1-9]\d{0,23}$/)
  conversationId: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/)
  conversationTurnId: string;

  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  model: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/)
  providerThreadId: null | string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;
}

export class MediaGovernanceLlmConversationResultDto {
  @IsString()
  @Matches(/^[1-9]\d{0,23}$/)
  conversationId: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/)
  conversationTurnId: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/)
  providerThreadId: string;

  @IsObject()
  result: Record<string, unknown>;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;
}

export class MediaGovernanceLlmProviderThreadBindDto {
  @IsString()
  @Matches(/^[1-9]\d{0,23}$/)
  conversationId: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/)
  conversationTurnId: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/)
  expectedProviderThreadId: null | string;

  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/)
  providerThreadId: string;

  @IsOptional()
  @IsBoolean()
  replaceProviderThread?: boolean;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;
}
