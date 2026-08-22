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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { ToolsService, vbenSuccess } from '@/common';
import {
  BotCommandBodyDto,
  BotCommandQueryDto,
  BotCommandTestDto,
  BotCommandUpdateDto,
} from './bot-command.dto';
import { BotCommandEngineService } from '../../application/command/bot-command-engine.service';
import { BotCommandService } from '../../application/command/bot-command.service';

@ApiTags('Bot - 在线命令')
@Controller('bot/command')
@UseGuards(JwtAuthGuard)
export class BotCommandController {
  constructor(
    private readonly commandEngine: BotCommandEngineService,
    private readonly commandService: BotCommandService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 按查询条件读取 Bot 在线命令分页，并封装为 Vben 成功响应。
   * @param query - 限定`list` 对应结果筛选、排序与分页范围的查询条件。
   * @returns `list` 对应。
   */
  @Get('list')
  @ApiOperation({ summary: 'Bot 在线命令分页' })
  async list(@Query() query: BotCommandQueryDto) {
    return vbenSuccess(await this.commandService.page(query));
  }

  /**
   * 根据`body`更新`save` 对应结果。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @returns `save` 对应。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 Bot 在线命令' })
  async save(@Body() body: BotCommandBodyDto) {
    return vbenSuccess(await this.commandService.save(body));
  }

  /**
   * 根据`body`更新`update` 对应结果。
   * @param body - 用于`update` 对应结果的结构化输入。
   * @returns `update` 对应。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 Bot 在线命令' })
  async update(@Body() body: BotCommandUpdateDto) {
    return vbenSuccess(await this.commandService.update(body));
  }

  /**
   * 按命令标识执行软删除，并将删除结果封装为 Vben 成功响应。
   * @param id - 决定Bot 在线命令内容、边界或目标的 `id` 值。
   * @returns Bot 在线命令。
   */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 Bot 在线命令' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    return vbenSuccess(await this.commandService.remove(id));
  }

  /**
   * 根据`id`、`enabled`处理启停 Bot 在线命令。
   * @param id - 决定启停 Bot 在线命令内容、边界或目标的 `id` 值。
   * @param enabled - 决定启停 Bot 在线命令内容、边界或目标的 `enabled` 值。
   * @returns 启停 Bot 在线命令。
   */
  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启停 Bot 在线命令' })
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
   * 根据测试输入预览 Bot 命令解析与回复结果，并封装为 Vben 成功响应。
   * @param body - 用于test的结构化输入。
   * @returns 包含命令测试预览数据的 Vben 成功响应。
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '测试 Bot 在线命令' })
  async test(@Body() body: BotCommandTestDto) {
    return vbenSuccess(await this.commandEngine.preview(body));
  }
}
