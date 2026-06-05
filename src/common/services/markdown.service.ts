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

const importEsm = new Function(
  'specifier',
  'return import(specifier)',
) as <T>(specifier: string) => Promise<T>;

const MARKDOWN_SOURCE_PATTERN =
  /<!--\s*kt-markdown-source:([A-Za-z0-9+/=]+)\s*-->/;
const CONTENT_CLASS_PATTERN =
  /^(kt-md-|wp-|align|size-|is-|has-|language-|attachment-)/;

@Injectable()
export class MarkdownService {
  private processorPromise?: Promise<MarkdownProcessor>;
  private htmlToMarkdownProcessorPromise?: Promise<MarkdownProcessor>;
  private sanitizeHtmlProcessorPromise?: Promise<MarkdownProcessor>;

  async renderToHtml(markdown?: string | null) {
    const processor = await this.getProcessor();
    const file = await processor.process(markdown || '');

    return `${file}`;
  }

  async renderHtmlToMarkdown(html?: string | null) {
    const processor = await this.getHtmlToMarkdownProcessor();
    const file = await processor.process(this.stripSourceMarker(html || ''));

    return `${file}`.trim();
  }

  async sanitizeHtml(html?: string | null) {
    const processor = await this.getSanitizeHtmlProcessor();
    const file = await processor.process(this.stripSourceMarker(html || ''));

    return `${file}`.trim();
  }

  embedSourceHtml(html: string, markdown?: string | null) {
    const source = markdown || '';
    if (!source) return this.stripSourceMarker(html);

    return `${this.stripSourceMarker(html)}\n<!-- kt-markdown-source:${Buffer.from(
      source,
      'utf8',
    ).toString('base64')} -->`;
  }

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

  stripSourceMarker(value?: unknown) {
    return `${value ?? ''}`.replace(MARKDOWN_SOURCE_PATTERN, '').trim();
  }

  private getProcessor() {
    if (!this.processorPromise) {
      this.processorPromise = this.createProcessor();
    }

    return this.processorPromise;
  }

  private getHtmlToMarkdownProcessor() {
    if (!this.htmlToMarkdownProcessorPromise) {
      this.htmlToMarkdownProcessorPromise =
        this.createHtmlToMarkdownProcessor();
    }

    return this.htmlToMarkdownProcessorPromise;
  }

  private getSanitizeHtmlProcessor() {
    if (!this.sanitizeHtmlProcessorPromise) {
      this.sanitizeHtmlProcessorPromise = this.createSanitizeHtmlProcessor();
    }

    return this.sanitizeHtmlProcessorPromise;
  }

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

  private createSanitizeSchema(defaultSchema: unknown) {
    const schema = defaultSchema as Record<string, any>;
    const attributes = schema.attributes || {};
    const classNameAttribute = ['className', CONTENT_CLASS_PATTERN];

    return {
      ...schema,
      tagNames: [
        ...new Set([
          ...(schema.tagNames || []),
          'figcaption',
          'figure',
        ]),
      ],
      attributes: {
        ...attributes,
        a: [...(attributes.a || []), 'target', 'rel', classNameAttribute],
        blockquote: [...(attributes.blockquote || []), classNameAttribute],
        code: [...(attributes.code || []), classNameAttribute],
        div: [...(attributes.div || []), classNameAttribute],
        figcaption: [...(attributes.figcaption || []), classNameAttribute],
        figure: [...(attributes.figure || []), classNameAttribute],
        h1: [...(attributes.h1 || []), classNameAttribute],
        h2: [...(attributes.h2 || []), classNameAttribute],
        h3: [...(attributes.h3 || []), classNameAttribute],
        h4: [...(attributes.h4 || []), classNameAttribute],
        h5: [...(attributes.h5 || []), classNameAttribute],
        h6: [...(attributes.h6 || []), classNameAttribute],
        img: [
          ...(attributes.img || []),
          'loading',
          classNameAttribute,
        ],
        li: [...(attributes.li || []), classNameAttribute],
        ol: [...(attributes.ol || []), classNameAttribute],
        p: [...(attributes.p || []), classNameAttribute],
        pre: [...(attributes.pre || []), classNameAttribute],
        span: [...(attributes.span || []), classNameAttribute],
        table: [...(attributes.table || []), classNameAttribute],
        tbody: [...(attributes.tbody || []), classNameAttribute],
        td: [...(attributes.td || []), classNameAttribute],
        th: [...(attributes.th || []), classNameAttribute],
        thead: [...(attributes.thead || []), classNameAttribute],
        tr: [...(attributes.tr || []), classNameAttribute],
        ul: [...(attributes.ul || []), classNameAttribute],
      },
    };
  }
}
