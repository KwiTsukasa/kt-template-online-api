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
  QqbotRuleBodyDto,
  QqbotRuleQueryDto,
  QqbotRuleUpdateDto,
} from './qqbot-rule.dto';
import { QqbotRuleService } from '../../application/rule/qqbot-rule.service';

@ApiTags('QQBot - 自动回复规则')
@Controller('qqbot/rule')
@UseGuards(JwtAuthGuard)
export class QqbotRuleController {
  constructor(
    private readonly ruleService: QqbotRuleService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 按查询条件读取 QQBot 自动回复规则分页，并封装为 Vben 成功响应。
   * @param query - 限定`list` 对应结果筛选、排序与分页范围的查询条件。
   * @returns `list` 对应。
   */
  @Get('list')
  @ApiOperation({ summary: 'QQBot 自动回复规则分页' })
  async list(@Query() query: QqbotRuleQueryDto) {
    return vbenSuccess(await this.ruleService.page(query));
  }

  /**
   * 根据`body`更新`save` 对应结果。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @returns `save` 对应。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 自动回复规则' })
  async save(@Body() body: QqbotRuleBodyDto) {
    return vbenSuccess(await this.ruleService.save(body));
  }

  /**
   * 根据`body`更新`update` 对应结果。
   * @param body - 用于`update` 对应结果的结构化输入。
   * @returns `update` 对应。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 自动回复规则' })
  async update(@Body() body: QqbotRuleUpdateDto) {
    return vbenSuccess(await this.ruleService.update(body));
  }

  /**
   * 按`id`移除QQBot 自动回复规则。
   * @param id - 决定QQBot 自动回复规则内容、边界或目标的 `id` 值。
   * @returns QQBot 自动回复规则。
   */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 自动回复规则' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    return vbenSuccess(await this.ruleService.remove(id));
  }

  /**
   * 根据参数 `id`，启停 QQBot 自动回复规则。
   * @param id - 决定根据参数 `id`，启停 QQBot 自动回复规则内容、边界或目标的 `id` 值。
   * @param enabled - 决定根据参数 `id`，启停 QQBot 自动回复规则内容、边界或目标的 `enabled` 值。
   * @returns 根据参数 `id`，启停 QQBot 自动回复规则。
   */
  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启停 QQBot 自动回复规则' })
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'enabled', type: Boolean })
  async toggle(@Query('id') id: string, @Query('enabled') enabled: string) {
    return vbenSuccess(
      await this.ruleService.toggle(
        id,
        this.toolsService.normalizeBoolean(enabled),
      ),
    );
  }
}
