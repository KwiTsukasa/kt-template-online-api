import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { AutomationAction, AutomationPermissionGuard, AutomationResource } from '@/common/automation/automation-permission.guard';
import { DefinitionController } from '@/common/automation/definition.controller';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { RuleEngineService } from '../application/rule-engine.service';
import type { RuleDefinition } from './rule.types';

@ApiTags('自动化规则')
@Controller('automation/rules')
@UseGuards(JwtAuthGuard, AutomationPermissionGuard)
@AutomationResource('Rule')
export class RuleController extends DefinitionController<RuleDefinition> {
  constructor(private readonly rules: RuleEngineService) {
    super(rules.definitions, (definition) => rules.checkForPublish(definition));
  }

  /**
   * 从独立规则测试页求值当前事实与保存用例，不派发任务。
   * @param body - 规则草稿和本次输入的事实。
   * @returns 决策结果、命中行和用例通过状态。
   */
  @Post('preview')
  @HttpCode(200)
  @AutomationAction('Test')
  preview(@Body() body: { definition: unknown; facts: unknown }) {
    return vbenSuccess(this.rules.preview(body.definition, body.facts));
  }
}
