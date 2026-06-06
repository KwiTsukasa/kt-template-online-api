import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';

const CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const CHECK_ROOTS = ['src/', 'test/', 'apps/', 'libs/'];
const MAX_COMMAND_LENGTH = process.platform === 'win32' ? 4000 : 120000;

function run(command, args) {
  const result = spawnSync(command, args, {
    shell: process.platform === 'win32' && command === 'pnpm',
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function output(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

function getPnpmCommand() {
  return 'pnpm';
}

function chunkArgs(baseArgs, values) {
  const chunks = [];
  let currentChunk = [];
  let currentLength = baseArgs.join(' ').length;

  for (const value of values) {
    const valueLength = value.length + 3;
    if (
      currentChunk.length > 0 &&
      currentLength + valueLength > MAX_COMMAND_LENGTH
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = baseArgs.join(' ').length;
    }
    currentChunk.push(value);
    currentLength += valueLength;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function getStagedFiles() {
  return output('git', [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMR',
    '-z',
  ])
    .split('\0')
    .map((file) => file.replaceAll('\\', '/'))
    .filter(Boolean);
}

const files = getStagedFiles().filter((file) => {
  if (!existsSync(file)) return false;
  if (!CHECK_ROOTS.some((root) => file.startsWith(root))) return false;

  return CHECK_EXTENSIONS.has(extname(file));
});

if (files.length === 0) {
  console.info('[husky] no staged files need eslint.');
  process.exit(0);
}

const eslintBaseArgs = [
  'exec',
  'eslint',
  '--cache',
  '--cache-location',
  'node_modules/.cache/husky-eslint/',
];

for (const chunk of chunkArgs(eslintBaseArgs, files)) {
  run(getPnpmCommand(), [...eslintBaseArgs, ...chunk]);
}
