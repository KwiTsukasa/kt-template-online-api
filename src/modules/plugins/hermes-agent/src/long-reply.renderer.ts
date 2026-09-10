import { Canvas, type CanvasRenderingContext2D } from 'skia-canvas';

type MarkdownNode = {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  alt?: string;
  identifier?: string;
  ordered?: boolean;
  start?: number;
  children?: MarkdownNode[];
};
type Block = { text: string; style: 'body' | 'heading' | 'code' | 'quote' };
type Line = Block & { height: number };
export type LongReplyPage = { base64: string; text: string; height: number };

const WIDTH = 1080;
const MARGIN = 56;
const MAX_HEIGHT = 16000;
const MAX_PAGES = 4;
const FONT = '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;

/**
 * 把 GFM 标题、列表与脚注保留为排版块，外部资源只作为文字处理。
 * @param content - 模型已完成的全部回答。
 * @returns 带标题、代码和引用样式的完整文本块。
 */
async function parseBlocks(content: string): Promise<Block[]> {
  const [unified, parse, gfm] = await Promise.all([
    importEsm<typeof import('unified')>('unified'),
    importEsm<typeof import('remark-parse')>('remark-parse'),
    importEsm<typeof import('remark-gfm')>('remark-gfm'),
  ]);
  const tree = unified
    .unified()
    .use(parse.default)
    .use(gfm.default)
    .parse(content);
  return projectBlocks(tree as MarkdownNode);
}

/**
 * 保留行内文字和来源地址，图片以替代文字及地址呈现，避免渲染触发外部请求。
 * @param node - Markdown 行内或叶子节点。
 * @returns 可直接绘制且保留引用目标的文本。
 */
function inlineText(node: MarkdownNode): string {
  const children = (node.children || []).map(inlineText).join('');
  if (node.type === 'break') return '\n';
  if (node.type === 'link' || node.type === 'image') {
    const label = children || node.alt || '';
    if (!node.url || label === node.url) return label;
    return `${label} (${node.url})`;
  }
  if (node.type === 'footnoteReference') return `[${node.identifier}]`;
  if (node.type === 'linkReference' || node.type === 'imageReference') {
    return `${children || node.alt || ''} [${node.identifier}]`;
  }
  return node.value ?? children;
}

/**
 * 将列表和表格投影成手机可读的纵向段落，保留所有单元格、代码及脚注。
 * @param node - 当前 Markdown 结构节点。
 * @returns 按原文顺序排列的文本块。
 */
function projectBlocks(node: MarkdownNode): Block[] {
  const children = node.children || [];
  if (node.type === 'heading')
    return [{ text: inlineText(node), style: 'heading' }];
  if (node.type === 'code') return [{ text: node.value || '', style: 'code' }];
  if (node.type === 'thematicBreak') return [{ text: '──────', style: 'body' }];
  if (node.type === 'definition') {
    return [{ text: `[${node.identifier}]: ${node.url}`, style: 'body' }];
  }
  if (node.type === 'footnoteDefinition') {
    const blocks = children.flatMap(projectBlocks);
    if (blocks[0]) blocks[0].text = `[${node.identifier}] ${blocks[0].text}`;
    return blocks;
  }
  if (node.type === 'blockquote') {
    return children
      .flatMap(projectBlocks)
      .map((block) => ({ ...block, style: 'quote' }));
  }
  if (node.type === 'list') {
    return children.flatMap((item, index) => {
      const blocks = projectBlocks(item);
      let marker = '• ';
      if (node.ordered) marker = `${(node.start || 1) + index}. `;
      if (blocks[0]) blocks[0].text = marker + blocks[0].text;
      return blocks;
    });
  }
  if (node.type === 'table') {
    const headers = (children[0]?.children || []).map(inlineText);
    const rows = children.slice(1).map((row) => ({
      text: (row.children || [])
        .map((cell, index) => `${headers[index] || ''}：${inlineText(cell)}`)
        .join('\n'),
      style: 'body' as const,
    }));
    if (rows.length) return rows;
    return [{ text: headers.join(' / '), style: 'body' }];
  }
  if (node.type === 'paragraph' || node.type === 'html') {
    const text = inlineText(node);
    if (/^[一二三四五六七八九十]+、[^\n]{1,40}$/u.test(text)) {
      return [{ text, style: 'heading' }];
    }
    return [{ text, style: 'body' }];
  }
  return children.flatMap(projectBlocks);
}

/**
 * 为测量和绘制应用同一字号，防止长链接、中文和代码出现裁边。
 * @param context - 当前画布的文字上下文。
 * @param style - 段落样式。
 * @returns 当前字号对应的行高。
 */
function applyStyle(
  context: CanvasRenderingContext2D,
  style: Block['style'],
): number {
  context.font = `28px ${FONT}`;
  if (style === 'heading') {
    context.font = `bold 36px ${FONT}`;
    return 54;
  }
  if (style === 'code') context.font = `26px monospace, ${FONT}`;
  return 44;
}

/**
 * 优先按词换行，超长词才按字素拆分；组合表情和行尾标点保持完整。
 * @param blocks - 待排版文本块。
 * @returns 高度受限、按顺序分组的显示行。
 * @throws 超过四张长图时拒绝整个渲染，交由调用方使用显式文字回退。
 */
function layoutPages(blocks: Block[]): Line[][] {
  const measure = new Canvas(1, 1).getContext('2d');
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
  const pages: Line[][] = [[]];
  let height = MARGIN * 2 + 44;
  for (const block of blocks) {
    const lineHeight = applyStyle(measure, block.style);
    const widths = new Map<string, number>();
    const append = (text: string, rowHeight = lineHeight) => {
      if (height + rowHeight > MAX_HEIGHT) {
        pages.push([]);
        height = MARGIN * 2 + 44;
      }
      pages[pages.length - 1].push({
        text,
        style: block.style,
        height: rowHeight,
      });
      height += rowHeight;
    };
    for (const paragraph of block.text.split('\n')) {
      let line = '';
      let width = 0;
      const measureWidth = (segment: string) => {
        let size = widths.get(segment);
        if (size === undefined) {
          size = measure.measureText(segment).width;
          widths.set(segment, size);
        }
        return size;
      };
      const available = WIDTH - MARGIN * 2 - 24;
      const tokens = Array.from(
        segmenter.segment(paragraph),
        ({ segment }) => segment,
      ).flatMap((word) => {
        if (measureWidth(word) <= available) return [word];
        return Array.from(graphemes.segment(word), ({ segment }) => segment);
      });
      for (const [index, segment] of tokens.entries()) {
        const size = measureWidth(segment);
        let reserved = 0;
        const next = tokens[index + 1] || '';
        if (/^[，。；：！？、）】》」』,.!?;:)]/u.test(next))
          reserved = measureWidth(next);
        if (/^[（【《「『(]$/u.test(segment))
          reserved = Math.min(measureWidth(next), available / 2);
        if (width + size + reserved > available && line) {
          append(line);
          line = '';
          width = 0;
        }
        line += segment;
        width += size;
      }
      append(line);
    }
    append('', 18);
  }
  if (pages.length > MAX_PAGES) throw new Error('长图超过分页预算');
  return pages;
}

/**
 * 在插件所在的 NAS 工作线程生成完整回答 PNG，逐页释放画布并限制尺寸、体积和耗时。
 * @param content - 未截断的最终回答。
 * @param deadlineAt - 绝对渲染截止时间，为后续平台上传保留时间。
 * @returns 顺序长图及各页文字回退内容。
 * @throws 回答超过三万二千字符、渲染超时、分页或图片体积超限时抛出错误。
 */
export async function renderLongReply(
  content: string,
  deadlineAt: number,
): Promise<LongReplyPage[]> {
  if (Array.from(content).length > 32000)
    throw new Error('长图正文超过渲染预算');
  const pages = layoutPages(await parseBlocks(content));
  const result: LongReplyPage[] = [];
  for (const [index, lines] of pages.entries()) {
    if (Date.now() >= deadlineAt) throw new Error('长图渲染超时');
    const height =
      MARGIN * 2 + 44 + lines.reduce((sum, line) => sum + line.height, 0);
    const canvas = new Canvas(WIDTH, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fafbfc';
    context.fillRect(0, 0, WIDTH, height);
    context.fillStyle = '#8b6bb1';
    context.fillRect(MARGIN, 28, 72, 5);
    context.textBaseline = 'top';
    let y = MARGIN;
    for (const line of lines) {
      applyStyle(context, line.style);
      if (line.style === 'code' || line.style === 'quote') {
        context.fillStyle = '#edf0f4';
        context.fillRect(MARGIN - 12, y, WIDTH - MARGIN * 2 + 24, line.height);
      }
      context.fillStyle = '#232b36';
      context.fillText(line.text, MARGIN, y + 4);
      y += line.height;
    }
    context.font = `22px ${FONT}`;
    context.fillStyle = '#737b87';
    context.fillText(`${index + 1} / ${pages.length}`, MARGIN, y + 18);
    const bytes = await canvas.toBuffer('png');
    canvas.width = 1;
    canvas.height = 1;
    if (Date.now() >= deadlineAt) throw new Error('长图渲染超时');
    if (bytes.length > 8 * 1024 * 1024) throw new Error('长图超过图片体积预算');
    result.push({
      base64: bytes.toString('base64'),
      text: lines.map((line) => line.text).join('\n'),
      height,
    });
  }
  return result;
}
