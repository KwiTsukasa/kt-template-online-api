import { SetMetadata } from '@nestjs/common';

export const MESSAGE_MANAGEMENT_PERMISSION = 'message_management_permission';

export const MessageManagementPermission = (...authCodes: string[]) =>
  SetMetadata(MESSAGE_MANAGEMENT_PERMISSION, authCodes);
