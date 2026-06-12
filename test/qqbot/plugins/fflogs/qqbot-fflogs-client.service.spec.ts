jest.mock(
  '@/common',
  () => ({
    ensureSnowflakeId: jest.fn(),
    KtCreateDateColumn: () => () => undefined,
    KtDateTime: Date,
    KtDateTimeColumn: () => () => undefined,
    KtDateTimeField: () => () => undefined,
    KtUpdateDateColumn: () => () => undefined,
    formatKtDateTime: (value: Date | number | string) => {
      const date = value instanceof Date ? value : new Date(value);
      return [
        `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(
          2,
          '0',
        )}-${`${date.getDate()}`.padStart(2, '0')}`,
        `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(
          2,
          '0',
        )}:${`${date.getSeconds()}`.padStart(2, '0')}`,
      ].join(' ');
    },
    setDictDecodeCache: jest.fn(),
    transformKtDateTimeFields: (value: unknown) => value,
  }),
  { virtual: true },
);

import { ConfigService } from '@nestjs/config';
import { DictService } from '@/admin/dict/dict.service';
import { QqbotFflogsClientService } from '@/qqbot/plugins/fflogs/qqbot-fflogs-client.service';

describe('QqbotFflogsClientService', () => {
  const dicts = {
    FFLOGS_JOB_LABEL: [{ label: '机工士', value: 'machinist' }],
    FFLOGS_METRIC_LABEL: [
      { label: 'DPS', value: 'dps' },
      { label: 'aDPS', value: 'cdps' },
    ],
    FFLOGS_ROLE_LABEL: [],
    FFLOGS_SERVER_REGION_LABEL: [{ label: '国服', value: 'cn' }],
  };

  const service = new QqbotFflogsClientService(
    {
      get: jest.fn(),
    } as unknown as ConfigService,
    {
      getDictByKey: jest.fn(
        async (dictKey: keyof typeof dicts) => dicts[dictKey] || [],
      ),
      getDictItemsByKey: jest.fn(
        async (dictKey: keyof typeof dicts) => dicts[dictKey] || [],
      ),
    } as unknown as DictService,
  );

  it('uses cn FFLogs API endpoints by default', () => {
    expect((service as any).graphqlUrl).toBe(
      'https://cn.fflogs.com/api/v2/client',
    );
    expect((service as any).tokenUrl).toBe('https://cn.fflogs.com/oauth/token');
  });

  it('formats character rankings with dict labels', async () => {
    const localizationMaps = await (service as any).getLocalizationMaps();
    const replyText = (service as any).buildReplyText({
      allStarText: '全明星：318分 / 排名第1857',
      characterId: 20962075,
      characterName: 'Kwi柊司',
      localizationMaps,
      metric: 'DPS',
      rankings: [
        {
          bestAmount: 36635,
          encounter: { name: '上位护锁刃龙' },
          rankPercent: 72.4,
          spec: 'Machinist',
        },
        {
          bestAmount: 0,
          encounter: { name: '下位护锁刃龙' },
          rankPercent: 0,
        },
      ],
      serverName: '琥珀原',
      serverRegion: 'CN',
      url: 'https://cn.fflogs.com/character/cn/%E7%90%A5%E7%8F%80%E5%8E%9F/Kwi%E6%9F%8A%E5%8F%B8?zone=67&boss=1082&partition=0',
    });

    expect(replyText).toContain('FFLogs 战绩：Kwi柊司 @ 琥珀原（国服）');
    expect(replyText).toContain(
      '1. 上位护锁刃龙：72.4% ｜ DPS 36,635 ｜ 机工士',
    );
    expect(replyText).toContain('2. 下位护锁刃龙：暂无有效排名');
  });

  it('formats recent encounter logs with Chinese encounter label and colors', async () => {
    const localizationMaps = await (service as any).getLocalizationMaps();
    const replyText = (service as any).buildEncounterLogsReplyText({
      characterId: 20962075,
      characterName: 'Kwi柊司',
      encounterName: 'M9S 吸血鬼偶像',
      localizationMaps,
      logs: [
        {
          adps: 37560.7,
          color: '蓝',
          damageScore: 66.5,
          dps: 37560.7,
          encounterName: '上位护锁刃龙',
          fightId: 14,
          healingColor: '灰',
          healingScore: 0,
          hps: 0,
          kill: true,
          logCode: 'CgvFRqyxJhLtmND7',
          logUrl: 'https://cn.fflogs.com/reports/CgvFRqyxJhLtmND7#fight=14',
          ndps: 36635.1,
          rdps: 36635.1,
          startTime: new Date('2026-05-01T20:30:00+08:00').getTime(),
        },
      ],
      serverName: '琥珀原',
      serverRegion: 'CN',
      url: 'https://cn.fflogs.com/character/cn/%E7%90%A5%E7%8F%80%E5%8E%9F/Kwi%E6%9F%8A%E5%8F%B8?zone=67&boss=1082&partition=0',
    });

    expect(replyText).toContain('任务：M9S 吸血鬼偶像');
    expect(replyText).toContain('1. 05/01 20:30｜击杀｜上位护锁刃龙');
    expect(replyText).toContain('颜色:D蓝/H灰｜评分:D66.5/H0');
    expect(replyText).toContain('D37,561/aD37,561/rD36,635/nD36,635/H0');
    expect(replyText).toContain(
      'https://cn.fflogs.com/reports/CgvFRqyxJhLtmND7#fight=14',
    );
    expect(replyText).toContain(
      'https://cn.fflogs.com/character/cn/琥珀原/Kwi柊司?zone=67&boss=1082&partition=0',
    );
  });

  it('resolves Chinese encounter input from FFLogs encounter catalog', async () => {
    jest.spyOn(service as any, 'getFflogsEncounterCatalog').mockResolvedValue([
      {
        displayName: '护锁刃龙',
        encounterId: 1082,
        keys: ['护锁刃龙', '1082'],
        zoneId: 67,
      },
    ]);

    const lookup = await (service as any).resolveEncounterLookup(
      '上位护锁刃龙',
    );

    expect(lookup.displayName).toBe('护锁刃龙');
    expect(lookup.encounterId).toBe(1082);
    expect(lookup.zoneId).toBe(67);
  });
});
