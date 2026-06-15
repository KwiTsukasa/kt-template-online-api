import { NapcatDeviceIdentity } from './device/napcat-device-identity.entity';
import { QqbotAccountNapcat } from './infrastructure/persistence/qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from './infrastructure/persistence/qqbot-napcat-container.entity';

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
  NapcatDeviceIdentity,
  QqbotAccountNapcat,
  QqbotNapcatContainer,
];
