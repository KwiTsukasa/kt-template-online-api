import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  BOT_PLUGIN_PROTOCOL,
  type BotPluginProtocol,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import {
  throwVbenError,
  TrustedCredentialTransportService,
  vbenSuccess,
} from '@/common';
import {
  BotAccountBodyDto,
  BotAccountQueryDto,
  BotAccountUpdateDto,
} from './bot-account.dto';
import { BotAccountService } from '../../application/account/bot-account.service';
import { BotReverseWsService } from '../../infrastructure/integration/connection/bot-reverse-ws.service';
import { BotCommandService } from '../../application/command/bot-command.service';

@ApiTags('BotAdapter - NapCat 连接')
@Controller('bot-adapter/napcat/account')
@UseGuards(JwtAuthGuard)
export class BotAccountController {
  constructor(
    private readonly accountService: BotAccountService,
    private readonly reverseWsService: BotReverseWsService,
    private readonly trustedCredentialTransportService: TrustedCredentialTransportService,
    private readonly commandService: BotCommandService,
    @Inject(BOT_PLUGIN_PROTOCOL)
    private readonly pluginProtocol: BotPluginProtocol,
  ) {}

  /**
   * 按查询条件读取 Bot 账号分页，并封装为 Vben 成功响应。
   * @param query - 限定`list` 对应结果筛选、排序与分页范围的查询条件。
   * @returns `list` 对应。
   */
  @Get('list')
  @ApiOperation({ summary: 'Bot 账号分页' })
  async list(@Query() query: BotAccountQueryDto) {
    return vbenSuccess(await this.accountService.page(query, ['reverse-ws']));
  }

  /**
   * 按当前运行态启动Bot 可用账号。
   * @returns Bot 可用账号。
   */
  @Get('enabled')
  @ApiOperation({ summary: 'Bot 可用账号' })
  async enabled() {
    return vbenSuccess(await this.accountService.allEnabled(['reverse-ws']));
  }

  /**
   * 根据`body`、`request`更新`save` 对应结果；先通过 `trustedCredentialTransportService.assertTrusted` 校验输入边界。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @param request - 用于`save` 对应结果的当前 HTTP 请求。
   * @returns `save` 对应。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 Bot 账号' })
  async save(@Body() body: BotAccountBodyDto, @Req() request: Request) {
    this.trustedCredentialTransportService.assertTrusted(request);
    assertNapcatMode(body.connectionMode);
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
  @ApiOperation({ summary: '编辑 Bot 账号' })
  async update(@Body() body: BotAccountUpdateDto, @Req() request: Request) {
    this.trustedCredentialTransportService.assertTrusted(request);
    const previous = await this.accountService.findById(body.id);
    assertNapcatMode(previous?.connectionMode);
    assertNapcatMode(body.connectionMode);
    return vbenSuccess(await this.accountService.update(body));
  }

  /**
   * 按账号标识确认记录存在后断开对应反向 WebSocket，再删除 Bot 账号并封装为 Vben 成功响应。
   * @param id - 决定`delete` 对应结果内容、边界或目标的 `id` 值。
   * @returns `delete` 对应。
   */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 Bot 账号' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    const account = await this.accountService.findById(id);
    assertNapcatMode(account?.connectionMode);
    await this.reverseWsService.kick(account!.selfId);
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
   * 将协议层插件目录与指定 NapCat 账号自己的事件插件绑定合并后返回。
   * @param selfId - NapCat 当前登录账号标识。
   * @returns 协议插件及 NapCat 绑定状态。
   */
  @Get('plugins')
  @ApiOperation({ summary: 'NapCat 插件能力绑定' })
  @ApiQuery({ name: 'selfId', type: String })
  async plugins(@Query('selfId') selfId: string) {
    const account = await this.accountService.findBySelfId(selfId);
    assertNapcatMode(account?.connectionMode);
    const [plugins, boundKeys] = await Promise.all([
      this.pluginProtocol.listPlugins(),
      this.accountService.getBoundEventPluginKeys(selfId),
    ]);
    const bound = new Set(boundKeys);
    return vbenSuccess(
      plugins.map((plugin) => ({
        accountName: account!.name,
        bound: bound.has(plugin.key),
        connectStatus: account!.connectStatus,
        description: plugin.description,
        key: plugin.key,
        name: plugin.name,
        selfId,
        triggerType: 'message' as const,
        version: plugin.version,
      })),
    );
  }

  /**
   * 将协议插件授权写入 NapCat 适配器能力，并确保插件平台不接触账号状态。
   * @param body - NapCat 账号标识与平台无关插件键。
   * @returns 固定返回 true。
   */
  @Post('plugins/bind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '绑定 NapCat 插件' })
  async bindPlugin(@Body() body: { pluginKey: string; selfId: string }) {
    const account = await this.accountService.findBySelfId(body.selfId);
    assertNapcatMode(account?.connectionMode);
    const plugins = await this.pluginProtocol.listPlugins();
    if (!plugins.some((plugin) => plugin.key === body.pluginKey)) {
      throwVbenError(`插件协议未启用：${body.pluginKey}`);
    }
    return vbenSuccess(
      await this.accountService.bindEventPlugin(body.selfId, body.pluginKey),
    );
  }

  /**
   * 将 NapCat 适配器的事件插件能力停用，同时保留插件平台的无状态目录。
   * @param body - NapCat 账号标识与平台无关插件键。
   * @returns 固定返回 true。
   */
  @Post('plugins/unbind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解绑 NapCat 插件' })
  async unbindPlugin(@Body() body: { pluginKey: string; selfId: string }) {
    const account = await this.accountService.findBySelfId(body.selfId);
    assertNapcatMode(account?.connectionMode);
    return vbenSuccess(
      await this.accountService.unbindEventPlugin(body.selfId, body.pluginKey),
    );
  }

  /**
   * 根据`selfId`处理断开 Bot 反向 WS 会话。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 断开 Bot 反向 WS 会话。
   */
  @Post('kick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '断开 Bot 反向 WS 会话' })
  @ApiQuery({ name: 'selfId', type: String })
  async kick(@Query('selfId') selfId: string) {
    const account = await this.accountService.findBySelfId(selfId);
    assertNapcatMode(account?.connectionMode);
    return vbenSuccess(await this.reverseWsService.kick(selfId));
  }
}

/**
 * 校验账号连接模式严格属于 NapCat 反向 WebSocket，阻止旧接口继续混入 Tencent 账号。
 * @param connectionMode - 待保存或已读取账号的连接模式。
 * @throws 账号缺失或不是 NapCat 时抛出业务错误。
 */
function assertNapcatMode(connectionMode?: null | string) {
  if (connectionMode !== 'reverse-ws') {
    throwVbenError('所选账号不是 NapCat 连接');
  }
}
