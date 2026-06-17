export type FflogsKnownWorldResolver = (
  value: string,
) => null | { serverSlug?: string };

export type FflogsCharacterInputParseOptions = {
  resolveKnownWorld?: FflogsKnownWorldResolver;
};

/**
 * 解析Fflogs Character Input。
 * @param rawArgs - FFLogs列表；生成规范化文本。
 * @param options - FFLogs列表；使用 `resolveKnownWorld` 字段生成结果。
 */
export function parseFflogsCharacterInput(
  rawArgs: string,
  options: FflogsCharacterInputParseOptions = {},
) {
  const tokens = rawArgs.split(/\s+/).filter(Boolean);
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (const token of tokens) {
    if (token.includes('=')) {
      const [key, ...rest] = token.split('=');
      flags.set(key, rest.join('='));
    } else {
      positional.push(token);
    }
  }

  let characterName = normalizeString(
    flags.get('character') ||
      flags.get('name') ||
      flags.get('角色') ||
      flags.get('角色名'),
  );
  let serverSlug = normalizeString(
    flags.get('server') ||
      flags.get('serverSlug') ||
      flags.get('world') ||
      flags.get('服务器') ||
      flags.get('小区'),
  );
  let encounterName = normalizeString(
    flags.get('encounter') ||
      flags.get('encounterName') ||
      flags.get('boss') ||
      flags.get('fight') ||
      flags.get('任务') ||
      flags.get('高难') ||
      flags.get('高难任务'),
  );
  let zoneId = normalizeString(
    flags.get('zone') ||
      flags.get('zoneId') ||
      flags.get('区域') ||
      flags.get('副本区域'),
  );
  const dungeonFlag = normalizeString(flags.get('副本'));
  if (dungeonFlag) {
    if (/^\d+$/.test(dungeonFlag)) {
      zoneId = zoneId || dungeonFlag;
    } else {
      encounterName = encounterName || dungeonFlag;
    }
  }
  let remainingPositionals = [...positional];

  if (!characterName && remainingPositionals[0]?.includes('@')) {
    const [name, server] = remainingPositionals[0].split('@');
    characterName = name.trim();
    serverSlug = serverSlug || server?.trim();
    if (!encounterName && remainingPositionals.length > 1) {
      encounterName = remainingPositionals.slice(1).join(' ');
    }
    remainingPositionals = [];
  }

  if (!encounterName && remainingPositionals.length > 2) {
    const picked = pickPositionalsByKnownWorld(
      remainingPositionals,
      options.resolveKnownWorld,
    );
    if (picked) {
      characterName = characterName || picked.characterName;
      serverSlug = serverSlug || picked.serverSlug;
      encounterName = picked.encounterName;
      remainingPositionals = [];
    }
  }

  if (!characterName && remainingPositionals.length) {
    const joined = remainingPositionals.join(' ');
    if (joined.includes('@')) {
      const [name, server] = joined.split('@');
      characterName = name.trim();
      serverSlug = serverSlug || server?.trim();
    } else if (serverSlug) {
      characterName = joined;
    } else if (remainingPositionals.length > 1) {
      serverSlug = remainingPositionals[remainingPositionals.length - 1];
      characterName = remainingPositionals.slice(0, -1).join(' ');
    } else {
      characterName = joined;
    }
  }

  return {
    characterName,
    className: normalizeString(flags.get('class') || flags.get('职业')),
    difficulty: normalizeString(flags.get('difficulty') || flags.get('难度')),
    encounter: encounterName,
    encounterName,
    limit: normalizeString(flags.get('limit') || flags.get('数量')),
    metric: normalizeString(flags.get('metric') || flags.get('指标')),
    partition: normalizeString(flags.get('partition') || flags.get('分区')),
    raw: rawArgs,
    role: normalizeString(flags.get('role') || flags.get('职责')),
    serverRegion: normalizeString(
      flags.get('region') ||
        flags.get('serverRegion') ||
        flags.get('地区') ||
        flags.get('服务器地区'),
    ),
    serverSlug,
    size: normalizeString(flags.get('size') || flags.get('人数')),
    specName: normalizeString(flags.get('spec') || flags.get('专精')),
    text: rawArgs,
    timeframe: normalizeString(
      flags.get('timeframe') || flags.get('时间') || flags.get('范围'),
    ),
    zoneId,
  };
}

/**
 * 执行 FFLogs 插件流程。
 * @param positional - positional 输入；使用 `length` 字段生成结果。
 * @param resolveKnownWorld - resolveKnownWorld 输入；决定 FFLogs条件分支。
 */
function pickPositionalsByKnownWorld(
  positional: string[],
  resolveKnownWorld?: FflogsKnownWorldResolver,
) {
  if (!resolveKnownWorld) return null;

  for (let index = positional.length - 2; index > 0; index -= 1) {
    const candidate = positional[index];
    const resolved = resolveKnownWorld(candidate);
    if (!resolved?.serverSlug) continue;
    const characterName = positional.slice(0, index).join(' ').trim();
    const encounterName = positional
      .slice(index + 1)
      .join(' ')
      .trim();
    if (!characterName || !encounterName) continue;
    return {
      characterName,
      encounterName,
      serverSlug: resolved.serverSlug,
    };
  }
  return null;
}

/**
 * 转换 FFLogs 插件输入。
 * @param value - 待转换值；决定 FFLogs条件分支。
 */
function normalizeString(value?: string | true) {
  if (value === true) return '';
  return `${value || ''}`.trim();
}
