import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationPermissionGuard } from '@/common/automation/automation-permission.guard';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { FormDefinitionService } from './application/form-definition.service';
import { FormController } from './contract/form.controller';
import { FORM_DEFINITIONS } from './contract/form.types';
import { FormDraft, FormRevision } from './infrastructure/persistence/form.entities';

@Module({
  imports: [AdminAuthGuardModule, TypeOrmModule.forFeature([FormDraft, FormRevision])],
  controllers: [FormController],
  providers: [FormDefinitionService, AutomationPermissionGuard, { provide: FORM_DEFINITIONS, useExisting: FormDefinitionService }],
  exports: [FORM_DEFINITIONS],
})
export class FormDefinitionModule {}
