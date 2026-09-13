import type { FflogsApplication } from '../application/fflogs-application';
import { parseReportInput } from '../application/fflogs-report';

export const fflogsCharacterSummaryHandlerName = 'getCharacterSummary';

/**
 * 根据`application`构造Fflogs角色摘要操作。
 * @param application - 用于Fflogs角色摘要操作的领域对象，包含 `parseCharacterInput`、`getCharacterSummary` 字段。
 * @returns 包含 `cacheTtlMs`、`execute`、`inputSchema`、`outputSchema` 字段的Fflogs角色摘要操作。
 */
export function createFflogsCharacterSummaryOperation(
  application: FflogsApplication,
) {
  return {
    cacheTtlMs: 60_000,
    execute: async (input: Record<string, any>) => {
      if (parseReportInput(input)) return application.getReport(input);
      const raw = `${input.raw ?? input.text ?? ''}`.trim();
      const parsed = await (async () => {
        if (raw) {
          return await application.parseCharacterInput(raw);
        }
        return {};
      })();
      const values = removeEmpty({ ...input, ...parsed });
      const missing = [];
      if (!values.characterName && !values.character) missing.push('角色名');
      if (!values.serverSlug && !values.server) missing.push('服务器名');
      if (missing.length)
        return {
          status: 'requires_input',
          missing,
          replyText: `还缺少：${missing.join('、')}。完整格式：/fflogs 角色名@服务器；报告查询：/fflogs report=报告链接。`,
        };
      return application.getCharacterSummary(values);
    },
    inputSchema: {
      'x-agent-read-only': true,
      properties: {
        raw: {
          description:
            '完整命令参数：角色名@服务器，或 report=报告链接 fight=编号 source=角色ID type=Casts start=毫秒游标',
          type: 'string',
        },
        report: { description: 'FFLogs报告代码或官方报告链接', type: 'string' },
        fight: {
          description: '报告中真实战斗ID，省略时列出战斗',
          type: 'integer',
        },
        source: { description: '报告中真实角色ID', type: 'integer' },
        type: {
          enum: [
            'Casts',
            'Deaths',
            'DamageDone',
            'Healing',
            'Buffs',
            'Debuffs',
            'All',
          ],
        },
        start: {
          description: '从上一页返回的nextStart继续，单位毫秒',
          type: 'number',
        },
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
      anyOf: [
        { required: ['raw'] },
        { required: ['report'] },
        { required: ['characterName', 'serverSlug'] },
      ],
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
 * 浅拷贝输入并剔除值为 `undefined` 或空字符串的字段，同时保留其他空值与字段顺序。
 * @param input - 用于Empty的结构化输入。
 * @returns 仅剔除 `undefined` 与空字符串字段的浅拷贝对象；没有保留字段时为空对象。
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
