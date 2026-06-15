import type { FflogsApplication } from '../application/fflogs-application';

export const fflogsCharacterSummaryHandlerName = 'getCharacterSummary';

export function createFflogsCharacterSummaryOperation(
  application: FflogsApplication,
) {
  return {
    cacheTtlMs: 60_000,
    execute: (input: Record<string, any>) =>
      application.getCharacterSummary(input),
    inputSchema: {
      properties: {
        characterName: { description: '角色名', type: 'string' },
        encounter: {
          description: '高难任务名，按 FFLogs 公开报告中的任务名或 encounterID 匹配',
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
