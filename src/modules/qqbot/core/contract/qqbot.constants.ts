export const QQBOT_REVERSE_WS_PATH = '/qqbot/onebot/reverse';

export const QQBOT_MQTT_TOPICS = {
  /**
   * 执行 QQBot回调。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  commandSend: (selfId: string) => `qqbot/${selfId}/command/send`,
  /**
   * 执行 QQBot回调。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  eventMessage: (selfId: string) => `qqbot/${selfId}/event/message`,
  /**
   * 执行 QQBot回调。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  eventRaw: (selfId: string) => `qqbot/${selfId}/event/raw`,
  /**
   * 执行 QQBot回调。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param echo - echo 输入；影响 response 的返回值。
   */
  response: (selfId: string, echo: string) =>
    `qqbot/${selfId}/api/response/${echo}`,
  /**
   * 执行 QQBot回调。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  status: (selfId: string) => `qqbot/${selfId}/status/runtime`,
};

export const QQBOT_DEFAULT_PAGE_NO = 1;
export const QQBOT_DEFAULT_PAGE_SIZE = 10;
