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
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  throwVbenError,
  TrustedCredentialTransportService,
  vbenSuccess,
} from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import {
  BotAccountBodyDto,
  BotAccountQueryDto,
  BotAccountUpdateDto,
} from '@/modules/bot-adapter/core/contract/account/bot-account.dto';
import { TencentBotMenuService } from '../application/tencent-bot-menu.service';
import { TencentBotPluginBindingService } from '../application/tencent-bot-plugin-binding.service';
import { TencentBotService } from '../infrastructure/tencent-bot.service';

@ApiTags('BotAdapter - Tencent 连接')
@Controller('bot-adapter/tencent')
@UseGuards(JwtAuthGuard)
export class TencentBotController {
  constructor(
    private readonly accountService: BotAccountService,
    private readonly menuService: TencentBotMenuService,
    private readonly pluginBindingService: TencentBotPluginBindingService,
    private readonly tencentService: TencentBotService,
    private readonly trustedCredentialTransportService: TrustedCredentialTransportService,
  ) {}

  /**
   * 分页读取 Tencent WebSocket 与 Webhook 账号，不混入 NapCat 连接。
   * @param query - 账号分页与状态筛选条件。
   * @returns Tencent 账号分页。
   */
  @Get('list')
  @ApiOperation({ summary: 'Tencent Bot 连接分页' })
  async list(@Query() query: BotAccountQueryDto) {
    return vbenSuccess(
      await this.accountService.page(query, [
        'official-websocket',
        'official-webhook',
      ]),
    );
  }

  /**
   * 返回 Tencent 双传输运行摘要，不包含任何凭据或平台用户标识。
   * @returns WebSocket 与 Webhook 运行账号计数。
   */
  @Get('runtime')
  @ApiOperation({ summary: 'Tencent Bot 运行摘要' })
  runtime() {
    return vbenSuccess(this.tencentService.getRuntimeStatus());
  }

  /**
   * 新建 Tencent 账号并立即按所选传输准备官方运行态。
   * @param body - Tencent AppID、AppSecret、传输模式和显示信息。
   * @param request - 用于校验凭据提交来源的请求。
   * @returns 新账号主键。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 Tencent Bot 连接' })
  async save(@Body() body: BotAccountBodyDto, @Req() request: Request) {
    this.trustedCredentialTransportService.assertTrusted(request);
    assertTencentMode(body.connectionMode);
    const id = await this.accountService.save(body);
    await this.tencentService.reconcileAccount(id);
    return vbenSuccess(id);
  }

  /**
   * 更新 Tencent 账号并原子重建其官方运行态。
   * @param body - 携带账号主键的 Tencent 连接配置。
   * @param request - 用于校验凭据提交来源的请求。
   * @returns 更新确认。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 Tencent Bot 连接' })
  async update(@Body() body: BotAccountUpdateDto, @Req() request: Request) {
    this.trustedCredentialTransportService.assertTrusted(request);
    assertTencentMode(body.connectionMode);
    const previous = await this.accountService.findById(body.id);
    assertTencentAccount(previous?.connectionMode);
    const updated = await this.accountService.update(body);
    await this.tencentService.reconcileAccount(body.id, previous?.selfId);
    return vbenSuccess(updated);
  }

  /**
   * 在停止官方运行态后删除指定 Tencent 连接，避免残留 WebSocket 或 Webhook 会话。
   * @param id - Tencent 内部账号主键。
   * @returns 删除结果。
   */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 Tencent Bot 连接' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    const account = await this.accountService.findById(id);
    assertTencentAccount(account?.connectionMode);
    await this.tencentService.disconnect(account!.selfId);
    return vbenSuccess(await this.accountService.remove(id));
  }

  /**
   * 重建或验证 Tencent WebSocket/Webhook 运行态。
   * @param id - Tencent 内部账号主键。
   * @returns 连接模式与重建结果。
   */
  @Post('reconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重连 Tencent Bot' })
  @ApiQuery({ name: 'id', type: String })
  async reconnect(@Query('id') id: string) {
    const account = await this.accountService.findById(id);
    assertTencentAccount(account?.connectionMode);
    return vbenSuccess(await this.tencentService.reconnect(account!.selfId));
  }

  /**
   * 返回 Webhook 模式可配置到 QQ 开放平台的完整官方回调地址。
   * @param id - Tencent 内部账号主键。
   * @returns HTTPS 回调 URL。
   */
  @Get('webhook-url')
  @ApiOperation({ summary: '读取 Tencent Webhook 回调地址' })
  @ApiQuery({ name: 'id', type: String })
  async webhookUrl(@Query('id') id: string) {
    return vbenSuccess(await this.tencentService.getWebhookUrl(id));
  }

  /**
   * 读取指定 Tencent 账号可绑定的无状态协议插件目录。
   * @param accountId - Tencent 内部账号主键。
   * @returns 插件目录及绑定状态。
   */
  @Get('plugins')
  @ApiOperation({ summary: 'Tencent Bot 插件能力绑定' })
  @ApiQuery({ name: 'accountId', type: String })
  async plugins(@Query('accountId') accountId: string) {
    return vbenSuccess(await this.pluginBindingService.list(accountId));
  }

  /**
   * 启用 Tencent 适配器插件绑定并立即幂等同步官方菜单和指令面板。
   * @param body - Tencent 账号主键与平台无关插件键。
   * @returns 绑定主键与官方菜单变更摘要。
   */
  @Post('plugins/bind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '绑定 Tencent Bot 插件' })
  async bindPlugin(@Body() body: { accountId: string; pluginKey: string }) {
    const bindingId = await this.pluginBindingService.bind(
      body.accountId,
      body.pluginKey,
    );
    const menuSync = await this.menuService.sync(body.accountId);
    return vbenSuccess({ bindingId, menuSync });
  }

  /**
   * 停用 Tencent 适配器插件绑定并立即从官方菜单和指令面板撤销其能力。
   * @param body - Tencent 账号主键与平台无关插件键。
   * @returns 解绑确认与官方菜单变更摘要。
   */
  @Post('plugins/unbind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解绑 Tencent Bot 插件' })
  async unbindPlugin(@Body() body: { accountId: string; pluginKey: string }) {
    await this.pluginBindingService.unbind(body.accountId, body.pluginKey);
    const menuSync = await this.menuService.sync(body.accountId);
    return vbenSuccess({ menuSync, unbound: true });
  }

  /**
   * 手动按当前适配器绑定重建 Tencent 官方菜单，用于恢复外部漂移且重复调用无副作用。
   * @param accountId - Tencent 内部账号主键。
   * @returns 官方菜单变更摘要。
   */
  @Post('menu/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '同步 Tencent 官方菜单' })
  @ApiQuery({ name: 'accountId', type: String })
  async syncMenu(@Query('accountId') accountId: string) {
    return vbenSuccess(await this.menuService.sync(accountId));
  }
}

/**
 * 校验待保存连接模式属于 Tencent WebSocket 或 Webhook。
 * @param connectionMode - 表单提交的连接模式。
 * @throws 非 Tencent 模式时抛出业务错误。
 */
function assertTencentMode(connectionMode: string) {
  assertTencentAccount(connectionMode);
}

/**
 * 校验现有账号连接模式属于 Tencent 适配器。
 * @param connectionMode - 现有或待保存账号的连接模式。
 * @throws 账号缺失或属于 NapCat 时抛出业务错误。
 */
function assertTencentAccount(connectionMode?: null | string) {
  if (
    connectionMode !== 'official-websocket' &&
    connectionMode !== 'official-webhook'
  ) {
    throwVbenError('所选账号不是 Tencent Bot 连接');
  }
}
