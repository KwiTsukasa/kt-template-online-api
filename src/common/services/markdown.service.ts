import { Injectable } from '@nestjs/common';

type MarkdownProcessor = {
  process: (value: string) => Promise<unknown>;
};

type UnifiedModule = typeof import('unified');
type RemarkParseModule = typeof import('remark-parse');
type RemarkGfmModule = typeof import('remark-gfm');
type RemarkRehypeModule = typeof import('remark-rehype');
type RehypeRawModule = typeof import('rehype-raw');
type RehypeParseModule = typeof import('rehype-parse');
type RehypeRemarkModule = typeof import('rehype-remark');
type RehypeSanitizeModule = typeof import('rehype-sanitize');
type RehypeStringifyModule = typeof import('rehype-stringify');
type RemarkStringifyModule = typeof import('remark-stringify');

const importEsm = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;

const MARKDOWN_SOURCE_PATTERN =
  /<!--\s*kt-markdown-source:([A-Za-z0-9+/=]+)\s*-->/;
const CONTENT_CLASS_PATTERN =
  /^(kt-md-|wp-|align|size-|is-|has-|language-|attachment-)/;
const CONTENT_CLASS_ATTRIBUTE = ['className', CONTENT_CLASS_PATTERN];
const EXTRA_TAG_NAMES = ['figcaption', 'figure'];
const CONTENT_CLASS_TAG_NAMES = [
  'a',
  'blockquote',
  'code',
  'div',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];

@Injectable()
export class MarkdownService {
  private processorPromise?: Promise<MarkdownProcessor>;
  private htmlToMarkdownProcessorPromise?: Promise<MarkdownProcessor>;
  private sanitizeHtmlProcessorPromise?: Promise<MarkdownProcessor>;

  /**
   * 渲染 当前模块输出。
   * @param markdown - markdown 输入；驱动 `processor.process()` 的 公共基础设施步骤。
   */
  async renderToHtml(markdown?: string | null) {
    const processor = await this.getProcessor();
    const file = await processor.process(markdown || '');

    return `${file}`;
  }

  /**
   * 渲染 当前模块输出。
   * @param html - html 输入；驱动 `processor.process()` 的 公共基础设施步骤。
   */
  async renderHtmlToMarkdown(html?: string | null) {
    const processor = await this.getHtmlToMarkdownProcessor();
    const file = await processor.process(this.stripSourceMarker(html || ''));

    return `${file}`.trim();
  }

  /**
   * 执行 当前模块流程。
   * @param html - html 输入；驱动 `processor.process()` 的 公共基础设施步骤。
   */
  async sanitizeHtml(html?: string | null) {
    const processor = await this.getSanitizeHtmlProcessor();
    const file = await processor.process(this.stripSourceMarker(html || ''));

    return `${file}`.trim();
  }

  /**
   * 执行 当前模块流程。
   * @param html - html 输入；驱动 `this.stripSourceMarker()` 的 公共基础设施步骤。
   * @param markdown - markdown 输入；影响 embedSourceHtml 的返回值。
   */
  embedSourceHtml(html: string, markdown?: string | null) {
    const source = markdown || '';
    if (!source) return this.stripSourceMarker(html);

    return `${this.stripSourceMarker(html)}\n<!-- kt-markdown-source:${Buffer.from(
      source,
      'utf8',
    ).toString('base64')} -->`;
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转换值；影响 extractSource 的返回值。
   */
  extractSource(value?: unknown) {
    const text = `${value ?? ''}`;
    const source = MARKDOWN_SOURCE_PATTERN.exec(text)?.[1];
    if (!source) return '';

    try {
      return Buffer.from(source, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转换值；影响 stripSourceMarker 的返回值。
   */
  stripSourceMarker(value?: unknown) {
    return `${value ?? ''}`.replace(MARKDOWN_SOURCE_PATTERN, '').trim();
  }

  /**
   * 查询 当前模块数据。
   */
  private getProcessor() {
    if (!this.processorPromise) {
      this.processorPromise = this.createProcessor();
    }

    return this.processorPromise;
  }

  /**
   * 查询 当前模块数据。
   */
  private getHtmlToMarkdownProcessor() {
    if (!this.htmlToMarkdownProcessorPromise) {
      this.htmlToMarkdownProcessorPromise =
        this.createHtmlToMarkdownProcessor();
    }

    return this.htmlToMarkdownProcessorPromise;
  }

  /**
   * 查询 当前模块数据。
   */
  private getSanitizeHtmlProcessor() {
    if (!this.sanitizeHtmlProcessorPromise) {
      this.sanitizeHtmlProcessorPromise = this.createSanitizeHtmlProcessor();
    }

    return this.sanitizeHtmlProcessorPromise;
  }

  /**
   * 创建 当前模块对象或配置。
   * @returns 创建后的 当前模块对象或配置。
   */
  private async createProcessor(): Promise<MarkdownProcessor> {
    const [
      { unified },
      { default: remarkParse },
      { default: remarkGfm },
      { default: remarkRehype },
      { default: rehypeRaw },
      { default: rehypeSanitize, defaultSchema },
      { default: rehypeStringify },
    ] = await Promise.all([
      importEsm<UnifiedModule>('unified'),
      importEsm<RemarkParseModule>('remark-parse'),
      importEsm<RemarkGfmModule>('remark-gfm'),
      importEsm<RemarkRehypeModule>('remark-rehype'),
      importEsm<RehypeRawModule>('rehype-raw'),
      importEsm<RehypeSanitizeModule>('rehype-sanitize'),
      importEsm<RehypeStringifyModule>('rehype-stringify'),
    ]);

    const schema = this.createSanitizeSchema(defaultSchema);

    return unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, {
        allowDangerousHtml: true,
        clobberPrefix: 'kt-md-',
        footnoteBackContent: '返回',
        footnoteLabel: '脚注',
      })
      .use(rehypeRaw)
      .use(rehypeSanitize, schema)
      .use(rehypeStringify) as MarkdownProcessor;
  }

  /**
   * 创建 当前模块对象或配置。
   * @returns 创建后的 当前模块对象或配置。
   */
  private async createHtmlToMarkdownProcessor(): Promise<MarkdownProcessor> {
    const [
      { unified },
      { default: rehypeParse },
      { default: rehypeRemark },
      { default: remarkGfm },
      { default: remarkStringify },
    ] = await Promise.all([
      importEsm<UnifiedModule>('unified'),
      importEsm<RehypeParseModule>('rehype-parse'),
      importEsm<RehypeRemarkModule>('rehype-remark'),
      importEsm<RemarkGfmModule>('remark-gfm'),
      importEsm<RemarkStringifyModule>('remark-stringify'),
    ]);

    return unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeRemark)
      .use(remarkGfm)
      .use(remarkStringify, {
        bullet: '-',
        fences: true,
        listItemIndent: 'one',
      }) as MarkdownProcessor;
  }

  /**
   * 创建 当前模块对象或配置。
   * @returns 创建后的 当前模块对象或配置。
   */
  private async createSanitizeHtmlProcessor(): Promise<MarkdownProcessor> {
    const [
      { unified },
      { default: rehypeParse },
      { default: rehypeSanitize, defaultSchema },
      { default: rehypeStringify },
    ] = await Promise.all([
      importEsm<UnifiedModule>('unified'),
      importEsm<RehypeParseModule>('rehype-parse'),
      importEsm<RehypeSanitizeModule>('rehype-sanitize'),
      importEsm<RehypeStringifyModule>('rehype-stringify'),
    ]);

    return unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeSanitize, this.createSanitizeSchema(defaultSchema))
      .use(rehypeStringify) as MarkdownProcessor;
  }

  /**
   * 创建 当前模块对象或配置。
   * @param defaultSchema - defaultSchema 输入；生成 公共基础设施对象。
   */
  private createSanitizeSchema(defaultSchema: unknown) {
    const schema = defaultSchema as Record<string, any>;
    const attributes = (schema.attributes || {}) as Record<string, any[]>;
    const classAttributes = Object.fromEntries(
      CONTENT_CLASS_TAG_NAMES.map((tagName) => [
        tagName,
        [...(attributes[tagName] || []), CONTENT_CLASS_ATTRIBUTE],
      ]),
    );

    return {
      ...schema,
      tagNames: [...new Set([...(schema.tagNames || []), ...EXTRA_TAG_NAMES])],
      attributes: {
        ...attributes,
        ...classAttributes,
        a: [...(attributes.a || []), 'target', 'rel', CONTENT_CLASS_ATTRIBUTE],
        img: [...(attributes.img || []), 'loading', CONTENT_CLASS_ATTRIBUTE],
      },
    };
  }
}
