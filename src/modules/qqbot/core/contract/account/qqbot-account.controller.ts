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

@ApiTags('QQBot - 账号连接')
@Controller('qqbot/account')
@UseGuards(JwtAuthGuard)
export class QqbotAccountController {
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly reverseWsService: QqbotReverseWsService,
    private readonly trustedCredentialTransportService: TrustedCredentialTransportService,
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
    return vbenSuccess(await this.accountService.save(body));
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
    return vbenSuccess(await this.accountService.update(body));
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
    if (account) await this.reverseWsService.kick(account.selfId);
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
      await this.accountService.bindCommand(selfId, commandId),
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
    return vbenSuccess(await this.reverseWsService.kick(selfId));
  }
}
