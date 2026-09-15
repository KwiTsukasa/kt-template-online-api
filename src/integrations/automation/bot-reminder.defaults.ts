import type { TaskHandler } from '@/modules/task-execution/contract/task-handler.port';

export const BOT_REMINDER_HANDLER: Omit<
  TaskHandler,
  'execute' | 'isAvailable'
> = {
  key: 'bot.reminder.deliver',
  version: 1,
  name: 'Bot 提醒投递',
  ownerKind: 'system',
  idempotent: false,
  timeoutMs: 60000,
  inputSchema: {
    fields: [
      {
        key: 'reminderId',
        label: '提醒身份',
        type: 'string',
        required: true,
        max: 191,
      },
      {
        key: 'occurredAt',
        label: '计划发生时间',
        type: 'string',
        format: 'date-time',
        required: true,
      },
    ],
  },
  outputSchema: { fields: [] },
};
