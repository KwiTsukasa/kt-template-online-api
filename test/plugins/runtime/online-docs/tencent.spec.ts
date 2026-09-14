import { createServer } from 'node:http';
import { once } from 'node:events';
import { TencentDocuments } from '@/modules/plugins/tencent-docs/src/client';

describe('腾讯文档独立官方服务适配器', () => {
  it('uses real HTTP and separate MCP services, verifies edits and rejects stale, ambiguous and out-of-scope changes', async () => {
    let text = '原始内容与其他段落';
    let version = 1,
      writes = 0,
      trace = 0;
    let cells: any[] = [
      { row: 0, col: 0, value_type: 'STRING', string_value: '原值' },
    ];
    const paths: string[] = [];
    const server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      expect(req.headers.authorization).toBe('fixture-token');
      paths.push(req.url!);
      if (body.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }
      let result: any = {};
      if (body.method === 'initialize') {
        res.setHeader('mcp-session-id', 'fixture-session');
        result = {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'fixture', version: '1' },
        };
      } else {
        expect(req.headers['mcp-session-id']).toBe('fixture-session');
        const { name, arguments: args } = body.params;
        let data: any = { trace_id: String(++trace) };
        if (name === 'manage.query_file_info')
          data = {
            ...data,
            file_id: args.file_id,
            type: 'doc',
            title: '测试文档',
          };
        if (name === 'manage.query_file_info' && args.file_id === 'sheetA')
          data.type = 'sheet';
        if (name === 'get_content') data.content = text;
        if (name === 'get_last_operable_pos') data.version = String(version);
        if (name === 'find') {
          const begin = text.indexOf(args.text);
          data.text_and_locations = [];
          if (begin >= 0)
            data.text_and_locations.push({
              range: { begin: begin + 1, end: begin + 1 + args.text.length },
            });
          const next = text.indexOf(args.text, begin + args.text.length);
          if (next > begin)
            data.text_and_locations.push({
              range: { begin: next + 1, end: next + 1 + args.text.length },
            });
        }
        if (name === 'replace_text') {
          expect(req.url).toBe('/api/v6/doc/mcp');
          expect(args.version_info.base_version).toBe(version);
          const range = args.ranges[0];
          text =
            text.slice(0, range.begin - 1) +
            args.text +
            text.slice(range.end - 1);
          version++;
          writes++;
        }
        if (name === 'get_sheet_info') data.sheets = [{ sheet_id: 'tabA' }];
        if (name === 'get_cell_data') {
          expect(req.url).toBe('/api/v6/sheet/mcp');
          data.cells = cells;
        }
        if (name === 'set_range_value') {
          expect(req.url).toBe('/api/v6/sheet/mcp');
          cells = args.values;
          writes++;
        }
        result = {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          structuredContent: data,
        };
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.end(
        `: heartbeat\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`,
      );
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const client = new TencentDocuments('fixture-token', async (input) => {
      const transported = structuredClone(input);
      expect(typeof transported.url).toBe('string');
      const url = new URL(transported.url as string);
      expect(url.origin).toBe('https://docs.qq.com');
      const result = await fetch(`http://127.0.0.1:${port}${url.pathname}`, {
        method: 'POST',
        headers: input.headers as Record<string, string>,
        body: input.body as string,
      });
      return {
        body: Buffer.from(await result.arrayBuffer()),
        headers: Object.fromEntries(result.headers),
      };
    });
    try {
      const doc = { url: 'https://docs.qq.com/doc/docA', findText: '原始内容' };
      const initial = await client.read(doc);
      expect(initial.matches[0].range).toEqual({ begin: 1, end: 5 });
      expect((await client.read(doc)).snapshot).toBe(initial.snapshot);
      expect(
        await client.edit({
          ...doc,
          expectedSnapshot: initial.snapshot,
          oldText: '原始内容',
          text: '新内容',
        }),
      ).toMatchObject({ verified: true });
      expect(text).toBe('新内容与其他段落');
      await expect(
        client.edit({
          ...doc,
          expectedSnapshot: initial.snapshot,
          oldText: '新内容',
          text: '错误覆盖',
        }),
      ).rejects.toThrow('已变化');
      text = '重复文本与重复文本';
      version++;
      const ambiguous = await client.read(doc);
      await expect(
        client.edit({
          ...doc,
          expectedSnapshot: ambiguous.snapshot,
          oldText: '重复文本',
          text: '不应写入',
        }),
      ).rejects.toThrow('多处匹配');
      const sheet = {
        url: 'https://docs.qq.com/sheet/sheetA',
        sheetId: 'tabA',
        startRow: 0,
        endRow: 1,
        startCol: 0,
        endCol: 1,
      };
      const previous = await client.read(sheet);
      expect(
        await client.edit({
          ...sheet,
          expectedSnapshot: previous.snapshot,
          values: [['新值']],
        }),
      ).toMatchObject({ verified: true });
      expect(writes).toBe(2);
      const current = await client.read(sheet);
      await expect(
        client.edit({
          ...sheet,
          expectedSnapshot: current.snapshot,
          values: [[{ formula: 'unsafe' }]],
        }),
      ).rejects.toThrow('单元格只接受');
      const count = paths.length;
      await expect(
        client.read({ url: 'https://docs.qq.com.evil.test/doc/x' }),
      ).rejects.toThrow('HTTPS');
      expect(paths).toHaveLength(count);
      await expect(client.read({ ...sheet, endRow: 999999 })).rejects.toThrow(
        '2000',
      );
      expect(writes).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
