import type { BotAccount } from '../../infrastructure/persistence/account/bot-account.entity';
import type { BotAccountListItem } from '../../contract/bot.types';

export const BOT_ACCOUNT_NAPCAT_RUNTIME_PORT = Symbol(
  'BOT_ACCOUNT_NAPCAT_RUNTIME_PORT',
);

export type BotAccountNapcatRuntimeActions = {
  clearQqLoginError(selfId: string): Promise<void>;
  markQqLoginOffline(selfId: string, lastError: string): Promise<void>;
  publishOfflineNotice(
    selfId: string,
    offlineReason: string,
    metadata: Record<string, unknown>,
  ): void;
};

export type BotAccountNapcatRuntimePort = {
  appendRuntime(
    accounts: BotAccount[],
    actions: BotAccountNapcatRuntimeActions,
  ): Promise<BotAccountListItem[]>;
  removeAccountContainers(accountId: string): Promise<{
    deletedContainers: number;
  }>;
};
