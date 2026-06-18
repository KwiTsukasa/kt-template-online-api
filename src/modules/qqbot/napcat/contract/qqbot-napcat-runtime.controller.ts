import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { NapcatRuntimeProfileInspectorService } from '../application/runtime/napcat-runtime-profile-inspector.service';
import { QqbotNapcatRuntimeDetailQueryDto } from './qqbot-napcat-runtime.dto';

@ApiTags('QQBot - NapCat 运行态')
@Controller('qqbot/napcat/runtime')
@UseGuards(JwtAuthGuard)
export class QqbotNapcatRuntimeController {
  /**
   * Creates the read-only runtime evidence controller for Admin.
   * @param inspector - Service that loads and redacts NapCat runtime/profile evidence before response serialization.
   */
  constructor(
    private readonly inspector: NapcatRuntimeProfileInspectorService,
  ) {}

  /**
   * Reads sanitized NapCat runtime and protocol profile evidence for one QQBot account.
   * @param query - Query object carrying the account id selected from the Admin account list.
   * @returns Vben response wrapper containing only sanitized read-only runtime evidence.
   */
  @Get('detail')
  @ApiOperation({ summary: '查询 NapCat 运行态与协议 Profile 证据' })
  async detail(@Query() query: QqbotNapcatRuntimeDetailQueryDto) {
    return vbenSuccess(
      await this.inspector.getAccountRuntimeDetail(query.accountId),
    );
  }
}
