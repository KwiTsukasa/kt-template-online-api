import type { RepeaterApplication } from '../../application/repeater-application';
import type { RepeaterMessage } from '../../domain/repeater.types';

export function createRepeaterMessageEventHandler(
  application: RepeaterApplication,
) {
  return (message: RepeaterMessage) => application.handleMessage(message);
}
