import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  MediaCodexAgentStage,
  MediaCodexAgentTurnRequest,
} from '../domain/media-codex-agent.contract';

const STAGES: MediaCodexAgentStage[] = [
  'acceptance',
  'closed',
  'download',
  'governance',
  'intake',
  'metadata',
];

export class MediaCodexAgentTurnRequestDto implements MediaCodexAgentTurnRequest {
  @IsOptional()
  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  clientMessageId?: string;

  @IsObject()
  compactContext: Record<string, unknown>;

  @IsIn(STAGES)
  currentStage: MediaCodexAgentStage;

  @IsOptional()
  @IsString()
  @MaxLength(96)
  currentUnitId: null | string;

  @Matches(/^[a-f0-9]{64}$/)
  manifestSha256: string;

  @IsString()
  @MaxLength(4_000)
  @Matches(/\S/)
  operatorCommand: string;

  @IsOptional()
  @IsIn(['restart-failed-turn'])
  recoveryMode?: 'restart-failed-turn';

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  replayKey: string;

  @IsString()
  @MaxLength(96)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/)
  taskId: string;

  @IsInt()
  @Min(1)
  taskRevision: number;
}

export class MediaCodexAgentSessionQueryDto {
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
