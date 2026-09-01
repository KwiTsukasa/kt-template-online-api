import { IsOptional, IsString, Length, Matches } from 'class-validator';

const SAFE_MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;
const SAFE_THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export class LlmCodexChatStreamDto {
  @IsString()
  @Matches(SAFE_MESSAGE_ID_PATTERN)
  clientMessageId: string;

  @IsString()
  @Length(1, 200)
  model: string;

  @IsString()
  @Length(1, 20000)
  prompt: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  reasoningEffort?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  serviceTier?: string;

  @IsOptional()
  @IsString()
  @Matches(SAFE_THREAD_ID_PATTERN)
  threadId?: string;
}
