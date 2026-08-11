import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import {
  MediaGovernanceController,
  MediaGovernanceEventsController,
} from './media-governance.controller';
import { MEDIA_GOVERNANCE_ENTITIES } from './media-governance.entities';
import { MediaDescriptorStore } from './media-descriptor.store';
import { MediaGovernanceEventStreamService } from './media-governance-event-stream.service';
import { MediaGovernancePermissionGuard } from './media-governance-permission.guard';
import { MediaGovernanceService } from './media-governance.service';
import { MediaGovernanceAgentInternalController } from './media-governance-agent-internal.controller';
import { MediaGovernanceAgentInternalGuard } from './media-governance-agent-internal.guard';
import {
  MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY,
  MediaGovernanceCodexAgentGatewayClient,
} from './media-governance-codex-agent.gateway';
import {
  MEDIA_GOVERNANCE_STATE_STORE,
  MediaGovernanceTypeOrmStateStore,
} from './media-governance-state.store';

@Module({
  controllers: [
    MediaGovernanceAgentInternalController,
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
    MediaGovernanceCodexAgentGatewayClient,
    {
      provide: MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY,
      useExisting: MediaGovernanceCodexAgentGatewayClient,
    },
    MediaDescriptorStore,
    MediaGovernanceEventStreamService,
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
