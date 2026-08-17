import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import {
  MediaGovernanceController,
  MediaGovernanceEventsController,
} from '@/modules/admin/media-governance/presentation/media-governance.controller';
import { MEDIA_GOVERNANCE_ENTITIES } from '@/modules/admin/media-governance/infrastructure/persistence/media-governance.entities';
import { MediaDescriptorStore } from '@/modules/admin/media-governance/infrastructure/persistence/media-descriptor.store';
import { MediaGovernanceEventStreamService } from '@/modules/admin/media-governance/application/media-governance-event-stream.service';
import { MediaGovernancePermissionGuard } from '@/modules/admin/media-governance/presentation/media-governance-permission.guard';
import { MediaGovernanceService } from '@/modules/admin/media-governance/application/media-governance.service';
import { MediaGovernanceAgentInternalController } from '@/modules/admin/media-governance/presentation/media-governance-agent-internal.controller';
import { MediaGovernanceAgentInternalGuard } from '@/modules/admin/media-governance/presentation/media-governance-agent-internal.guard';
import { MediaGovernanceExecutorInternalController } from '@/modules/admin/media-governance/presentation/media-governance-executor-internal.controller';
import { MediaGovernanceExecutorInternalGuard } from '@/modules/admin/media-governance/presentation/media-governance-executor-internal.guard';
import {
  MEDIA_GOVERNANCE_EXECUTION_GATEWAY,
  MediaGovernanceExecutionGatewayClient,
} from '@/modules/admin/media-governance/infrastructure/integration/media-governance-execution.gateway';
import {
  MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY,
  MediaGovernanceCodexAgentGatewayClient,
} from '@/modules/admin/media-governance/infrastructure/integration/media-governance-codex-agent.gateway';
import {
  MEDIA_GOVERNANCE_STATE_STORE,
  MediaGovernanceTypeOrmStateStore,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance-state.store';
import {
  MEDIA_GOVERNANCE_PROGRESS_HOT_STORE,
  MediaGovernanceRedisProgressHotStore,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance-progress-hot.store';

@Module({
  controllers: [
    MediaGovernanceAgentInternalController,
    MediaGovernanceExecutorInternalController,
    MediaGovernanceController,
    MediaGovernanceEventsController,
  ],
  imports: [
    AdminAuthGuardModule,
    ConfigModule,
    TypeOrmModule.forFeature(MEDIA_GOVERNANCE_ENTITIES),
  ],
  providers: [
    MediaGovernanceAgentInternalGuard,
    MediaGovernanceExecutorInternalGuard,
    MediaGovernanceExecutionGatewayClient,
    {
      provide: MEDIA_GOVERNANCE_EXECUTION_GATEWAY,
      useExisting: MediaGovernanceExecutionGatewayClient,
    },
    MediaGovernanceCodexAgentGatewayClient,
    {
      provide: MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY,
      useExisting: MediaGovernanceCodexAgentGatewayClient,
    },
    MediaDescriptorStore,
    MediaGovernanceEventStreamService,
    MediaGovernanceRedisProgressHotStore,
    {
      provide: MEDIA_GOVERNANCE_PROGRESS_HOT_STORE,
      useExisting: MediaGovernanceRedisProgressHotStore,
    },
    MediaGovernancePermissionGuard,
    MediaGovernanceTypeOrmStateStore,
    {
      provide: MEDIA_GOVERNANCE_STATE_STORE,
      useExisting: MediaGovernanceTypeOrmStateStore,
    },
    MediaGovernanceService,
  ],
})
export class AdminMediaGovernanceModule {}
