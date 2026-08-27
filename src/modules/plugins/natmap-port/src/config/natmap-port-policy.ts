export const NATMAP_PORT_QUERY_POLICY = Object.freeze({
  helpTokens: ['--help', '-h', 'help', '帮助'],
  maxSelectorLength: 80,
  sensitiveSelectorPattern:
    /(?:\b(?:\d{1,3}\.){3}\d{1,3}\b|:\d{2,5}\b|:\/\/|[\\/@]|\blocalhost\b|\.(?:internal|lan|local)\b)/iu,
});

export const NATMAP_PORT_HELP_TEXT = [
  '用法：/natmap [通道名称]',
  '不指定名称时仅在唯一通道下返回结果。',
  '只显示 TCP 动态端口和有效时间，不显示任何 IP 或内部目标。',
].join('\n');
