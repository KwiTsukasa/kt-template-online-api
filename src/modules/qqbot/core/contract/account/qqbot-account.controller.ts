import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotAccountBodyDto,
  QqbotAccountQueryDto,
  QqbotAccountUpdateDto,
} from './qqbot-account.dto';
import { QqbotAccountService } from '../../application/account/qqbot-account.service';
import { QqbotReverseWsService } from '../../infrastructure/integration/connection/qqbot-reverse-ws.service';

@ApiTags('QQBot - 账号连接')
@Controller('qqbot/account')
@UseGuards(JwtAuthGuard)
export class QqbotAccountController {
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly reverseWsService: QqbotReverseWsService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: 'QQBot 账号分页' })
  async list(@Query() query: QqbotAccountQueryDto) {
    return vbenSuccess(await this.accountService.page(query));
  }

  @Get('enabled')
  @ApiOperation({ summary: 'QQBot 可用账号' })
  async enabled() {
    return vbenSuccess(await this.accountService.allEnabled());
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 账号' })
  async save(@Body() body: QqbotAccountBodyDto) {
    return vbenSuccess(await this.accountService.save(body));
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 账号' })
  async update(@Body() body: QqbotAccountUpdateDto) {
    return vbenSuccess(await this.accountService.update(body));
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 账号' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    const account = await this.accountService.findById(id);
    if (account) await this.reverseWsService.kick(account.selfId);
    return vbenSuccess(await this.accountService.remove(id));
  }

  @Post('bind/command')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '绑定账号在线命令' })
  @ApiQuery({ name: 'selfId', type: String })
  @ApiQuery({ name: 'commandId', type: String })
  async bindCommand(
    @Query('selfId') selfId: string,
    @Query('commandId') commandId: string,
  ) {
    return vbenSuccess(
      await this.accountService.bindCommand(selfId, commandId),
    );
  }

  @Post('unbind/command')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解绑账号在线命令' })
  @ApiQuery({ name: 'selfId', type: String })
  @ApiQuery({ name: 'commandId', type: String })
  async unbindCommand(
    @Query('selfId') selfId: string,
    @Query('commandId') commandId: string,
  ) {
    return vbenSuccess(
      await this.accountService.unbindCommand(selfId, commandId),
    );
  }

  @Post('bind/rule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '绑定账号自动回复规则' })
  @ApiQuery({ name: 'selfId', type: String })
  @ApiQuery({ name: 'ruleId', type: String })
  async bindRule(
    @Query('selfId') selfId: string,
    @Query('ruleId') ruleId: string,
  ) {
    return vbenSuccess(await this.accountService.bindRule(selfId, ruleId));
  }

  @Post('unbind/rule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解绑账号自动回复规则' })
  @ApiQuery({ name: 'selfId', type: String })
  @ApiQuery({ name: 'ruleId', type: String })
  async unbindRule(
    @Query('selfId') selfId: string,
    @Query('ruleId') ruleId: string,
  ) {
    return vbenSuccess(await this.accountService.unbindRule(selfId, ruleId));
  }

  @Post('kick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '断开 QQBot 反向 WS 会话' })
  @ApiQuery({ name: 'selfId', type: String })
  async kick(@Query('selfId') selfId: string) {
    return vbenSuccess(await this.reverseWsService.kick(selfId));
  }
}
