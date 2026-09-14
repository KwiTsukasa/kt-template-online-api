import { createServer } from 'node:http';
import { once } from 'node:events';
import { FeishuDocuments } from '@/modules/plugins/feishu-docs/src/client';

describe('飞书独立文档连接器', () => {
  it('uses real HTTP to resolve wiki, page records, edit exact targets and read back; rejects stale or out-of-scope edits', async () => {
    let values: any[][] = [['原值', 12]];
    let text = '原始正文';
    let fields = { 名称: '原记录' };
    let authCalls = 0,
      writes = 0;
    const requests: string[] = [];
    const server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const path = new URL(req.url!, 'http://fixture').pathname;
      requests.push(`${req.method} ${path}`);
      let data: any = {};
      let code = 0;
      if (path.endsWith('/tenant_access_token/internal')) {
        expect(JSON.parse(raw)).toEqual({
          app_id: 'fixture-app',
          app_secret: 'fixture-secret',
        });
        authCalls++;
        res.end(
          JSON.stringify({
            code: 0,
            tenant_access_token: 'fixture-token',
            expire: 7200,
          }),
        );
        return;
      }
      expect(req.headers.authorization).toBe('Bearer fixture-token');
      if (path.endsWith('/get_node'))
        data = { node: { obj_type: 'sheet', obj_token: 'sheetA' } };
      else if (path.endsWith('/sheets/query'))
        data = { sheets: [{ sheet_id: 'tabA', title: '表一' }] };
      else if (path.endsWith('/values') && req.method === 'PUT') {
        expect(JSON.parse(raw).valueRange.range).toBe('tabA!A1:B1');
        values = JSON.parse(raw).valueRange.values;
        writes++;
      } else if (path.includes('/values/'))
        data = { valueRange: { range: 'tabA!A1:B1', values } };
      else if (path.endsWith('/blocks/blockA')) {
        if (req.method === 'PATCH') {
          text =
            JSON.parse(raw).update_text_elements.elements[0].text_run.content;
          writes++;
        }
        data = {
          block: {
            block_id: 'blockA',
            block_type: 2,
            text: { elements: [{ text_run: { content: text } }] },
          },
        };
      } else if (path.endsWith('/blocks'))
        data = {
          items: [{ block_id: 'blockA' }],
          has_more: true,
          page_token: 'next-page',
        };
      else if (path.endsWith('/records/recordA')) {
        if (req.method === 'PUT') {
          fields = { ...fields, ...JSON.parse(raw).fields };
          writes++;
        }
        data = { record: { record_id: 'recordA', fields } };
      } else if (path.endsWith('/tables'))
        data = { items: [{ table_id: 'tableA' }], has_more: false };
      else code = 99991672;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code, data }));
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const client = new FeishuDocuments(
      {
        FEISHU_DOCS_APP_ID: 'fixture-app',
        FEISHU_DOCS_APP_SECRET: 'fixture-secret',
      },
      async (input) => {
        const target = input.url as URL;
        expect(target.origin).toBe('https://open.feishu.cn');
        const result = await fetch(
          `http://127.0.0.1:${port}${target.pathname}${target.search}`,
          {
            method: input.method as string,
            headers: input.headers as Record<string, string>,
            body: input.body as string,
          },
        );
        return { body: Buffer.from(await result.arrayBuffer()) };
      },
    );
    try {
      const sheet = {
        url: 'https://example.feishu.cn/wiki/wikiA',
        range: 'tabA!A1:B1',
      };
      const first = await client.read(sheet);
      expect(first.target).toEqual({ kind: 'sheets', id: 'sheetA' });
      expect(
        await client.edit({
          ...sheet,
          expectedSnapshot: first.snapshot,
          values: [['新值', 15]],
        }),
      ).toMatchObject({
        verified: true,
        data: { valueRange: { values: [['新值', 15]] } },
      });
      await expect(
        client.edit({
          ...sheet,
          expectedSnapshot: first.snapshot,
          values: [['错误覆盖', 0]],
        }),
      ).rejects.toThrow('已变化');
      const document = { url: 'https://example.feishu.cn/docx/docA' };
      expect((await client.read(document)).data).toMatchObject({
        has_more: true,
        page_token: 'next-page',
      });
      const block = { ...document, blockId: 'blockA' };
      const previous = await client.read(block);
      expect(
        await client.edit({
          ...block,
          expectedSnapshot: previous.snapshot,
          text: '目标块正文',
        }),
      ).toMatchObject({ verified: true });
      const table = {
        url: 'https://example.feishu.cn/base/baseA',
        tableId: 'tableA',
        recordId: 'recordA',
      };
      const record = await client.read(table);
      expect(
        await client.edit({
          ...table,
          expectedSnapshot: record.snapshot,
          fields: { 名称: '更新记录' },
        }),
      ).toMatchObject({ verified: true });
      expect(writes).toBe(3);
      expect(authCalls).toBe(1);
      const calls = requests.length;
      await expect(
        client.read({ url: 'https://feishu.cn.evil.test/docx/a' }),
      ).rejects.toThrow('飞书 HTTPS');
      await expect(
        client.read({ url: 'http://127.0.0.1/docx/a' }),
      ).rejects.toThrow('飞书 HTTPS');
      expect(requests).toHaveLength(calls);
      await expect(
        client.read({ url: document.url, blockId: '../other' }),
      ).rejects.toThrow('ID 无效');
      const current = await client.read(sheet);
      await expect(
        client.edit({
          ...sheet,
          expectedSnapshot: current.snapshot,
          values: [['尺寸不符']],
        }),
      ).rejects.toThrow('大小一致');
      expect(writes).toBe(3);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
