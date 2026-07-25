import { SetMetadata } from '@nestjs/common';

export const QQBOT_MESSAGE_PUSH_PERMISSION = 'qqbot_message_push_permission';

export const QqbotMessagePushPermission = (...authCodes: string[]) =>
  SetMetadata(QQBOT_MESSAGE_PUSH_PERMISSION, authCodes);
