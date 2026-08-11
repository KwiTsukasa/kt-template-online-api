import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
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
  @MaxLength(2000)
  @Matches(/\S/)
  operatorCommand: string;

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
