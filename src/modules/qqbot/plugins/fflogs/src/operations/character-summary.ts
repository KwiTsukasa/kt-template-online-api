import type { FflogsApplication } from '../application/fflogs-application';

export const fflogsCharacterSummaryHandlerName = 'getCharacterSummary';

/**
 * 创建 FFLogs 插件对象或配置。
 * @param application - application 输入；执行 `application.parseCharacterInput()`、`application.getCharacterSummary()` 对应的 FFLogs步骤。
 */
export function createFflogsCharacterSummaryOperation(
  application: FflogsApplication,
) {
  return {
    cacheTtlMs: 60_000,
    /**
     * 执行插件操作处理器。
     * @param input - input 输入；使用 `raw`、`text` 字段生成结果。
     * @returns 插件处理结果。
     */
    execute: async (input: Record<string, any>) => {
      const raw = `${input.raw ?? input.text ?? ''}`.trim();
      const parsed = raw ? await application.parseCharacterInput(raw) : {};
      return application.getCharacterSummary(
        removeEmpty({ ...input, ...parsed }),
      );
    },
    inputSchema: {
      properties: {
        characterName: { description: '角色名', type: 'string' },
        encounter: {
          description:
            '高难任务名，按 FFLogs 公开报告中的任务名或 encounterID 匹配',
          type: 'string',
        },
        limit: {
          default: 10,
          description: '最近记录数量，最多10条',
          type: 'number',
        },
        metric: { description: '排名指标，如 dps/hps', type: 'string' },
        serverRegion: {
          default: 'CN',
          description: '服务器地区，如 CN/JP/NA/EU',
          type: 'string',
        },
        serverSlug: { description: '服务器名或 slug', type: 'string' },
        timeframe: {
          description: 'Today 或 Historical',
          type: 'string',
        },
        zoneId: {
          description: '副本区域 ID，用于排名摘要',
          type: 'number',
        },
      },
      required: ['characterName', 'serverSlug'],
      type: 'object',
    },
    outputSchema: {
      properties: {
        characterName: { type: 'string' },
        encounterName: { type: 'string' },
        logs: { type: 'array' },
        rankings: { type: 'array' },
        replyText: { type: 'string' },
        url: { type: 'string' },
      },
      type: 'object',
    },
  };
}

/**
 * 清理 FFLogs 插件状态。
 * @param input - input 输入；驱动 `Object.entries()` 的 FFLogs步骤。
 */
function removeEmpty(input: Record<string, any>) {
  return Object.entries(input).reduce<Record<string, any>>(
    (result, [key, value]) => {
      if (value !== undefined && value !== '') result[key] = value;
      return result;
    },
    {},
  );
}
