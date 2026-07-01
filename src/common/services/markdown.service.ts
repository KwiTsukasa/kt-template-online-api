import { Injectable } from '@nestjs/common';

type MarkdownProcessor = {
  process: (value: string) => Promise<unknown>;
};

type HastNode = {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type?: string;
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
  /^(kt-md-|wp-|align|size-|is-|has-|language-|attachment-|hljs(?:-|$)|fa(?:-|$)|fancybox-|lazyload(?:-|$)|collapse-block|bash$|coffeescript$|css$|dockerfile$|html$|java$|javascript$|json$|markdown$|md$|nginx$|php$|plaintext$|python$|scss$|shell$|sql$|text$|typescript$|xml$|yaml$|yml$)/;
const CONTENT_CLASS_ATTRIBUTE = ['className', CONTENT_CLASS_PATTERN];
const CONTENT_HTML_ATTRIBUTES = [
  'dataLineNumber',
  'data-line-number',
  'hljsCodeblockInner',
  'hljs-codeblock-inner',
  'id',
  'tooltip',
  'tooltipDisableBreakline',
  'tooltip-disable-breakline',
  'tooltipEnableBreakline',
  'tooltip-enable-breakline',
  'tooltipExitFullscreen',
  'tooltip-exit-fullscreen',
  'tooltipFullscreen',
  'tooltip-fullscreen',
  'tooltipHideLinenumber',
  'tooltip-hide-linenumber',
  'tooltipShowLinenumber',
  'tooltip-show-linenumber',
];
const EXTRA_TAG_NAMES = [
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
];
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
  'i',
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
      .use(this.createArgonCodeblockPlugin())
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
      CONTENT_CLASS_TAG_NAMES.map((tagName) => {
        const tagAttributes = (attributes[tagName] || []).filter(
          (attribute) =>
            !Array.isArray(attribute) || attribute[0] !== 'className',
        );

        return [
          tagName,
          [...tagAttributes, ...CONTENT_HTML_ATTRIBUTES, CONTENT_CLASS_ATTRIBUTE],
        ];
      }),
    );

    return {
      ...schema,
      clobberPrefix: '',
      tagNames: [...new Set([...(schema.tagNames || []), ...EXTRA_TAG_NAMES])],
      attributes: {
        ...attributes,
        ...classAttributes,
        a: [
          ...(attributes.a || []).filter(
            (attribute) =>
              !Array.isArray(attribute) || attribute[0] !== 'className',
          ),
          'target',
          'rel',
          ...CONTENT_HTML_ATTRIBUTES,
          CONTENT_CLASS_ATTRIBUTE,
        ],
        img: [
          ...(attributes.img || []).filter(
            (attribute) =>
              !Array.isArray(attribute) || attribute[0] !== 'className',
          ),
          'loading',
          ...CONTENT_HTML_ATTRIBUTES,
          CONTENT_CLASS_ATTRIBUTE,
        ],
      },
    };
  }

  /**
   * 创建 Markdown code fence 到 Argon 代码块 DOM 的 rehype 转换插件。
   * @returns rehype transformer；会原地补齐 pre/code class，最终仍由 sanitizer 过滤。
   */
  private createArgonCodeblockPlugin() {
    return () => (tree: HastNode) => {
      this.visitHast(tree, (node) => {
        if (node.type !== 'element' || node.tagName !== 'pre') return;

        const codeNode = node.children?.find(
          (child) => child.type === 'element' && child.tagName === 'code',
        );
        if (!codeNode) return;

        const language = this.normalizeCodeLanguage(
          codeNode.properties?.className,
        );
        const codeClassNames = this.toClassList(
          codeNode.properties?.className,
        ).filter((className) => !className.startsWith('language-'));

        node.properties = {
          ...node.properties,
          className: this.mergeClassNames(node.properties?.className, [
            'wp-block-code',
            'hljs-codeblock',
          ]),
        };
        codeNode.properties = {
          ...codeNode.properties,
          className: this.mergeClassNames(codeClassNames, ['hljs', language]),
        };
      });
    };
  }

  /**
   * 深度遍历 HAST 节点树，供无额外依赖的小型 rehype 转换使用。
   * @param node - 当前 HAST 节点；缺少 children 时只访问当前节点。
   * @param visitor - 对每个节点执行的同步访问函数。
   */
  private visitHast(node: HastNode, visitor: (node: HastNode) => void) {
    visitor(node);
    node.children?.forEach((child) => this.visitHast(child, visitor));
  }

  /**
   * 将 remark-rehype 生成的 language-* class 规范化为 Blog Argon 使用的 hljs 语言名。
   * @param className - HAST className 属性，可能是数组、字符串或空值。
   * @returns sanitizer 白名单允许的标准语言名；无语言时返回 plaintext。
   */
  private normalizeCodeLanguage(className: unknown) {
    const language = this.toClassList(className)
      .find((className) => className.startsWith('language-'))
      ?.replace(/^language-/, '')
      .toLowerCase();

    if (!language) return 'plaintext';
    if (language === 'ts') return 'typescript';
    if (language === 'js') return 'javascript';
    if (language === 'bash' || language === 'sh') return 'shell';

    return language;
  }

  /**
   * 合并 className 属性并保持必需 class 在前，避免重复 class 影响 Argon 选择器。
   * @param current - 现有 className 属性或 class 数组。
   * @param required - 当前转换必须注入的 Argon/hljs class。
   * @returns 去重后的 className 数组，交给 rehype-stringify 输出。
   */
  private mergeClassNames(current: unknown, required: string[]) {
    return [...new Set([...required, ...this.toClassList(current)])];
  }

  /**
   * 将 HAST className 属性转换成可安全合并的字符串数组。
   * @param value - HAST className 属性，支持字符串、字符串数组和空值。
   * @returns 过滤空白后的 class 名列表。
   */
  private toClassList(value: unknown) {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.toClassList(item));
    }
    if (typeof value === 'string') {
      return value.split(/\s+/).filter(Boolean);
    }

    return [];
  }
}
