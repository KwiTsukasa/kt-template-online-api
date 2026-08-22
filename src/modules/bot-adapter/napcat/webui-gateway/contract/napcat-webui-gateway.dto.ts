import { ApiProperty } from '@nestjs/swagger';
import type { NapcatWebuiStatus } from '@/modules/bot-adapter/core/contract/bot.types';

export class NapcatWebuiSessionCreateDto {
  @ApiProperty({ description: 'Bot account id bound to the NapCat WebUI.' })
  accountId: string;
}

export class NapcatWebuiSessionAccountDto {
  @ApiProperty({ description: 'Bot account id.' })
  id: string;

  @ApiProperty({ description: 'Bot account display name.' })
  name: string;

  @ApiProperty({ description: 'QQ self id for the account.' })
  selfId: string;
}

export class NapcatWebuiSessionContainerDto {
  @ApiProperty({
    description: 'Browser-safe WebUI availability status.',
    enum: ['offline', 'online', 'unknown'],
  })
  webuiStatus: NapcatWebuiStatus;
}

export class NapcatWebuiSessionResponseDto {
  @ApiProperty({ type: NapcatWebuiSessionAccountDto })
  account: NapcatWebuiSessionAccountDto;

  @ApiProperty({ type: NapcatWebuiSessionContainerDto })
  container: NapcatWebuiSessionContainerDto;

  @ApiProperty({
    description: 'Gateway session expiry timestamp in milliseconds.',
  })
  expiresAt: number;

  @ApiProperty({ description: 'Browser-safe iframe URL served by Gateway.' })
  iframeUrl: string;

  @ApiProperty({ description: 'Gateway session id used for lifecycle calls.' })
  sessionId: string;
}
