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
import { ToolsService, vbenSuccess } from '@/common';
import {
  QqbotCommandBodyDto,
  QqbotCommandQueryDto,
  QqbotCommandTestDto,
  QqbotCommandUpdateDto,
} from './qqbot-command.dto';
import { QqbotCommandEngineService } from '../../application/command/qqbot-command-engine.service';
import { QqbotCommandService } from '../../application/command/qqbot-command.service';

@ApiTags('QQBot - 在线命令')
@Controller('qqbot/command')
@UseGuards(JwtAuthGuard)
export class QqbotCommandController {
  /**
   * 初始化 QqbotCommandController 实例。
   * @param commandEngine - commandEngine 输入；影响 constructor 的返回值。
   * @param commandService - commandService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly commandEngine: QqbotCommandEngineService,
    private readonly commandService: QqbotCommandService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * QQBot 在线命令分页。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  @Get('list')
  @ApiOperation({ summary: 'QQBot 在线命令分页' })
  async list(@Query() query: QqbotCommandQueryDto) {
    return vbenSuccess(await this.commandService.page(query));
  }

  /**
   * 新增 QQBot 在线命令。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 在线命令' })
  async save(@Body() body: QqbotCommandBodyDto) {
    return vbenSuccess(await this.commandService.save(body));
  }

  /**
   * 编辑 QQBot 在线命令。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 在线命令' })
  async update(@Body() body: QqbotCommandUpdateDto) {
    return vbenSuccess(await this.commandService.update(body));
  }

  /**
   * 删除 QQBot 在线命令。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 在线命令' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    return vbenSuccess(await this.commandService.remove(id));
  }

  /**
   * 启停 QQBot 在线命令。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   * @param enabled - enabled 输入；驱动 `vbenSuccess()` 的 QQBot步骤。
   */
  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启停 QQBot 在线命令' })
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'enabled', type: Boolean })
  async toggle(@Query('id') id: string, @Query('enabled') enabled: string) {
    return vbenSuccess(
      await this.commandService.toggle(
        id,
        this.toolsService.normalizeBoolean(enabled),
      ),
    );
  }

  /**
   * 测试 QQBot 在线命令。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '测试 QQBot 在线命令' })
  async test(@Body() body: QqbotCommandTestDto) {
    return vbenSuccess(await this.commandEngine.preview(body));
  }
}
