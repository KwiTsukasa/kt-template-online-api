import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { HermesRunApplication } from '@/modules/plugins/hermes-agent/src/runs';

const runId = `run_${'a'.repeat(32)}`;
describe('Hermes durable native runs over HTTP', () => {
  let server: Server;
  let base: string;
  let state = 'running';
  const requests: Array<{
    method: string;
    path: string;
    body: any;
    headers: any;
  }> = [];
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      let body;
      if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({
        method: req.method!,
        path: req.url!,
        body,
        headers: req.headers,
      });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST')
        res.end(JSON.stringify({ run_id: runId, status: state }));
      else
        res.end(
          JSON.stringify({
            run_id: runId,
            status: state,
            output: '已经完成查询，数据来源已保存。',
          }),
        );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const make = () =>
    new HermesRunApplication({
      runtime: {
        installationId: 'installation',
        configSnapshot: {
          HERMES_AGENT_BASE_URL: base,
          HERMES_AGENT_API_KEY: 'test-only',
        },
      },
      host: {
        requestJson: async (input: any) => {
          const response = await fetch(input.url, {
            method: input.method,
            headers: input.headers,
            body: input.body,
          });
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        },
      },
    });
  it('preserves the old shared session and completes after the QQ window without resubmitting inference', async () => {
    const event = {
      eventId: 'message',
      senderKey: 'one',
      conversationKey: 'group',
      scope: 'group' as const,
      isSelf: false,
      text: '分析报告',
      rawText: '分析报告',
      links: [],
      metadata: {
        durableTask: true,
        toolContextId: '11111111-1111-4111-8111-111111111111',
        replyDeadlineAt: Date.now() - 60000,
        imageDataUrls: ['data:image/png;base64,test'],
        recentMessages: [{ messageId: 'other', sender: 'two' }],
      },
    };
    const initial = await make().handle(event);
    expect(initial.continuation?.state).toEqual({ runId });
    expect(requests[0].body.session_id).toBe(
      createHash('sha256')
        .update(JSON.stringify(['installation', 'group', 'group']))
        .digest('hex'),
    );
    expect(requests[0].body.input[0].content[1].image_url.url).toBe(
      'data:image/png;base64,test',
    );
    const resumed = {
      ...event,
      metadata: {
        ...event.metadata,
        continuation: initial.continuation!.state,
      },
    };
    expect((await make().handle(resumed)).continuation?.state).toEqual({
      runId,
    });
    state = 'completed';
    expect((await make().handle(resumed)).replies[0].content).toContain(
      '已经完成查询',
    );
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(1);
    expect(
      requests.every(
        (item) =>
          item.headers['x-kt-tool-context'] === event.metadata.toolContextId,
      ),
    ).toBe(true);
  });
});
