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
  QqbotRuleBodyDto,
  QqbotRuleQueryDto,
  QqbotRuleUpdateDto,
} from './qqbot-rule.dto';
import { QqbotRuleService } from './qqbot-rule.service';
import { normalizeBoolean } from '../qqbot.utils';

@ApiTags('QQBot - 自动回复规则')
@Controller('qqbot/rule')
@UseGuards(JwtAuthGuard)
export class QqbotRuleController {
  constructor(private readonly ruleService: QqbotRuleService) {}

  @Get('list')
  @ApiOperation({ summary: 'QQBot 自动回复规则分页' })
  async list(@Query() query: QqbotRuleQueryDto) {
    return vbenSuccess(await this.ruleService.page(query));
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 自动回复规则' })
  async save(@Body() body: QqbotRuleBodyDto) {
    return vbenSuccess(await this.ruleService.save(body));
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 自动回复规则' })
  async update(@Body() body: QqbotRuleUpdateDto) {
    return vbenSuccess(await this.ruleService.update(body));
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 自动回复规则' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    return vbenSuccess(await this.ruleService.remove(id));
  }

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启停 QQBot 自动回复规则' })
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'enabled', type: Boolean })
  async toggle(@Query('id') id: string, @Query('enabled') enabled: string) {
    return vbenSuccess(
      await this.ruleService.toggle(id, normalizeBoolean(enabled)),
    );
  }
}
