export const QQBOT_REVERSE_WS_PATH = '/qqbot/onebot/reverse';

export const QQBOT_MQTT_TOPICS = {
  commandSend: (selfId: string) => `qqbot/${selfId}/command/send`,
  eventMessage: (selfId: string) => `qqbot/${selfId}/event/message`,
  eventRaw: (selfId: string) => `qqbot/${selfId}/event/raw`,
  response: (selfId: string, echo: string) =>
    `qqbot/${selfId}/api/response/${echo}`,
  status: (selfId: string) => `qqbot/${selfId}/status/runtime`,
};

export const QQBOT_DEFAULT_PAGE_NO = 1;
export const QQBOT_DEFAULT_PAGE_SIZE = 10;
