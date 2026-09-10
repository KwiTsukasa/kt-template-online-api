import { PluginPlatformService } from '@/modules/plugin-platform/application/plugin-platform.service';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const normalize = (replies: unknown[]) =>
  (Object.create(PluginPlatformService.prototype) as any).normalizeEventResult({
    replies,
  });

describe('plugin image reply boundary', () => {
  it('preserves validated PNG replies and their fallback alongside text', () => {
    const replies = [
      { kind: 'image', content: png, fallbackText: '完整文字' },
      { kind: 'text', content: '下一段' },
    ];
    expect(normalize(replies)).toEqual({ handled: true, replies });
  });
  it('rejects filesystem, URL, invalid magic, excessive dimensions and missing fallbacks', () => {
    const oversized = Buffer.from(png, 'base64');
    oversized.writeUInt32BE(16001, 20);
    for (const content of [
      'file:///etc/passwd',
      'https://example.com/a.png',
      'aGVsbG8=',
      oversized.toString('base64'),
    ]) {
      expect(
        normalize([{ kind: 'image', content, fallbackText: '文字' }]).replies,
      ).toEqual([]);
    }
    expect(normalize([{ kind: 'image', content: png }]).replies).toEqual([]);
  });
});
