import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QqbotNapcatScanStatusDto {
  @ApiProperty()
  sessionId: string;
}

export class QqbotNapcatScanCaptchaDto extends QqbotNapcatScanStatusDto {
  @ApiProperty()
  randstr: string;

  @ApiPropertyOptional()
  sid?: string;

  @ApiProperty()
  ticket: string;
}
