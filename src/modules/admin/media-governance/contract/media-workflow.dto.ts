import { IsString, Matches, IsObject, MaxLength } from 'class-validator';

export class MediaWorkflowCancelDto {
  @IsString() @Matches(/^\d{1,20}$/) runId: string;
}

export class MediaWorkflowEnvelopeDto {
  @IsString() @Matches(/^media-run-[a-f0-9]{48}$/) mediaRunId: string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/) taskId: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) sealedInputSha256: string;
  @IsString()
  @Matches(/^workflow:[A-Za-z0-9:._-]{1,150}$/)
  executionKey: string;
}

export class MediaWorkflowHumanSubmitDto {
  @IsString() @Matches(/^\d{1,20}$/) runId: string;
  @IsString() @MaxLength(191) executionId: string;
  @IsObject() values: Record<string, unknown>;
}
