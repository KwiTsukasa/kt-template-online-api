jest.mock(
  '@/common',
  () => ({
    ensureSnowflakeId: jest.fn(),
    setDictDecodeCache: jest.fn(),
  }),
  { virtual: true },
);

import { ConfigService } from '@nestjs/config';
import { DictService } from '../../../admin/dict/dict.service';
import { QqbotFflogsClientService } from './qqbot-fflogs-client.service';

describe('QqbotFflogsClientService', () => {
  const dicts = {
    FFLOGS_ENCOUNTER_LABEL: [
      { label: 'M9S Vamp Fatale', value: 'vampfatale' },
      { label: 'M12S P2 Lindwurm II', value: 'lindwurmii' },
    ],
    FFLOGS_JOB_LABEL: [{ label: '机工士', value: 'machinist' }],
    FFLOGS_METRIC_LABEL: [{ label: 'DPS', value: 'dps' }],
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
      '1. M9S Vamp Fatale：72.4% ｜ DPS 36,635 ｜ 机工士',
    );
    expect(replyText).toContain('2. M12S P2 Lindwurm II：暂无有效排名');
  });
});
