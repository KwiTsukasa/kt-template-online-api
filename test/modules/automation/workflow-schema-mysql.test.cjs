const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test(
  '旧活动身份列无损扩容，迁移可重入且长身份按大小写精确保存',
  { skip: !process.env.KT_AUTOMATION_TEST_DB, timeout: 45_000 },
  async () => {
    const database = process.env.KT_AUTOMATION_TEST_DB;
    assert.match(database, /^kt_template_local_automation_[a-z0-9_]+$/);
    require('ts-node').register({
      project: path.resolve('tsconfig.json'),
      files: true,
    });
    require('tsconfig-paths/register');
    const { createConnection } = require('mysql2/promise');
    const {
      ensureAutomationSchema,
    } = require('../../../src/commands/automation-migration/schema');
    const connection = await createConnection({
      host: '127.0.0.1',
      port: 3306,
      database,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    const runId = '9223372036854775700';
    try {
      const [[identity]] = await connection.query('SELECT @@server_uuid uuid');
      assert.equal(
        identity.uuid,
        process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID,
      );
      const [[rows]] = await connection.query(
        'SELECT COUNT(*) count FROM automation_workflow_bpmn_activity',
      );
      assert.equal(Number(rows.count), 0, '只允许调整本任务的空隔离活动表');
      await connection.query(
        'ALTER TABLE automation_workflow_bpmn_activity MODIFY COLUMN execution_id VARCHAR(191) NOT NULL',
      );
      await connection.execute(
        'INSERT INTO automation_workflow_bpmn_activity (run_id,execution_id,element_id,job,step_state) VALUES (?,?,?,?,?)',
        [
          runId,
          'existing',
          'legacy',
          JSON.stringify({ identity: 'kept' }),
          JSON.stringify({ status: 'waiting', visit: 1 }),
        ],
      );
      await assert.rejects(
        connection.execute(
          'INSERT INTO automation_workflow_bpmn_activity (run_id,execution_id,element_id,job,step_state) VALUES (?,?,?,?,?)',
          [runId, 'n'.repeat(239), 'node', '{}', '{}'],
        ),
        (error) => error.code === 'ER_DATA_TOO_LONG',
      );
      assert.equal(
        (await ensureAutomationSchema(connection, path.resolve('sql'))).length,
        28,
      );
      assert.equal(
        (await ensureAutomationSchema(connection, path.resolve('sql'))).length,
        28,
      );
      const [[column]] = await connection.query(
        "SELECT COLUMN_TYPE,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='automation_workflow_bpmn_activity' AND COLUMN_NAME='execution_id'",
      );
      assert.deepEqual(column, {
        COLUMN_TYPE: 'varchar(512)',
        COLLATION_NAME: 'utf8mb4_bin',
      });
      for (const [id, element] of [
        ['n'.repeat(239), 'Node'],
        ['N'.repeat(239), 'node'],
      ])
        await connection.execute(
          'INSERT INTO automation_workflow_bpmn_activity (run_id,execution_id,element_id,job,step_state) VALUES (?,?,?,?,?)',
          [runId, id, element, '{}', '{}'],
        );
      const [[exactNode]] = await connection.execute(
        'SELECT COUNT(*) count FROM automation_workflow_bpmn_activity WHERE run_id=? AND element_id=?',
        [runId, 'Node'],
      );
      assert.equal(Number(exactNode.count), 1);
      const [[kept]] = await connection.execute(
        'SELECT job,step_state FROM automation_workflow_bpmn_activity WHERE run_id=? AND execution_id=?',
        [runId, 'existing'],
      );
      assert.deepEqual(kept.job, { identity: 'kept' });
      assert.deepEqual(kept.step_state, { status: 'waiting', visit: 1 });
      const [[count]] = await connection.execute(
        'SELECT COUNT(*) count FROM automation_workflow_bpmn_activity WHERE run_id=?',
        [runId],
      );
      assert.equal(Number(count.count), 3);
    } finally {
      await connection.execute(
        'DELETE FROM automation_workflow_bpmn_activity WHERE run_id=?',
        [runId],
      );
      await connection.end();
    }
  },
);
