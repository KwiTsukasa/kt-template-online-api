import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  parseReportInput,
  readFflogsReport,
} from '@/modules/plugins/fflogs/src/application/fflogs-report';
import { buildFflogsWorldNames } from '@/modules/plugins/fflogs/src/domain/fflogs-worlds';

describe('FFLogs 报告来源和施法分页', () => {
  const code = 'FwrYMgjRQWT6BzPh';
  const report = {
    code,
    title: '公开报告',
    startTime: 1000000,
    fights: [{ id: 2, name: '战斗', startTime: 1000, endTime: 20000 }],
    masterData: {
      lang: 'zh',
      actors: [{ id: 3, name: '角色', server: '琥珀原' }],
      abilities: [{ gameID: 123, name: '闪耀' }],
    },
  };
  it('parses only official report identities and rejects invalid filters', () => {
    expect(
      parseReportInput({
        raw: `report=https://cn.fflogs.com/reports/${code}#fight=2&source=3 type=Casts start=1000`,
      }),
    ).toMatchObject({ code, fight: 2, source: 3, start: 1000 });
    expect(() =>
      parseReportInput({
        report: `https://fflogs.com.evil.test/reports/${code}`,
      }),
    ).toThrow('只接受');
    expect(() => parseReportInput({ report: code, type: 'Arbitrary' })).toThrow(
      'type',
    );
    expect(parseReportInput({ raw: '角色@琥珀原' })).toBeUndefined();
  });
  it('exposes report IDs before asking for a fight and does not infer a source actor', async () => {
    const request = jest.fn().mockResolvedValue({ reportData: { report } });
    const result = await readFflogsReport(
      request,
      parseReportInput({ report: code })!,
      'https://cn.fflogs.com',
    );
    expect(result).toMatchObject({
      status: 'choose_fight',
      actors: [{ id: 3 }],
      fights: [{ id: 2 }],
    });
    expect(request).toHaveBeenCalledTimes(1);
    await expect(
      readFflogsReport(
        request,
        parseReportInput({ report: code, fight: 2, source: 999 })!,
        'https://cn.fflogs.com',
      ),
    ).rejects.toThrow('source');
  });
  it('reads real local HTTP responses and preserves absolute and fight-relative times with the next cursor', async () => {
    const requests: any[] = [];
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(input);
      res.setHeader('Content-Type', 'application/json');
      if (input.query.includes('KtReportEvents'))
        res.end(
          JSON.stringify({
            reportData: {
              report: {
                events: {
                  data: [
                    {
                      timestamp: 2500,
                      type: 'cast',
                      sourceID: 3,
                      abilityGameID: 123,
                    },
                  ],
                  nextPageTimestamp: 3000,
                },
              },
            },
          }),
        );
      else res.end(JSON.stringify({ reportData: { report } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const port = (server.address() as any).port;
      const request = async <T>(
        query: string,
        variables: Record<string, unknown>,
      ): Promise<T> => {
        const response = await fetch(`http://127.0.0.1:${port}`, {
          method: 'POST',
          body: JSON.stringify({ query, variables }),
        });
        return response.json();
      };
      const result = await readFflogsReport(
        request,
        parseReportInput({ report: code, fight: 2, source: 3 })!,
        'https://cn.fflogs.com',
      );
      expect(result).toMatchObject({
        events: [{ elapsedMs: 1500, sourceName: '角色', abilityName: '闪耀' }],
        coverage: { completeFromRequestedStart: false, nextStart: 3000 },
      });
      expect(requests[1].variables).toMatchObject({
        fightIDs: [2],
        sourceID: 3,
        start: 1000,
        end: 20000,
        type: 'Casts',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('resolves server leaves from public dictionaries without depending on another plugin', () => {
    const names = buildFflogsWorldNames(
      [
        {
          label: '中国',
          children: [
            {
              label: '猫小胖',
              children: [{ label: '琥珀原', value: 'Amber' }],
            },
          ],
        },
      ],
      [],
    );
    expect(names.get('中国/猫小胖/琥珀原')).toBe('琥珀原');
    expect(names.get('Amber')).toBe('琥珀原');
    expect(names.has('猫小胖')).toBe(false);
  });
});
