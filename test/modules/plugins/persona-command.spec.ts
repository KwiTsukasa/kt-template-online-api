import { parsePersonaCommand } from '@/modules/plugins/persona-switch/src/command';

describe('persona 图文命令协议', () => {
  test.each(['s', '保存'])('%s 保留正文换行并只取第一张图', (action) => {
    expect(
      parsePersonaCommand({
        raw: `${action}\r\n柊司\r\n第一段\r\n第二段`,
        imageUrls: [
          'https://example.com/first.png',
          'https://example.com/second.png',
        ],
      }),
    ).toEqual({
      action: 'save',
      name: '柊司',
      content: '第一段\n第二段',
      imageUrl: 'https://example.com/first.png',
    });
  });
  test('命令同行的名称仍必须与正文分行', () => {
    expect(
      parsePersonaCommand({
        raw: 's 柊司\n正文',
        imageUrls: ['https://example.com/a.png'],
      })?.action,
    ).toBe('save');
  });
  test.each([
    { raw: 's\n柊司\n正文', imageUrls: [] },
    { raw: 's 柊司 正文', imageUrls: ['https://example.com/a.png'] },
    { raw: 's\n柊司\n   ', imageUrls: ['https://example.com/a.png'] },
    { raw: 's\n\n正文', imageUrls: ['https://example.com/a.png'] },
    { raw: 's\n柊司\n正文', imageUrls: ['', 'https://example.com/second.png'] },
    { raw: 's\n柊司\n正文', imageUrls: ['file:///secret'] },
    {
      raw: 's\n柊司\n正文',
      imageUrls: ['https://user:password@example.com/a.png'],
    },
    {
      raw: `s\n${'名'.repeat(21)}\n正文`,
      imageUrls: ['https://example.com/a.png'],
    },
    { raw: 'save\n柊司\n正文', imageUrls: ['https://example.com/a.png'] },
  ])('拒绝缺图及错误格式 %#', (input) =>
    expect(parsePersonaCommand(input)).toBeNull(),
  );
  test.each(['c', '切换'])('%s 选择名称', (action) =>
    expect(parsePersonaCommand({ raw: `${action} 柊司` })).toEqual({
      action: 'switch',
      name: '柊司',
    }),
  );
  test.each(['d', '删除'])('%s 删除名称', (action) =>
    expect(parsePersonaCommand({ raw: `${action} 柊司` })).toEqual({
      action: 'delete',
      name: '柊司',
    }),
  );
  test.each(['h', '使用说明', ''])('%s 返回说明', (raw) =>
    expect(parsePersonaCommand({ raw })).toEqual({ action: 'help' }),
  );
});
