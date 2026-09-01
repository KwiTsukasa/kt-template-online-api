import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MEDIA_SCRAPE_VALIDATION_STATUSES = [
  'pending',
  'running',
  'healthy',
  'issues',
] as const;

export class MediaScrapeValidationPageQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo = 1;

  @ApiPropertyOptional({ maximum: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: MEDIA_SCRAPE_VALIDATION_STATUSES })
  @IsOptional()
  @IsIn(MEDIA_SCRAPE_VALIDATION_STATUSES)
  status?: (typeof MEDIA_SCRAPE_VALIDATION_STATUSES)[number];
}

export class MediaScrapeValidationRevisionDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class MediaScrapeValidationIssueDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  @Matches(/\S/)
  code: string;

  @ApiProperty({ maxLength: 400 })
  @IsString()
  @MaxLength(400)
  @Matches(/\S/)
  message: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  @Matches(/\S/)
  scope: string;

  @ApiProperty({ enum: ['error', 'warning'] })
  @IsIn(['error', 'warning'])
  severity: 'error' | 'warning';
}

export class MediaScrapeValidationResultDto extends MediaScrapeValidationRevisionDto {
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/u)
  evidenceSha256: string;

  @ApiProperty({ maxItems: 2000, type: [MediaScrapeValidationIssueDto] })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => MediaScrapeValidationIssueDto)
  issues: MediaScrapeValidationIssueDto[];

  @ApiProperty({ maxLength: 400 })
  @IsString()
  @MaxLength(400)
  @Matches(/\S/)
  summary: string;

  @ApiProperty({ enum: ['healthy', 'issues'] })
  @IsIn(['healthy', 'issues'])
  status: 'healthy' | 'issues';
}
