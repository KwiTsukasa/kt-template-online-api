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
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotCommandBodyDto,
  QqbotCommandQueryDto,
  QqbotCommandTestDto,
  QqbotCommandUpdateDto,
} from './qqbot-command.dto';
import { QqbotCommandEngineService } from './qqbot-command-engine.service';
import { QqbotCommandService } from './qqbot-command.service';
import { normalizeBoolean } from '../qqbot.utils';

@ApiTags('QQBot - 在线命令')
@Controller('qqbot/command')
@UseGuards(JwtAuthGuard)
export class QqbotCommandController {
  constructor(
    private readonly commandEngine: QqbotCommandEngineService,
    private readonly commandService: QqbotCommandService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: 'QQBot 在线命令分页' })
  async list(@Query() query: QqbotCommandQueryDto) {
    return vbenSuccess(await this.commandService.page(query));
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 在线命令' })
  async save(@Body() body: QqbotCommandBodyDto) {
    return vbenSuccess(await this.commandService.save(body));
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 在线命令' })
  async update(@Body() body: QqbotCommandUpdateDto) {
    return vbenSuccess(await this.commandService.update(body));
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 在线命令' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    return vbenSuccess(await this.commandService.remove(id));
  }

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启停 QQBot 在线命令' })
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'enabled', type: Boolean })
  async toggle(@Query('id') id: string, @Query('enabled') enabled: string) {
    return vbenSuccess(
      await this.commandService.toggle(id, normalizeBoolean(enabled)),
    );
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '测试 QQBot 在线命令' })
  async test(@Body() body: QqbotCommandTestDto) {
    return vbenSuccess(await this.commandEngine.preview(body));
  }
}
