export const MESSAGE_DELIVERY = Symbol('MESSAGE_DELIVERY');
export interface MessageDeliveryPort { drain: () => Promise<void>; }
