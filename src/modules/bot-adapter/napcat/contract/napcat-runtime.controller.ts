import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { throwVbenError, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import { NapcatRuntimeProfileInspectorService } from '../application/runtime/napcat-runtime-profile-inspector.service';
import { NapcatRuntimeDetailQueryDto } from './napcat-runtime.dto';

@ApiTags('Bot - NapCat 运行态')
@Controller('bot-adapter/napcat/runtime')
@UseGuards(JwtAuthGuard)
export class NapcatRuntimeController {
  constructor(
    private readonly accountService: BotAccountService,
    private readonly inspector: NapcatRuntimeProfileInspectorService,
  ) {}

  /**
   * 查询领域服务并组装管理端详情。
   * @param query - 限定详情筛选、排序与分页范围的查询条件，包含 `accountId` 字段。
   * @returns 详情。
   */
  @Get('detail')
  @ApiOperation({ summary: '查询 NapCat 运行态与协议 Profile 证据' })
  async detail(@Query() query: NapcatRuntimeDetailQueryDto) {
    const account = await this.accountService.findById(query.accountId);
    if (
      !account ||
      (account.connectionMode || 'reverse-ws') !== 'reverse-ws'
    ) {
      throwVbenError('NapCat 账号不存在');
    }
    return vbenSuccess(
      await this.inspector.getAccountRuntimeDetail(query.accountId),
    );
  }
}
