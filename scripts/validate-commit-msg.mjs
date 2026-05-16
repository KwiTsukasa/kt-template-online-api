import { readFileSync } from 'node:fs';

const messageFile = process.argv[2];
const firstLine = readFileSync(messageFile, 'utf8').split(/\r?\n/)[0].trim();

const releaseMessages = /^(?:Merge|Revert|fixup!|squash!)/;
const ktCommitPattern =
  /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([\w./-]+\))?: .+/;
const hasChineseText = /[\u4E00-\u9FFF]/;

if (releaseMessages.test(firstLine)) {
  process.exit(0);
}

if (!ktCommitPattern.test(firstLine) || !hasChineseText.test(firstLine)) {
  console.error(
    [
      '提交信息格式不正确。',
      '要求：英文类型前缀 + 可选 scope + 冒号空格 + 中文描述。',
      '示例：feat(api): 增加提交校验',
    ].join('\n'),
  );
  process.exit(1);
}
