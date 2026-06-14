import { NapcatDeviceIdentity } from './device/napcat-device-identity.entity';

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

export const NAPCAT_RUNTIME_ENTITIES = [NapcatDeviceIdentity];
