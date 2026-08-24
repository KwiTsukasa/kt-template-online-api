import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const drillScript = join(
  process.cwd(),
  'scripts/media-governance/backup-restore-drill.sh',
);

describe('media governance backup and restore drill', () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'kt-media-backup-restore-'));
    temporaryRoots.push(root);
    const bin = join(root, 'bin');
    const output = join(root, 'evidence');
    const log = join(root, 'mysql.log');
    mkdirSync(bin);

    const mysql = join(bin, 'mysql');
    writeFileSync(
      mysql,
      `#!/usr/bin/env bash
set -Eeuo pipefail
database=''
query=''
for argument in "$@"; do
  case "$argument" in
    --database=*) database=\${argument#--database=} ;;
    --execute=*) query=\${argument#--execute=} ;;
  esac
done
printf 'mysql\\tdatabase=%s\\tquery=%s\\n' "$database" "$query" >>"$KT_FAKE_MYSQL_LOG"
if [[ -z $query ]]; then
  bytes=$(wc -c | awk '{print $1}')
  printf 'import\\tdatabase=%s\\tbytes=%s\\n' "$database" "$bytes" >>"$KT_FAKE_MYSQL_LOG"
  exit 0
fi
case "$query" in
  *information_schema.tables*) printf '%s\\n' "\${KT_FAKE_SCHEMA_TABLE_COUNT:-19}" ;;
  *information_schema.schemata*) printf '0\\n' ;;
  'CREATE DATABASE '*|'DROP DATABASE '*) ;;
  'SELECT COUNT(*) FROM \`'*)
    table=\${query#*\\\`}
    table=\${table%%\\\`*}
    case "$table" in
      media_governance_task|media_governance_unit|media_governance_source|media_governance_descriptor_revision|media_governance_run|media_governance_outbox|media_governance_series|media_governance_work|media_governance_work_external_ref|media_governance_season|media_governance_episode|media_governance_task_episode_binding) printf '1\\n' ;;
      media_governance_event) printf '2\\n' ;;
      media_governance_agent_session|media_governance_metadata_exception|media_governance_operator_decision|media_governance_series_external_ref|media_governance_rss_subscription|media_governance_rss_item) printf '0\\n' ;;
      *) printf 'unexpected table: %s\\n' "$table" >&2; exit 9 ;;
    esac
    ;;
  *'FROM media_governance_task ORDER BY id'*)
    printf 'media-task-fixture\\tmedia-series-fixture\\tmedia-work-fixture\\tlegacy-pipeline\\t7\\tgovernance\\trunning\\tmedia-run-fixture\\t%s\\t%s\\t\\n' "$(printf a%.0s {1..64})" "$(printf b%.0s {1..64})"
    ;;
  *'FROM media_governance_run ORDER BY id'*)
    printf 'media-run-fixture\\tmedia-task-fixture\\t7\\tgovernance.execute\\trunning\\tmedia-task-fixture:governance.execute:r7\\t%s\\t%s\\t\\n' "$(printf a%.0s {1..64})" "$(printf b%.0s {1..64})"
    ;;
  *'FROM media_governance_event ORDER BY'*)
    printf 'media-run-fixture:1\\tmedia-task-fixture\\tmedia-run-fixture\\t1\\trun-started\\tgovernance\\trunning\\n'
    event_queries=$(grep -c 'FROM media_governance_event ORDER BY' "$KT_FAKE_MYSQL_LOG" || true)
    if [[ $database == kt_fixture_source && \${KT_FAKE_SOURCE_DRIFT:-0} == 1 && $event_queries -gt 1 ]]; then
      printf 'media-run-fixture:2\\tmedia-task-fixture\\tmedia-run-fixture\\t9\\trun-progress\\tgovernance\\trunning\\n'
    elif [[ $database == kt_media_governance_restore_* && \${KT_FAKE_RESTORE_DRIFT:-0} == 1 ]]; then
      printf 'media-run-fixture:2\\tmedia-task-fixture\\tmedia-run-fixture\\t9\\trun-progress\\tgovernance\\trunning\\n'
    else
      printf 'media-run-fixture:2\\tmedia-task-fixture\\tmedia-run-fixture\\t2\\trun-progress\\tgovernance\\trunning\\n'
    fi
    ;;
  *'FROM media_governance_series ORDER BY id'*)
    printf 'media-series-fixture\\ttmdb\\ttv\\t30984\\t死神\\t2004\\ttv\\tmedia-work-fixture\\t1\\tactive\\n'
    ;;
  *'FROM media_governance_work ORDER BY'*)
    printf 'media-work-fixture\\tmedia-series-fixture\\ttmdb\\ttv\\t30984\\t死神\\t2004\\ttv\\t1\\tactive\\n'
    ;;
  *'FROM media_governance_work_external_ref ORDER BY'*)
    printf 'media-work-ref-fixture\\tmedia-work-fixture\\ttmdb\\ttv\\t30984\\tcanonical\\t死神\\t2004\\n'
    ;;
  *'FROM media_governance_season ORDER BY'*)
    printf 'media-season-fixture\\tmedia-series-fixture\\tmedia-work-fixture\\t2\\t1\\t50\\t千年血战篇\\t2022\\tknown\\n'
    ;;
  *'FROM media_governance_episode ORDER BY'*)
    printf 'media-episode-fixture\\tmedia-series-fixture\\tmedia-season-fixture\\t2\\t1\\tcompleted\\n'
    ;;
  *'FROM media_governance_task_episode_binding ORDER BY'*)
    printf 'media-binding-fixture\\tmedia-series-fixture\\tmedia-season-fixture\\tmedia-episode-fixture\\tmedia-task-fixture\\t\\texecution-history\\n'
    ;;
  *'FROM media_governance_rss_subscription ORDER BY'*) ;;
  *'FROM media_governance_rss_item ORDER BY'*) ;;
  *) printf 'unexpected query: %s\\n' "$query" >&2; exit 10 ;;
esac
`,
      'utf8',
    );
    chmodSync(mysql, 0o700);

    const mysqldump = join(bin, 'mysqldump');
    writeFileSync(
      mysqldump,
      `#!/usr/bin/env bash
set -Eeuo pipefail
result_file=''
printf 'dump' >>"$KT_FAKE_MYSQL_LOG"
for argument in "$@"; do
  printf '\\t%s' "$argument" >>"$KT_FAKE_MYSQL_LOG"
  case "$argument" in
    --result-file=*) result_file=\${argument#--result-file=} ;;
  esac
done
printf '\\n' >>"$KT_FAKE_MYSQL_LOG"
[[ -n $result_file ]]
printf '%s\\n' '-- isolated media governance fixture' >"$result_file"
`,
      'utf8',
    );
    chmodSync(mysqldump, 0o700);

    return { log, mysql, mysqldump, output, root };
  }

  function runDrill(
    current: ReturnType<typeof fixture>,
    extraEnv: NodeJS.ProcessEnv = {},
  ) {
    return spawnSync(
      'bash',
      [
        drillScript,
        '--source-database',
        'kt_fixture_source',
        '--restore-database',
        'kt_media_governance_restore_fixture',
        '--output-directory',
        current.output,
        '--timeout-seconds',
        '5',
        '--execute',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          KT_FAKE_MYSQL_LOG: current.log,
          KT_MEDIA_MYSQL_BIN: current.mysql,
          KT_MEDIA_MYSQLDUMP_BIN: current.mysqldump,
          ...extraEnv,
        },
        timeout: 10_000,
      },
    );
  }

  it('defaults to a zero-write plan without requiring database clients', () => {
    const current = fixture();
    const result = spawnSync(
      'bash',
      [
        drillScript,
        '--source-database',
        'kt_fixture_source',
        '--restore-database',
        'kt_media_governance_restore_fixture',
        '--output-directory',
        current.output,
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mode=plan-only');
    expect(result.stdout).toContain('execution=skipped');
    expect(() => readdirSync(current.output)).toThrow();
  });

  it('backs up the exact nineteen task, catalog and RSS tables', () => {
    const current = fixture();
    const result = runDrill(current);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('restore=verified');
    expect(result.stdout).toContain('cleanup.restoreDatabaseDropped=true');
    const evidencePath = result.stdout
      .split('\n')
      .find((line) => line.startsWith('evidence='))
      ?.slice('evidence='.length);
    expect(evidencePath).toBeTruthy();
    const evidence = JSON.parse(readFileSync(evidencePath!, 'utf8'));
    expect(evidence).toMatchObject({
      profile: 'media-governance-backup-restore-v1',
      restoreDatabaseDropped: true,
      restoreVerified: true,
      schemaVersion: '1.0.0',
      tableCount: 19,
      writeBoundaries: {
        cloud: 0,
        media: 0,
        positiveFixtures: 0,
        sourceDatabase: 0,
        ui: 0,
      },
    });
    expect(evidence.dump.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.snapshots).toEqual({
      bindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      episodeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      eventSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      rssItemSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      rssSubscriptionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      runSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      seasonSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      seriesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      tableCountsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      taskSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      workReferenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      workSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });

    const log = readFileSync(current.log, 'utf8');
    const dumpLine = log.split('\n').find((line) => line.startsWith('dump\t'));
    expect(dumpLine).toBeTruthy();
    for (const table of [
      'media_governance_task',
      'media_governance_unit',
      'media_governance_source',
      'media_governance_descriptor_revision',
      'media_governance_run',
      'media_governance_event',
      'media_governance_agent_session',
      'media_governance_metadata_exception',
      'media_governance_operator_decision',
      'media_governance_outbox',
      'media_governance_series',
      'media_governance_work',
      'media_governance_work_external_ref',
      'media_governance_series_external_ref',
      'media_governance_season',
      'media_governance_episode',
      'media_governance_task_episode_binding',
      'media_governance_rss_subscription',
      'media_governance_rss_item',
    ]) {
      expect(dumpLine).toContain(`\t${table}`);
    }
    expect(log).toContain(
      'query=CREATE DATABASE `kt_media_governance_restore_fixture`',
    );
    expect(log).toContain(
      'import\tdatabase=kt_media_governance_restore_fixture',
    );
    expect(log).toContain(
      'query=DROP DATABASE `kt_media_governance_restore_fixture`',
    );
    const sourceQueries = log
      .split('\n')
      .filter((line) => line.includes('database=kt_fixture_source'));
    expect(sourceQueries.length).toBeGreaterThan(0);
    expect(sourceQueries.every((line) => line.includes('query=SELECT '))).toBe(
      true,
    );
  });

  it('backs up the legacy seventeen tables before the Work migration', () => {
    const current = fixture();
    const result = runDrill(current, { KT_FAKE_SCHEMA_TABLE_COUNT: '17' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const evidencePath = result.stdout
      .split('\n')
      .find((line) => line.startsWith('evidence='))
      ?.slice('evidence='.length);
    const evidence = JSON.parse(readFileSync(evidencePath!, 'utf8'));
    expect(evidence.tableCount).toBe(17);
    const log = readFileSync(current.log, 'utf8');
    const dumpLine = log.split('\n').find((line) => line.startsWith('dump\t'));
    expect(dumpLine).not.toContain('\tmedia_governance_work');
    expect(result.stdout).toContain('restore=verified');
  });

  it('uses the existing SHA-256 verifier instead of requiring cmp', () => {
    const current = fixture();
    const cmp = join(current.root, 'bin', 'cmp');
    writeFileSync(cmp, '#!/usr/bin/env bash\nexit 93\n', 'utf8');
    chmodSync(cmp, 0o700);

    const result = runDrill(current, {
      PATH: `${join(current.root, 'bin')}:${process.env.PATH ?? ''}`,
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('restore=verified');
  });

  it('fails closed on restored event drift and still removes the isolated database', () => {
    const current = fixture();
    const result = runDrill(current, { KT_FAKE_RESTORE_DRIFT: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'restored event snapshot differs from source',
    );
    const log = readFileSync(current.log, 'utf8');
    expect(log).toContain(
      'query=DROP DATABASE IF EXISTS `kt_media_governance_restore_fixture`',
    );
    expect(result.stdout).not.toContain('restore=verified');
  });

  it('fails before restore when the source changes during the backup window', () => {
    const current = fixture();
    const result = runDrill(current, { KT_FAKE_SOURCE_DRIFT: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'source event snapshot changed during backup window',
    );
    const log = readFileSync(current.log, 'utf8');
    expect(log).not.toContain('query=CREATE DATABASE');
    expect(log).not.toContain('import\\tdatabase=');
    expect(result.stdout).not.toContain('restore=verified');
  });
});
