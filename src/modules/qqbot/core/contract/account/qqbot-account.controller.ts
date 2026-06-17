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
  /**
   * 初始化 QqbotAccountController 实例。
   * @param accountService - accountService 服务依赖；影响 constructor 的返回值。
   * @param reverseWsService - reverseWsService 服务依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly reverseWsService: QqbotReverseWsService,
  ) {}

  /**
   * QQBot 账号分页。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  @Get('list')
  @ApiOperation({ summary: 'QQBot 账号分页' })
  async list(@Query() query: QqbotAccountQueryDto) {
    return vbenSuccess(await this.accountService.page(query));
  }

  /**
   * QQBot 可用账号。
   */
  @Get('enabled')
  @ApiOperation({ summary: 'QQBot 可用账号' })
  async enabled() {
    return vbenSuccess(await this.accountService.allEnabled());
  }

  /**
   * 新增 QQBot 账号。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 账号' })
  async save(@Body() body: QqbotAccountBodyDto) {
    return vbenSuccess(await this.accountService.save(body));
  }

  /**
   * 编辑 QQBot 账号。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 账号' })
  async update(@Body() body: QqbotAccountUpdateDto) {
    return vbenSuccess(await this.accountService.update(body));
  }

  /**
   * 删除 QQBot 账号。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
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
   * 绑定账号在线命令。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param commandId - 命令 ID；定位本次读取、更新、删除或关联的命令。
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
   * 解绑账号在线命令。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param commandId - 命令 ID；定位本次读取、更新、删除或关联的命令。
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
   * 绑定账号自动回复规则。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param ruleId - QQBot ID；定位本次读取、更新、删除或关联的QQBot。
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
   * 解绑账号自动回复规则。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param ruleId - QQBot ID；定位本次读取、更新、删除或关联的QQBot。
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
   * 断开 QQBot 反向 WS 会话。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  @Post('kick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '断开 QQBot 反向 WS 会话' })
  @ApiQuery({ name: 'selfId', type: String })
  async kick(@Query('selfId') selfId: string) {
    return vbenSuccess(await this.reverseWsService.kick(selfId));
  }
}
