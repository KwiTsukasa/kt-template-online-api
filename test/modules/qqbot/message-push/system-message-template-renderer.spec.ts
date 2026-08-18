import { SystemMessageTemplateRendererService } from '../../../../src/modules/message-management/application/system-message-template-renderer.service';

describe('SystemMessageTemplateRendererService', () => {
  const renderer = new SystemMessageTemplateRendererService();

  it('parses exact allowlisted tokens in text order and renders only scalar replacements', () => {
    const content = '端口 ${{oldPort}} 已变更为 ${{newPort}}。';

    expect(renderer.parse(content, ['oldPort', 'newPort'])).toEqual([
      { kind: 'text', value: '端口 ' },
      { key: 'oldPort', kind: 'variable' },
      { kind: 'text', value: ' 已变更为 ' },
      { key: 'newPort', kind: 'variable' },
      { kind: 'text', value: '。' },
    ]);
    expect(
      renderer.render('当前 STUN 端口为 ${{port}}，就绪：${{ready}}', {
        port: 38213,
        ready: true,
      }),
    ).toBe('当前 STUN 端口为 38213，就绪：true');
  });

  it.each([
    '${{missing}}',
    '${{__proto__}}',
    '${{prototype}}',
    '${{constructor}}',
    '${{a.b}}',
    '${{a[0]}}',
    '${{a()}}',
    '${{a + b}}',
    '${{nested${{a}}}}',
    '${{unclosed',
    'extra }}}',
    'prefix }} suffix',
  ])('rejects unsafe or incomplete template syntax %s', (content) => {
    expect(() => renderer.validate(content, ['endpoint', 'a'])).toThrow(
      expect.objectContaining({
        code: 'template_invalid',
      }),
    );
  });

  it('counts template content by Unicode code point, including emoji', () => {
    expect(() => renderer.validate('😀'.repeat(2_000), [])).not.toThrow();
    expect(() => renderer.validate('😀'.repeat(2_001), [])).toThrow(
      expect.objectContaining({
        code: 'template_invalid',
      }),
    );
  });

  it('enforces Unicode code-point limits for variables and rendered output', () => {
    expect(() =>
      renderer.render('${{value}}', { value: '😀'.repeat(500) }),
    ).not.toThrow();
    expect(() =>
      renderer.render('${{value}}', { value: '😀'.repeat(501) }),
    ).toThrow(
      expect.objectContaining({
        code: 'template_variable_too_long',
      }),
    );
    const outputTemplate = '${{value}}'.repeat(8);
    expect(() =>
      renderer.render(outputTemplate, { value: '😀'.repeat(500) }),
    ).not.toThrow();
    expect(() =>
      renderer.render(`x${outputTemplate}`, { value: '😀'.repeat(500) }),
    ).toThrow(
      expect.objectContaining({
        code: 'rendered_message_too_long',
      }),
    );
  });

  it('keeps CQ-looking text literal and replaces multiple tokens without evaluation', () => {
    expect(
      renderer.render('[CQ:image,file=x] ${{first}}/${{second}}', {
        first: 'alpha',
        second: 'beta',
      }),
    ).toBe('[CQ:image,file=x] alpha/beta');
  });

  it('normalizes malformed runtime values to the stable contract error', () => {
    expect(() => renderer.validate(42 as never, [])).toThrow(
      expect.objectContaining({ code: 'template_invalid' }),
    );
    expect(() => renderer.render('${{value}}', { value: Number.NaN })).toThrow(
      expect.objectContaining({ code: 'template_invalid' }),
    );
    expect(() => renderer.render('${{value}}', { value: Infinity })).toThrow(
      expect.objectContaining({ code: 'template_invalid' }),
    );
  });
});
