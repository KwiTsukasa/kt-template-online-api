import type { QqbotAccount } from '../../infrastructure/persistence/account/qqbot-account.entity';
import type {
  QqbotAccountListItem,
  QqbotConnectionRole,
} from '../../contract/qqbot.types';

export const QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT = Symbol(
  'QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT',
);

export type QqbotAccountNapcatRuntimeActions = {
  clearQqLoginError(selfId: string): Promise<void>;
  getLoginPassword(
    account: Pick<QqbotAccount, 'napcatLoginPasswordSecret'>,
  ): string;
  markOnline(
    selfId: string,
    clientRole: QqbotConnectionRole,
    lastError?: null | string,
  ): Promise<void>;
  markQqLoginOffline(selfId: string, lastError: string): Promise<void>;
  publishOfflineNotice(
    selfId: string,
    offlineReason: string,
    metadata: Record<string, unknown>,
  ): void;
};

export type QqbotAccountNapcatRuntimePort = {
  appendRuntime(
    accounts: QqbotAccount[],
    options: { autoLogin?: boolean },
    actions: QqbotAccountNapcatRuntimeActions,
  ): Promise<QqbotAccountListItem[]>;
  removeAccountContainers(accountId: string): Promise<{
    deletedContainers: number;
  }>;
};
