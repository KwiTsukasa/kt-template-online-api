import type { BotNormalizedMessage } from '../bot.types';

export type BotReminderData = {
  owner: string;
  sourcePluginKey: string;
  message: BotNormalizedMessage;
  text: string;
  variants?: string[];
  platformId?: string;
  dueAt: string;
  repeat?: string;
};
export type ReminderTiming = { id: string; dueAt: string; repeat?: string };
export type ReminderScheduleState = {
  scheduleId: string;
  enabled: boolean;
  nextRunAt: string | null;
};
export interface BotReminderScheduling {
  ensure: (timing: ReminderTiming) => Promise<ReminderScheduleState>;
  read: (scheduleId: string) => Promise<ReminderScheduleState>;
  close: (scheduleId: string) => Promise<void>;
}
export const BOT_REMINDERS = Symbol('BOT_REMINDERS');
export interface BotReminderPort {
  attach: (scheduler: BotReminderScheduling) => () => void;
  pending: (afterId: string) => Promise<string[]>;
  synchronize: (id: string) => Promise<void>;
  execute: (
    id: string,
    occurredAt: string,
    signal: AbortSignal,
  ) => Promise<void>;
}
