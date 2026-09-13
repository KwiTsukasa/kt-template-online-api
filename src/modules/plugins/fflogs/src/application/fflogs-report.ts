type Graphql = <T>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;

/**
 * 从已授权 FFLogs 命令解析报告链接、战斗和时间游标，不把任意网址作为请求地址。
 * @param input - 原命令参数或结构化输入。
 * @returns 非报告请求时为空，报告请求返回验证后的条件。
 * @throws 报告代码、战斗编号、事件类型或游标不合法时拒绝请求。
 */
export function parseReportInput(input: Record<string, any>) {
  const raw = String(input.raw || input.text || '').trim();
  const flags: Record<string, string> = {};
  for (const token of raw.split(/\s+/u)) {
    const index = token.indexOf('=');
    if (index > 0) flags[token.slice(0, index)] = token.slice(index + 1);
  }
  let reference = String(input.report || flags.report || flags.报告 || '');
  if (!reference)
    reference =
      raw.match(
        /https:\/\/(?:[a-z]+\.)?fflogs\.com\/reports\/[A-Za-z0-9]+[^\s]*/u,
      )?.[0] || '';
  if (!reference) return undefined;
  let code = reference;
  const urlFlags = new URLSearchParams();
  if (/^https?:/iu.test(reference)) {
    const url = new URL(reference);
    if (
      url.protocol !== 'https:' ||
      !/^(?:[a-z]+\.)?fflogs\.com$/u.test(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      throw new Error('只接受FFLogs报告链接或报告代码');
    code = url.pathname.match(/^\/reports\/([A-Za-z0-9]+)\/?$/u)?.[1] || '';
    for (const [key, value] of new URLSearchParams(url.hash.slice(1)))
      urlFlags.set(key, value);
    for (const [key, value] of url.searchParams) urlFlags.set(key, value);
  }
  if (!/^[A-Za-z0-9]{16}$/u.test(code))
    throw new Error('FFLogs报告代码必须为16位字母数字');
  const fight = Number(
    input.fight || flags.fight || urlFlags.get('fight') || 0,
  );
  const source = Number(
    input.source || flags.source || urlFlags.get('source') || 0,
  );
  const start = Number(input.start || flags.start || 0);
  const type = String(input.type || flags.type || 'Casts');
  if (
    ![fight, source].every((value) => Number.isInteger(value) && value >= 0) ||
    !Number.isFinite(start) ||
    start < 0
  )
    throw new Error('fight、source必须是报告内数字ID，start必须是非负毫秒游标');
  if (
    ![
      'Casts',
      'Deaths',
      'DamageDone',
      'Healing',
      'Buffs',
      'Debuffs',
      'All',
    ].includes(type)
  )
    throw new Error(
      'type支持Casts、Deaths、DamageDone、Healing、Buffs、Debuffs、All',
    );
  return { code, fight, source, start, type };
}

/**
 * 使用同一插件的 OAuth 客户端读取报告目录或一页事件，保留精确来源与未读游标。
 * @param query - FFLogs 插件自己的受控 GraphQL 入口。
 * @param input - 验证过的报告和事件筛选条件。
 * @param webBaseUrl - 当前部署配置的 FFLogs 展示地址。
 * @param readChineseNames - 可选的国服动作表查询入口，由本插件客户端提供。
 * @returns 报告中的战斗、演员、事件及可继续查询的原始时间位置。
 * @throws 报告不可见或选择的战斗、角色不属于该报告时拒绝分析。
 */
export async function readFflogsReport(
  query: Graphql,
  input: NonNullable<ReturnType<typeof parseReportInput>>,
  webBaseUrl: string,
  readChineseNames?: (ids: number[]) => Promise<{
    names: Record<number, string>;
    source: string;
    version?: string;
  }>,
) {
  const data = await query<any>(
    `query KtReport($code: String!) {
    reportData { report(code: $code) { code title startTime endTime
      fights { id name encounterID startTime endTime kill friendlyPlayers }
      masterData(translate: true) { lang actors(type: "Player") { id name server subType } abilities { gameID name } }
    } }
  }`,
    { code: input.code },
  );
  const report = data.reportData?.report;
  if (!report) throw new Error('报告不存在或当前FFLogs应用无权读取');
  const fights = report.fights || [];
  const actors = report.masterData?.actors || [];
  const url = `${webBaseUrl}/reports/${input.code}`;
  const base = {
    code: input.code,
    title: report.title,
    url,
    reportStartTime: report.startTime,
    retrievedAt: new Date().toISOString(),
    fights,
    actors,
    language: report.masterData?.lang,
  };
  if (!input.fight)
    return {
      ...base,
      status: 'choose_fight',
      replyText: `FFLogs报告：${report.title}\n${fights.map((fight: any) => `${fight.id}. ${fight.name}（${Math.round((fight.endTime - fight.startTime) / 1000)}秒）`).join('\n')}\n用 /fflogs report=${input.code} fight=战斗ID source=角色ID type=Casts 查询施法时间轴。`,
    };
  const fight = fights.find((row: any) => row.id === input.fight);
  if (!fight) throw new Error('所选战斗不在此报告中');
  if (input.source && !actors.some((row: any) => row.id === input.source))
    throw new Error('source不是此报告中可确认的角色ID');
  if (
    input.source &&
    Array.isArray(fight.friendlyPlayers) &&
    !fight.friendlyPlayers.includes(input.source)
  )
    throw new Error(
      '所选角色没有参加这场战斗，请使用此战斗friendlyPlayers中的ID',
    );
  const startTime = Math.max(fight.startTime, input.start);
  if (startTime >= fight.endTime)
    throw new Error('时间游标已经超过所选战斗结束时间');
  const response = await query<any>(
    `query KtReportEvents($code: String!, $fightIDs: [Int], $sourceID: Int, $start: Float, $end: Float, $type: EventDataType) {
    reportData { report(code: $code) { events(fightIDs: $fightIDs, sourceID: $sourceID, startTime: $start, endTime: $end,
      dataType: $type, limit: 500, translate: true, useAbilityIDs: true, useActorIDs: true) { data nextPageTimestamp } } }
  }`,
    {
      code: input.code,
      fightIDs: [input.fight],
      sourceID: input.source || undefined,
      start: startTime,
      end: fight.endTime,
      type: input.type,
    },
  );
  const page = response.reportData?.report?.events;
  if (!Array.isArray(page?.data))
    throw new Error('FFLogs未返回事件数据，不能把空响应当作没有施法');
  const abilities = new Map<number, string>(
    (report.masterData?.abilities || []).map((row: any) => [
      row.gameID,
      row.name,
    ]),
  );
  const names = new Map<number, string>(
    actors.map((row: any) => [row.id, row.name]),
  );
  let localization: {
    names: Record<number, string>;
    source: string;
    version?: string;
    error?: string;
  } = { names: {}, source: '' };
  if (readChineseNames) {
    const ids = [
      ...new Set<number>(
        page.data.map(
          (event: any) => event.abilityGameID ?? event.ability?.guid,
        ),
      ),
    ].filter((id) => Number.isInteger(id) && id > 0 && id < 1000000);
    if (ids.length) {
      try {
        localization = await readChineseNames(ids);
      } catch {
        localization.error =
          '国服动作表暂时不可读，保留FFLogs原始名称与动作ID，不推测译名';
      }
    }
  }
  const events = page.data.map((event: any) => ({
    timestamp: event.timestamp,
    elapsedMs: event.timestamp - fight.startTime,
    type: event.type,
    sourceId: event.sourceID,
    sourceName: names.get(event.sourceID),
    targetId: event.targetID,
    targetName: names.get(event.targetID),
    abilityId: event.abilityGameID ?? event.ability?.guid,
    abilityName: abilities.get(event.abilityGameID ?? event.ability?.guid),
    abilityNameZh:
      localization.names[event.abilityGameID ?? event.ability?.guid],
    amount: event.amount,
    overheal: event.overheal,
    absorbed: event.absorbed,
  }));
  let nextStart: number | null = null;
  if (
    typeof page.nextPageTimestamp === 'number' &&
    page.nextPageTimestamp < fight.endTime
  ) {
    if (page.nextPageTimestamp <= startTime)
      throw new Error('FFLogs事件游标没有推进');
    nextStart = page.nextPageTimestamp;
  }
  let nextCommand = '';
  if (nextStart !== null)
    nextCommand = `/fflogs report=${input.code} fight=${input.fight} source=${input.source} type=${input.type} start=${nextStart}`;
  return {
    ...base,
    fight,
    source: actors.find((row: any) => row.id === input.source),
    events,
    localization,
    coverage: {
      requestedStart: startTime,
      endTime: fight.endTime,
      returnedEvents: events.length,
      completeFromRequestedStart: nextStart === null,
      nextStart,
      nextCommand,
    },
    replyText: `FFLogs ${report.title} / ${fight.name}：本页${events.length}条${input.type}事件。\n${events
      .slice(0, 15)
      .map(
        (event: any) =>
          `${(event.elapsedMs / 1000).toFixed(2)}秒 ${event.sourceName || event.sourceId} ${event.abilityNameZh || event.abilityName || event.type}`,
      )
      .join('\n')}\n${nextCommand}`,
  };
}
