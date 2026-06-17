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
  QqbotRuleBodyDto,
  QqbotRuleQueryDto,
  QqbotRuleUpdateDto,
} from './qqbot-rule.dto';
import { QqbotRuleService } from '../../application/rule/qqbot-rule.service';

@ApiTags('QQBot - 自动回复规则')
@Controller('qqbot/rule')
@UseGuards(JwtAuthGuard)
export class QqbotRuleController {
  /**
   * 初始化 QqbotRuleController 实例。
   * @param ruleService - ruleService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly ruleService: QqbotRuleService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * QQBot 自动回复规则分页。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  @Get('list')
  @ApiOperation({ summary: 'QQBot 自动回复规则分页' })
  async list(@Query() query: QqbotRuleQueryDto) {
    return vbenSuccess(await this.ruleService.page(query));
  }

  /**
   * 新增 QQBot 自动回复规则。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 自动回复规则' })
  async save(@Body() body: QqbotRuleBodyDto) {
    return vbenSuccess(await this.ruleService.save(body));
  }

  /**
   * 编辑 QQBot 自动回复规则。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 自动回复规则' })
  async update(@Body() body: QqbotRuleUpdateDto) {
    return vbenSuccess(await this.ruleService.update(body));
  }

  /**
   * 删除 QQBot 自动回复规则。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 自动回复规则' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    return vbenSuccess(await this.ruleService.remove(id));
  }

  /**
   * 启停 QQBot 自动回复规则。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   * @param enabled - enabled 输入；驱动 `vbenSuccess()` 的 QQBot步骤。
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
