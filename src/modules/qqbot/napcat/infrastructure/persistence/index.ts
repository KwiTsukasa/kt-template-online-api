import { NapcatAccountBinding } from './napcat-account-binding.entity';
import { NapcatContainer } from './napcat-container.entity';
import { NapcatDeviceIdentity } from './napcat-device-identity.entity';
import { NapcatLoginChallengeEntity } from './napcat-login-challenge.entity';
import { NapcatLoginSession } from './napcat-login-session.entity';
import { NapcatRuntimeCleanup } from './napcat-runtime-cleanup.entity';

export const NAPCAT_RUNTIME_DOMAIN_CONTRACT = {
  tables: [
    'napcat_container',
    'napcat_device_identity',
    'napcat_account_binding',
    'napcat_login_session',
    'napcat_login_challenge',
    'napcat_runtime_cleanup',
  ],
} as const;

export const NAPCAT_RUNTIME_ENTITIES = [
  NapcatAccountBinding,
  NapcatContainer,
  NapcatDeviceIdentity,
  NapcatLoginChallengeEntity,
  NapcatLoginSession,
  NapcatRuntimeCleanup,
];
