import { MarkdownService } from '../../src/common';

describe('MarkdownService', () => {
  let service: MarkdownService;

  beforeEach(() => {
    service = new MarkdownService();
  });

  it('embeds, extracts and strips markdown source marker', () => {
    const markdown = '# 标题\n\n正文';
    const html = service.embedSourceHtml('<h1>标题</h1>', markdown);

    expect(service.extractSource(html)).toBe(markdown);
    expect(service.stripSourceMarker(html)).toBe('<h1>标题</h1>');
  });

  it('sanitizes imported html through the html sanitize processor', async () => {
    const process = jest
      .fn()
      .mockResolvedValue('<p>正文</p>');

    (service as any).sanitizeHtmlProcessorPromise = Promise.resolve({
      process,
    });

    const html = await service.sanitizeHtml(
      '<p onclick="alert(1)">正文</p><script>alert(1)</script>',
    );

    expect(process).toHaveBeenCalledWith(
      '<p onclick="alert(1)">正文</p><script>alert(1)</script>',
    );
    expect(html).toContain('<p>正文</p>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script>');
  });
});
