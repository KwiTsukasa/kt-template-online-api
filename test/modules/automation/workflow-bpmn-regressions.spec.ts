import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('BPMN 专项发布门禁', () => {
  it('通过默认 Jest 入口执行全部 Node 令牌与检查点回归', () => {
    const files = readdirSync(__dirname)
      .filter((name) => /^workflow-bpmn-.*\.test\.cjs$/.test(name))
      .sort()
      .map((name) => join(__dirname, name));
    expect(files.length).toBeGreaterThan(0);
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-concurrency=2', ...files],
      {
        cwd: resolve(__dirname, '../../..'),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 90_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`BPMN 专项失败：\n${result.stdout}\n${result.stderr}`);
    expect(result.stdout).toMatch(/^# fail 0$/m);
    expect(result.stdout).toMatch(/^# cancelled 0$/m);
    console.info(
      result.stdout
        .split('\n')
        .filter((line) => /^# (tests|pass|fail|cancelled|skipped) /.test(line))
        .join('\n'),
    );
  }, 95_000);
});
