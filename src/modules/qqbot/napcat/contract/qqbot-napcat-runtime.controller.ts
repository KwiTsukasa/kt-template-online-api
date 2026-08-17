import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { NapcatRuntimeProfileInspectorService } from '../application/runtime/napcat-runtime-profile-inspector.service';
import { QqbotNapcatRuntimeDetailQueryDto } from './qqbot-napcat-runtime.dto';

@ApiTags('QQBot - NapCat 运行态')
@Controller('qqbot/napcat/runtime')
@UseGuards(JwtAuthGuard)
export class QqbotNapcatRuntimeController {
  constructor(
    private readonly inspector: NapcatRuntimeProfileInspectorService,
  ) {}

  /** 返回详情。 */
  @Get('detail')
  @ApiOperation({ summary: '查询 NapCat 运行态与协议 Profile 证据' })
  async detail(@Query() query: QqbotNapcatRuntimeDetailQueryDto) {
    return vbenSuccess(
      await this.inspector.getAccountRuntimeDetail(query.accountId),
    );
  }
}
