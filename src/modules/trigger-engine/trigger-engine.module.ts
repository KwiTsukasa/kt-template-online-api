import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationPermissionGuard } from '@/common/automation/automation-permission.guard';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { TriggerEngineService } from './application/trigger-engine.service';
import { TriggerController } from './contract/trigger.controller';
import { TRIGGER_ENGINE } from './contract/trigger.types';
import { TRIGGER_DEFINITIONS } from './contract/trigger-provision.port';
import {
  TriggerDraft,
  TriggerRevision,
} from './infrastructure/persistence/trigger.entities';
import { TriggerEventRegistry } from './application/trigger-event.registry';
import { TriggerOccurrenceService } from './application/trigger-occurrence.service';
import {
  TRIGGER_EVENTS,
  TRIGGER_EVENT_SOURCES,
  TRIGGER_OCCURRENCES,
} from './contract/trigger-runtime.port';
import { TriggerClockWorker } from './infrastructure/trigger-clock.worker';
import {
  TriggerEventReceipt,
  TriggerOccurrence,
  TriggerRegistration,
} from './infrastructure/persistence/trigger-runtime.entities';

@Module({
  imports: [
    AdminAuthGuardModule,
    TypeOrmModule.forFeature([
      TriggerDraft,
      TriggerRevision,
      TriggerRegistration,
      TriggerOccurrence,
      TriggerEventReceipt,
    ]),
  ],
  controllers: [TriggerController],
  providers: [
    TriggerEngineService,
    { provide: TRIGGER_DEFINITIONS, useExisting: TriggerEngineService },
    TriggerEventRegistry,
    TriggerOccurrenceService,
    TriggerClockWorker,
    AutomationPermissionGuard,
    { provide: TRIGGER_ENGINE, useExisting: TriggerEngineService },
    { provide: TRIGGER_EVENT_SOURCES, useExisting: TriggerEventRegistry },
    { provide: TRIGGER_OCCURRENCES, useExisting: TriggerOccurrenceService },
    { provide: TRIGGER_EVENTS, useExisting: TriggerOccurrenceService },
  ],
  exports: [
    TRIGGER_ENGINE,
    TRIGGER_DEFINITIONS,
    TRIGGER_EVENT_SOURCES,
    TRIGGER_OCCURRENCES,
    TRIGGER_EVENTS,
  ],
})
export class TriggerEngineModule {}
