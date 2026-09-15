import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationPermissionGuard } from '@/common/automation/automation-permission.guard';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { RuleEngineService } from './application/rule-engine.service';
import { RuleController } from './contract/rule.controller';
import { RULE_ENGINE } from './contract/rule.types';
import { RuleDraft, RuleRevision } from './infrastructure/persistence/rule.entities';

@Module({
  imports: [AdminAuthGuardModule, TypeOrmModule.forFeature([RuleDraft, RuleRevision])],
  controllers: [RuleController],
  providers: [RuleEngineService, AutomationPermissionGuard, { provide: RULE_ENGINE, useExisting: RuleEngineService }],
  exports: [RULE_ENGINE],
})
export class RuleEngineModule {}
