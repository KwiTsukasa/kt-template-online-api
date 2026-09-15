import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { AutomationAction, AutomationPermissionGuard, AutomationResource } from '@/common/automation/automation-permission.guard';
import { DefinitionController } from '@/common/automation/definition.controller';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { FormDefinitionService } from '../application/form-definition.service';
import type { FormDefinition } from './form.types';

@ApiTags('自动化表单')
@Controller('automation/forms')
@UseGuards(JwtAuthGuard, AutomationPermissionGuard)
@AutomationResource('Form')
export class FormController extends DefinitionController<FormDefinition> {
  constructor(private readonly forms: FormDefinitionService) {
    super(forms.definitions, async () => {});
  }

  /**
   * 对表单预览页提交的数据执行服务端校验，只返回验证后的值而不保存实例。
   * @param body - 当前表单草稿及预览填写值。
   * @returns 已校验的定义与填写值。
   */
  @Post('preview')
  @HttpCode(200)
  @AutomationAction('Test')
  preview(@Body() body: { definition: unknown; values: unknown }) {
    return vbenSuccess(this.forms.preview(body.definition, body.values));
  }
}
