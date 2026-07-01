import { execFileSync } from 'node:child_process';

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

  it('sanitizes real Argon codeblock html while preserving runtime classes', async () => {
    const argonHtml =
      '<pre class="wp-block-code hljs-codeblock" id="demo" onclick="alert(1)"><code class="hljs sql"><table class="hljs-ln"><tbody><tr><td class="hljs-ln-line hljs-ln-numbers" data-line-number="1">1</td><td class="hljs-ln-line hljs-ln-code">select 1;</td></tr></tbody></table></code><div class="hljs-control"><i class="fa fa-copy" tooltip="复制"></i></div></pre><script>alert(1)</script>';
    const script = `
      const { MarkdownService } = require('./src/common');
      (async () => {
        const html = await new MarkdownService().sanitizeHtml(${JSON.stringify(argonHtml)});
        process.stdout.write(JSON.stringify(html));
      })().catch((error) => {
        process.exit(1);
      });
    `;
    const output = execFileSync(
      process.execPath,
      [
        '--experimental-vm-modules',
        '-r',
        'ts-node/register',
        '-r',
        'tsconfig-paths/register',
        '-e',
        script,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          TS_NODE_TRANSPILE_ONLY: 'true',
        },
      },
    );
    const html = JSON.parse(output) as string;

    expect(html).toContain('class="wp-block-code hljs-codeblock"');
    expect(html).toContain('id="demo"');
    expect(html).toContain('<table class="hljs-ln">');
    expect(html).toContain('data-line-number="1"');
    expect(html).toContain('class="fa fa-copy"');
    expect(html).toContain('tooltip="复制"');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script>');
  });

  it('renders markdown fenced code blocks with Argon codeblock structure', async () => {
    const cases = {
      bash: '```bash\npwd\n```',
      js: '```js\nconst value = 1;\n```',
      plaintext: '```\nplain\n```',
      sh: '```sh\necho ok\n```',
      ts: '```ts\nconst component = <Kwi>demo</Kwi>;\n```',
    };
    const script = `
      const { MarkdownService } = require('./src/common');
      (async () => {
        const service = new MarkdownService();
        const cases = ${JSON.stringify(cases)};
        const entries = await Promise.all(
          Object.entries(cases).map(async ([name, markdown]) => [
            name,
            await service.renderToHtml(markdown),
          ]),
        );
        process.stdout.write(JSON.stringify(Object.fromEntries(entries)));
      })().catch((error) => {
        process.exit(1);
      });
    `;
    const output = execFileSync(
      process.execPath,
      [
        '--experimental-vm-modules',
        '-r',
        'ts-node/register',
        '-r',
        'tsconfig-paths/register',
        '-e',
        script,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          TS_NODE_TRANSPILE_ONLY: 'true',
        },
      },
    );
    const html = JSON.parse(output) as Record<string, string>;

    expect(html.ts).toContain(
      '<pre class="wp-block-code hljs-codeblock"><code class="hljs typescript">',
    );
    expect(html.ts).toContain('&#x3C;Kwi>demo&#x3C;/Kwi>');
    expect(html.ts).not.toContain('<Kwi>');
    expect(html.js).toContain('<code class="hljs javascript">');
    expect(html.bash).toContain('<code class="hljs shell">');
    expect(html.sh).toContain('<code class="hljs shell">');
    expect(html.plaintext).toContain('<code class="hljs plaintext">');
  });

  it('builds sanitizer schema for content classes and image loading', () => {
    const schema = (service as any).createSanitizeSchema({
      attributes: {
        a: ['href'],
        img: ['src'],
      },
      tagNames: ['p'],
    });

    expect(schema.tagNames).toEqual(
      expect.arrayContaining([
        'div',
        'figcaption',
        'figure',
        'i',
        'table',
        'tbody',
        'td',
        'th',
        'thead',
        'tr',
      ]),
    );
    expect(schema.clobberPrefix).toBe('');
    expect(schema.attributes.a).toEqual(
      expect.arrayContaining([
        'href',
        'target',
        'rel',
        'id',
        'dataLineNumber',
        'hljsCodeblockInner',
        'tooltip',
      ]),
    );
    expect(schema.attributes.figure).toEqual(
      expect.arrayContaining(['id', 'dataLineNumber', 'hljsCodeblockInner']),
    );
    expect(schema.attributes.img).toEqual(
      expect.arrayContaining([
        'src',
        'loading',
        'id',
        'dataLineNumber',
        'hljsCodeblockInner',
      ]),
    );
    const classAttribute = schema.attributes.a.find((item) =>
      Array.isArray(item),
    );
    expect(classAttribute).toBeDefined();
    const classPattern = (classAttribute as [string, RegExp])[1];
    expect(classPattern.test('hljs-codeblock')).toBe(true);
    expect(classPattern.test('fa-clipboard')).toBe(true);
    expect(classPattern.test('fancybox-wrapper')).toBe(true);
    expect(classPattern.test('sql')).toBe(true);
  });
});
