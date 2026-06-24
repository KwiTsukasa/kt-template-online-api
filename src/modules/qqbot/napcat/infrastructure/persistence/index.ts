import { NapcatAccountBinding } from './napcat-account-binding.entity';
import { NapcatContainer } from './napcat-container.entity';
import { NapcatDeviceIdentity } from './napcat-device-identity.entity';
import { NapcatLoginChallengeEntity } from './napcat-login-challenge.entity';
import { NapcatLoginEvent } from './napcat-login-event.entity';
import { NapcatLoginSession } from './napcat-login-session.entity';
import { NapcatProtocolProfile } from './napcat-protocol-profile.entity';
import { NapcatRiskMode } from './napcat-risk-mode.entity';
import { NapcatRuntimeCleanup } from './napcat-runtime-cleanup.entity';
import { NapcatRuntimeProfile } from './napcat-runtime-profile.entity';
import { NapcatSessionBehaviorProfile } from './napcat-session-behavior-profile.entity';
import { NapcatWebuiGatewayAudit } from '../../webui-gateway/infrastructure/persistence/napcat-webui-gateway-audit.entity';

export const NAPCAT_RUNTIME_DOMAIN_CONTRACT = {
  tables: [
    'napcat_container',
    'napcat_device_identity',
    'napcat_account_binding',
    'napcat_login_session',
    'napcat_login_challenge',
    'napcat_runtime_cleanup',
    'napcat_runtime_profile',
    'napcat_protocol_profile',
    'napcat_session_behavior_profile',
    'napcat_login_event',
    'napcat_risk_mode',
    'qqbot_napcat_webui_gateway_audit',
  ],
} as const;

export const NAPCAT_RUNTIME_ENTITIES = [
  NapcatAccountBinding,
  NapcatContainer,
  NapcatDeviceIdentity,
  NapcatLoginChallengeEntity,
  NapcatLoginSession,
  NapcatRuntimeCleanup,
  NapcatRuntimeProfile,
  NapcatProtocolProfile,
  NapcatSessionBehaviorProfile,
  NapcatLoginEvent,
  NapcatRiskMode,
  NapcatWebuiGatewayAudit,
];

export {
  NapcatLoginEvent,
  NapcatProtocolProfile,
  NapcatRiskMode,
  NapcatRuntimeProfile,
  NapcatSessionBehaviorProfile,
  NapcatWebuiGatewayAudit,
};
