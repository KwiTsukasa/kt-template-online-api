import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { TrustedCredentialTransportService, vbenSuccess } from '@/common';
import {
  QqbotAccountBodyDto,
  QqbotAccountQueryDto,
  QqbotAccountUpdateDto,
} from './qqbot-account.dto';
import { QqbotAccountService } from '../../application/account/qqbot-account.service';
import { QqbotReverseWsService } from '../../infrastructure/integration/connection/qqbot-reverse-ws.service';
import { QqbotOfficialService } from '../../infrastructure/integration/connection/qqbot-official.service';
import { QqbotCommandService } from '../../application/command/qqbot-command.service';

@ApiTags('QQBot - 账号连接')
@Controller('qqbot/account')
@UseGuards(JwtAuthGuard)
export class QqbotAccountController {
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly officialService: QqbotOfficialService,
    private readonly reverseWsService: QqbotReverseWsService,
    private readonly trustedCredentialTransportService: TrustedCredentialTransportService,
    private readonly commandService: QqbotCommandService,
  ) {}

  /**
   * 按查询条件读取 QQBot 账号分页，并封装为 Vben 成功响应。
   * @param query - 限定`list` 对应结果筛选、排序与分页范围的查询条件。
   * @returns `list` 对应。
   */
  @Get('list')
  @ApiOperation({ summary: 'QQBot 账号分页' })
  async list(@Query() query: QqbotAccountQueryDto) {
    return vbenSuccess(await this.accountService.page(query));
  }

  /**
   * 按当前运行态启动QQBot 可用账号。
   * @returns QQBot 可用账号。
   */
  @Get('enabled')
  @ApiOperation({ summary: 'QQBot 可用账号' })
  async enabled() {
    return vbenSuccess(await this.accountService.allEnabled());
  }

  /**
   * 根据`body`、`request`更新`save` 对应结果；先通过 `trustedCredentialTransportService.assertTrusted` 校验输入边界。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @param request - 用于`save` 对应结果的当前 HTTP 请求。
   * @returns `save` 对应。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 账号' })
  async save(@Body() body: QqbotAccountBodyDto, @Req() request: Request) {
    this.trustedCredentialTransportService.assertTrusted(request);
    const id = await this.accountService.save(body);
    await this.officialService.reconcileAccount(id);
    return vbenSuccess(id);
  }

  /**
   * 根据`body`、`request`更新`update` 对应结果；先通过 `trustedCredentialTransportService.assertTrusted` 校验输入边界。
   * @param body - 用于`update` 对应结果的结构化输入。
   * @param request - 用于`update` 对应结果的当前 HTTP 请求。
   * @returns `update` 对应。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 账号' })
  async update(@Body() body: QqbotAccountUpdateDto, @Req() request: Request) {
    this.trustedCredentialTransportService.assertTrusted(request);
    const previous = await this.accountService.findById(body.id);
    const updated = await this.accountService.update(body);
    await this.officialService.reconcileAccount(body.id, previous?.selfId);
    return vbenSuccess(updated);
  }

  /**
   * 按账号标识确认记录存在后断开对应反向 WebSocket，再删除 QQBot 账号并封装为 Vben 成功响应。
   * @param id - 决定`delete` 对应结果内容、边界或目标的 `id` 值。
   * @returns `delete` 对应。
   */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 账号' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    const account = await this.accountService.findById(id);
    if (account?.connectionMode === 'reverse-ws') {
      await this.reverseWsService.kick(account.selfId);
    }
    if (account && account.connectionMode !== 'reverse-ws') {
      await this.officialService.disconnect(account.selfId);
    }
    return vbenSuccess(await this.accountService.remove(id));
  }

  /**
   * 根据参数 `selfId`，绑定账号在线命令。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param commandId - 用于精确定位命令的标识。
   * @returns 根据参数 `selfId`，绑定账号在线命令。
   */
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
      await this.commandService.bindAccountCommand(selfId, commandId),
    );
  }

  /**
   * 按`selfId`、`commandId`移除针对账号在线命令。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param commandId - 用于精确定位命令的标识。
   * @returns 针对账号在线命令。
   */
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

  /**
   * 根据参数 `selfId`，绑定账号自动回复规则。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param ruleId - 用于精确定位权限规则的标识。
   * @returns 根据参数 `selfId`，绑定账号自动回复规则。
   */
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

  /**
   * 按`selfId`、`ruleId`移除针对账号自动回复规则。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param ruleId - 用于精确定位权限规则的标识。
   * @returns 针对账号自动回复规则。
   */
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

  /**
   * 根据`selfId`处理断开 QQBot 反向 WS 会话。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 断开 QQBot 反向 WS 会话。
   */
  @Post('kick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '断开 QQBot 反向 WS 会话' })
  @ApiQuery({ name: 'selfId', type: String })
  async kick(@Query('selfId') selfId: string) {
    const account = await this.accountService.findBySelfId(selfId);
    if (account && account.connectionMode !== 'reverse-ws') {
      return vbenSuccess(await this.officialService.disconnect(selfId));
    }
    return vbenSuccess(await this.reverseWsService.kick(selfId));
  }

  /**
   * 重新准备 QQ 官方账号：WebSocket 重建 Gateway，Webhook 重新验证凭据并返回回调地址。
   * @param selfId - `qq-official:<AppID>` 稳定账号键。
   * @returns 官方账号重建结果。
   */
  @Post('official/reconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重连或验证 QQ 官方 Bot' })
  @ApiQuery({ name: 'selfId', type: String })
  async reconnectOfficial(@Query('selfId') selfId: string) {
    return vbenSuccess(await this.officialService.reconnect(selfId));
  }

  /**
   * 读取 Webhook 模式官方账号的完整公网 HTTPS 回调地址，供复制到 QQ 开放平台。
   * @param id - QQBot 账号数据库主键。
   * @returns 包含完整回调 URL 的安全响应。
   */
  @Get('official/webhook-url')
  @ApiOperation({ summary: '读取 QQ 官方 Bot Webhook 回调地址' })
  @ApiQuery({ name: 'id', type: String })
  async officialWebhookUrl(@Query('id') id: string) {
    return vbenSuccess(await this.officialService.getWebhookUrl(id));
  }
}
