import { ApiProperty } from '@nestjs/swagger';
import type { QqbotNapcatWebuiStatus } from '@/modules/qqbot/core/contract/qqbot.types';

export class QqbotNapcatWebuiSessionCreateDto {
  @ApiProperty({ description: 'QQBot account id bound to the NapCat WebUI.' })
  accountId: string;
}

export class QqbotNapcatWebuiSessionAccountDto {
  @ApiProperty({ description: 'QQBot account id.' })
  id: string;

  @ApiProperty({ description: 'QQBot account display name.' })
  name: string;

  @ApiProperty({ description: 'QQ self id for the account.' })
  selfId: string;
}

export class QqbotNapcatWebuiSessionContainerDto {
  @ApiProperty({ description: 'NapCat container id.' })
  id: string;

  @ApiProperty({ description: 'NapCat container name.' })
  name: string;

  @ApiProperty({
    description: 'Browser-safe WebUI availability status.',
    enum: ['offline', 'online', 'unknown'],
  })
  webuiStatus: QqbotNapcatWebuiStatus;
}

export class QqbotNapcatWebuiSessionResponseDto {
  @ApiProperty({ type: QqbotNapcatWebuiSessionAccountDto })
  account: QqbotNapcatWebuiSessionAccountDto;

  @ApiProperty({ type: QqbotNapcatWebuiSessionContainerDto })
  container: QqbotNapcatWebuiSessionContainerDto;

  @ApiProperty({ description: 'Gateway session expiry time in ISO format.' })
  expiresAt: string;

  @ApiProperty({ description: 'Browser-safe iframe URL served by Gateway.' })
  iframeUrl: string;

  @ApiProperty({ description: 'Gateway session id used for lifecycle calls.' })
  sessionId: string;
}
