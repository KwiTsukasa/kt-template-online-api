import { SetMetadata } from '@nestjs/common';

export const QQBOT_MESSAGE_PUSH_PERMISSION = 'qqbot_message_push_permission';

/**
 * Declares route auth codes using OR semantics for the message-push permission guard.
 * @param authCodes - Exact active Admin menu auth codes accepted by the route.
 * @returns Nest route metadata decorator consumed after JWT authentication.
 */
export const QqbotMessagePushPermission = (...authCodes: string[]) =>
  SetMetadata(QQBOT_MESSAGE_PUSH_PERMISSION, authCodes);
