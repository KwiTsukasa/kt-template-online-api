import { ToolsService } from '@/common';

describe('ToolsService', () => {
  const service = new ToolsService();

  it('summarizes CQ image base64 payloads before storing message text', () => {
    const stored = service.toStoredMessageText(
      `before [CQ:image,file=base64://${'a'.repeat(70000)}] after`,
    );

    expect(stored).toBe('before [CQ:image,file=base64://<70000 chars>] after');
    expect(stored.length).toBeLessThan(100);
  });

  it('truncates oversized stored message text after image summarization', () => {
    const stored = service.toStoredMessageText('x'.repeat(4100), 100);

    expect(stored).toContain('<truncated 4000 chars>');
    expect(stored.length).toBeLessThan(140);
  });
});
