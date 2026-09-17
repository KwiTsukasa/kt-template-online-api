const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { resolve, join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = resolve(__dirname, '../../../..');
const output = resolve(process.argv[2]);
const cases = {
  baseline: [],
  transaction: ['Transaction'],
  compensation: [
    'CompensateEventDefinition',
    'IntermediateThrowEvent',
    'EndEvent',
  ],
  boundary: ['BoundaryEvent'],
  concurrentTask: [
    'ServiceTask',
    'BusinessRuleTask',
    'SendTask',
    'ScriptTask',
    'UserTask',
  ],
  repeatingEvent: [
    'SignalEventDefinition',
    'MessageEventDefinition',
    'EscalationEventDefinition',
  ],
  eventSubprocess: ['SubProcess'],
  inclusiveGateway: ['InclusiveGateway'],
  complexGateway: ['ComplexGateway'],
  eventGateway: ['EventBasedGateway'],
  standardLoop: ['StandardLoopCharacteristics'],
  multiInstance: ['MultiInstanceLoopCharacteristics'],
};
const selected = process.argv.slice(3);
const files = readdirSync(resolve(__dirname, '..'))
  .filter((name) => /^workflow-bpmn-.*\.test\.cjs$/.test(name))
  .sort()
  .map((name) => resolve(__dirname, '..', name));
const sourceRoots = ['src/modules/workflow-engine', 'src/common/automation'];
const sourceFiles = sourceRoots
  .flatMap((directory) =>
    readdirSync(join(root, directory), { recursive: true })
      .filter((name) => /\.ts$/.test(name))
      .map((name) => join(directory, name)),
  )
  .sort();
const sourceSha256 = createHash('sha256');
for (const name of sourceFiles)
  sourceSha256.update(name).update(readFileSync(join(root, name)));
const identity = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceSha256: sourceSha256.digest('hex'),
  sourceFiles,
  node: process.version,
  files,
};
mkdirSync(output, { recursive: true });

const run = (name, remove) =>
  new Promise((resolveRun) => {
    const audit = join(output, name + '-applied.jsonl');
    writeFileSync(audit, '');
    let log = '';
    let timedOut = false;
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [
        '--require',
        join(__dirname, 'preload.cjs'),
        '--test',
        '--test-concurrency=4',
        '--test-timeout=30000',
        ...files,
      ],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          KT_ABLATION_REMOVE: JSON.stringify(remove),
          KT_ABLATION_AUDIT: audit,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (chunk) => {
      log += chunk;
    });
    child.stderr.on('data', (chunk) => {
      log += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 120000);
    child.on('error', (error) => {
      log += error.stack;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      writeFileSync(join(output, name + '.log'), log);
      const count = (label) =>
        Number(
          log.match(new RegExp('^# ' + label + ' (\\d+)$', 'm'))?.[1] ?? 0,
        );
      const applied = readFileSync(audit, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const result = {
        name,
        remove,
        code,
        signal,
        timedOut,
        suiteWallMs: Math.round(performance.now() - started),
        tests: count('tests'),
        pass: count('pass'),
        fail: count('fail'),
        cancelled: count('cancelled'),
        skipped: count('skipped'),
        engineCreations: applied.length,
        appliedEveryTime:
          applied.length > 0 &&
          applied.every(
            (item) => JSON.stringify(item.applied) === JSON.stringify(remove),
          ),
        failures: [...log.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(
          (match) => match[1],
        ),
      };
      writeFileSync(
        join(output, name + '.json'),
        JSON.stringify({ ...identity, ...result }, null, 2),
      );
      console.log(
        JSON.stringify({ ...result, failures: result.failures.length }),
      );
      resolveRun(result);
    });
  });

(async () => {
  const results = [];
  for (const [name, remove] of Object.entries(cases)) {
    if (selected.length && !selected.includes(name)) continue;
    results.push(await run(name, remove));
  }
  writeFileSync(
    join(output, 'summary.json'),
    JSON.stringify(
      {
        ...identity,
        results,
        interpretation:
          '差异仅证明这些测试对被移除的适配敏感；零差异不证明适配冗余。套件耗时包括解析与测试启动，不能当作运行时性能指标。',
      },
      null,
      2,
    ),
  );
  const baseline = results.find((result) => result.name === 'baseline');
  if (baseline && (baseline.code !== 0 || !baseline.appliedEveryTime))
    process.exitCode = 1;
})();
