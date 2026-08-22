export const BOT_REVERSE_WS_PATH = '/bot-adapter/napcat/onebot/reverse';

export const BOT_MQTT_TOPICS = {
  commandSend: (selfId: string) => `bot/${selfId}/command/send`,
  eventMessage: (selfId: string) => `bot/${selfId}/event/message`,
  eventRaw: (selfId: string) => `bot/${selfId}/event/raw`,
  response: (selfId: string, echo: string) =>
    `bot/${selfId}/api/response/${echo}`,
  status: (selfId: string) => `bot/${selfId}/status/runtime`,
};

export const BOT_DEFAULT_PAGE_NO = 1;
export const BOT_DEFAULT_PAGE_SIZE = 10;
