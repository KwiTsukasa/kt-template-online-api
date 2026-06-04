jest.mock(
  '@/common',
  () => ({
    ensureSnowflakeId: jest.fn(),
    FormatDateTime: () => () => undefined,
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
  }),
  { virtual: true },
);

import { ConfigService } from '@nestjs/config';
import { DictService } from '@/admin/dict/dict.service';
import { QqbotFflogsClientService } from '@/qqbot/plugins/fflogs/qqbot-fflogs-client.service';

describe('QqbotFflogsClientService', () => {
  const dicts = {
    FFLOGS_ENCOUNTER_LABEL: [
      { label: 'M9S 吸血鬼偶像', value: 'vampfatale' },
      { label: 'M12S P2 Lindwurm II', value: 'lindwurmii' },
    ],
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
          encounter: { name: 'Vamp Fatale' },
          rankPercent: 72.4,
          spec: 'Machinist',
        },
        {
          bestAmount: 0,
          encounter: { name: 'Lindwurm II' },
          rankPercent: 0,
        },
      ],
      serverName: '琥珀原',
      serverRegion: 'CN',
      url: 'https://cn.fflogs.com/character/cn/example/Kwi',
    });

    expect(replyText).toContain('FFLogs 战绩：Kwi柊司 @ 琥珀原（国服）');
    expect(replyText).toContain(
      '1. M9S 吸血鬼偶像：72.4% ｜ DPS 36,635 ｜ 机工士',
    );
    expect(replyText).toContain('2. M12S P2 Lindwurm II：暂无有效排名');
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
          encounterName: 'M9S 吸血鬼偶像',
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
      url: 'https://cn.fflogs.com/character/cn/example/Kwi',
    });

    expect(replyText).toContain('高难任务：M9S 吸血鬼偶像');
    expect(replyText).toContain('颜色 蓝｜输出 66.5｜治疗 灰 0');
    expect(replyText).toContain(
      'DPS 37,561 / aDPS 37,561 / rDPS 36,635 / nDPS 36,635 / HPS 0',
    );
    expect(replyText).toContain('log CgvFRqyxJhLtmND7#14');
  });

  it('resolves Chinese encounter input from dict labels', async () => {
    const lookup = await (service as any).resolveEncounterLookup('吸血鬼偶像');

    expect(lookup.displayName).toBe('M9S 吸血鬼偶像');
    expect(lookup.keys).toContain('vampfatale');
  });
});
