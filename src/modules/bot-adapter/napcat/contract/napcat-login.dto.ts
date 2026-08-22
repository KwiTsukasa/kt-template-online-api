import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NapcatScanStatusDto {
  @ApiProperty()
  sessionId: string;
}

export class NapcatScanCaptchaDto extends NapcatScanStatusDto {
  @ApiProperty()
  randstr: string;

  @ApiPropertyOptional()
  sid?: string;

  @ApiProperty()
  ticket: string;
}
