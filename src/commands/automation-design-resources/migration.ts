import type {
  Connection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DataSource } from 'typeorm';
import { createSnowflakeId } from '../../common/snowflake/snowflake-id';
import { withMysqlConnectionLock } from '../../common/locks/database-lock';
import { automationDigest } from '../../common/automation/content-digest';
import { MediaGovernanceWorkflow } from '../../modules/admin/media-governance/application/media-governance.workflow';
import { WorkflowDefinitionService } from '../../modules/workflow-engine/application/workflow-definition.service';
import { WorkflowProcessRegistry } from '../../modules/workflow-engine/application/workflow-process.registry';
import { WorkflowScriptRegistry } from '../../modules/workflow-engine/application/workflow-script.registry';
import { parseWorkflowBpmn } from '../../modules/workflow-engine/domain/workflow-bpmn.policy';
import { readBpmnStep } from '../../modules/workflow-engine/domain/workflow-document.policy';
import type { WorkflowBpmnDefinition } from '../../modules/workflow-engine/contract/workflow-bpmn.types';
import type { PublishedReference } from '../../common/automation/definition.types';
import {
  MEDIA_FORM,
  MEDIA_FORM_NAME,
  MEDIA_FORM_SOURCE,
  MEDIA_RULE,
  MEDIA_RULE_NAME,
  MEDIA_RULE_SOURCE,
  designResourceDigest,
  extractMediaDesignResources,
  isExtractedMediaDefinition,
} from './model';

type DefinitionRow = {
  id: string;
  source_key: string | null;
  name: string;
  description: string;
  revision: number;
  published_version: number | null;
  definition: WorkflowBpmnDefinition;
};
type ResourceRow = Omit<DefinitionRow, 'definition'> & { definition: unknown };
type PublishedRow = {
  definition_id: string;
  version: number;
  name: string;
  description: string;
  definition: unknown;
};
type BindingRow = {
  process_key: string;
  scope_id: string;
  process_version: number;
  workflow_id: string;
  workflow_version: number;
  revision: number;
};
type Snapshot = {
  identity: { databaseName: string; serverUuid: string };
  draft: DefinitionRow;
  published: PublishedRow;
  binding: BindingRow;
  form: ResourceRow | null;
  formPublished: PublishedRow | null;
  rule: ResourceRow | null;
  rulePublished: PublishedRow | null;
};
export type DesignResourcePlan = {
  schemaVersion: 1;
  status: 'ready' | 'already-extracted';
  target: {
    databaseName: string;
    serverUuid: string;
    workflowId: string;
    revision: number;
    publishedVersion: number;
    sourceDigest: string;
    snapshotDigest: string;
  };
  resources: { form: PublishedReference; rule: PublishedReference };
  definition: WorkflowBpmnDefinition;
  resultDigest: string;
};

/**
 * 读取 MySQL 的 JSON 列，兼容原生对象和尚未解析的字符串。
 * @param value - 连接返回的 JSON 列。
 * @returns 完整 JSON 内容。
 */
function jsonValue(value: unknown): any {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

/**
 * 要求转换前后的数据库身份和资源状态完整匹配，阻止无条件写入。
 * @param valid - 身份或状态检查结果。
 * @param message - 失败原因。
 * @throws 检查失败时停止预演或事务。
 */
function requireMatch(valid: unknown, message: string): asserts valid {
  if (!valid) throw new Error(`公用设计资源迁移拒绝：${message}`);
}

/**
 * 按白名单表读取来源唯一的公用资源，不把已有用户资源当作可覆盖模板。
 * @param connection - 当前预演或应用事务的专用连接。
 * @param table - 独立表单或规则表。
 * @param sourceKey - 稳定迁移来源。
 * @param lock - 应用事务是否需要排他锁。
 * @returns 已有草稿和首个发布快照，资源尚未建立时均为空。
 * @throws 来源键重复或发布快照丢失时拒绝迁移。
 */
async function readResource(
  connection: Connection,
  table: 'automation_form' | 'automation_ruleset',
  sourceKey: string,
  lock: boolean,
): Promise<{ draft: ResourceRow | null; published: PublishedRow | null }> {
  let suffix = '';
  if (lock) suffix = ' FOR UPDATE';
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) id,source_key,name,description,revision,published_version,definition FROM ${table} WHERE source_key=?${suffix}`,
    [sourceKey],
  );
  requireMatch(rows.length <= 1, '资源来源键不唯一');
  if (!rows.length) return { draft: null, published: null };
  const draft = {
    ...rows[0],
    definition: jsonValue(rows[0].definition),
  } as ResourceRow;
  const [versions] = await connection.query<RowDataPacket[]>(
    `SELECT CAST(definition_id AS CHAR) definition_id,version,name,description,definition FROM ${table}_revision WHERE definition_id=? AND version=1${suffix}`,
    [draft.id],
  );
  requireMatch(versions.length === 1, '已有公用资源缺少首个发布版本');
  return {
    draft,
    published: {
      ...versions[0],
      definition: jsonValue(versions[0].definition),
    } as PublishedRow,
  };
}

/**
 * 读取唯一生效的媒体工作流及关联资源，锁定应用事务内所有将变化的现有记录。
 * @param connection - 保持大整数为字符串的专用 MySQL 连接。
 * @param lock - 是否为应用事务锁定记录。
 * @returns 可密封并保存为回滚依据的精确迁移前快照。
 * @throws 业务绑定、草稿或发布版本缺失时拒绝继续。
 */
async function readSnapshot(
  connection: Connection,
  lock: boolean,
): Promise<Snapshot> {
  let suffix = '';
  if (lock) suffix = ' FOR UPDATE';
  const [identity] = await connection.query<RowDataPacket[]>(
    'SELECT DATABASE() databaseName,@@server_uuid serverUuid',
  );
  const [bindings] = await connection.query<RowDataPacket[]>(
    `SELECT process_key,scope_id,process_version,CAST(workflow_id AS CHAR) workflow_id,workflow_version,revision FROM automation_workflow_business_binding WHERE process_key='media.governance' AND scope_id='business'${suffix}`,
  );
  requireMatch(
    bindings.length === 1 && bindings[0].process_version === 1,
    '需要唯一 media.governance@1 生效业务绑定',
  );
  const binding = bindings[0] as BindingRow;
  const [drafts] = await connection.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) id,source_key,name,description,revision,published_version,definition FROM automation_workflow WHERE id=?${suffix}`,
    [binding.workflow_id],
  );
  requireMatch(
    drafts.length === 1 &&
      drafts[0].published_version === binding.workflow_version,
    '业务绑定未指向当前发布版本',
  );
  const draft = {
    ...drafts[0],
    definition: jsonValue(drafts[0].definition),
  } as DefinitionRow;
  const [publishedRows] = await connection.query<RowDataPacket[]>(
    `SELECT CAST(definition_id AS CHAR) definition_id,version,name,description,definition FROM automation_workflow_revision WHERE definition_id=? AND version=?${suffix}`,
    [draft.id, draft.published_version],
  );
  requireMatch(publishedRows.length === 1, '当前发布快照丢失');
  const published = {
    ...publishedRows[0],
    definition: jsonValue(publishedRows[0].definition),
  } as PublishedRow;
  requireMatch(
    draft.name === published.name &&
      draft.description === published.description &&
      designResourceDigest(draft.definition) ===
        designResourceDigest(published.definition),
    '存在未发布草稿，不能覆盖编辑内容',
  );
  const form = await readResource(
    connection,
    'automation_form',
    MEDIA_FORM_SOURCE,
    lock,
  );
  const rule = await readResource(
    connection,
    'automation_ruleset',
    MEDIA_RULE_SOURCE,
    lock,
  );
  return {
    identity: {
      databaseName: String(identity[0].databaseName),
      serverUuid: String(identity[0].serverUuid),
    },
    draft,
    published,
    binding,
    form: form.draft,
    formPublished: form.published,
    rule: rule.draft,
    rulePublished: rule.published,
  };
}

/**
 * 复用公用资源时核对草稿和固定首版，管理员后续任何修改均不被迁移覆盖。
 * @param draft - 来源键找到的草稿，首次迁移时为空。
 * @param published - 固定首个发布版本。
 * @param name - 此迁移的公用资源名称。
 * @param definition - 已归一化的预期表单或规则。
 * @throws 已有资源的名称、状态、草稿或首版发生变化时拒绝写入。
 */
function checkResource(
  draft: ResourceRow | null,
  published: PublishedRow | null,
  name: string,
  definition: unknown,
): void {
  if (!draft) return;
  requireMatch(
    published &&
      draft.name === name &&
      draft.description === '' &&
      draft.revision === 1 &&
      draft.published_version === 1 &&
      published.name === name &&
      published.description === '' &&
      designResourceDigest(draft.definition) ===
        designResourceDigest(definition) &&
      designResourceDigest(published.definition) ===
        designResourceDigest(definition),
    '已有公用资源被修改，保留用户内容并停止转换',
  );
}

/**
 * 用真实业务契约和数据库固定脚本声明运行现有发布校验，不启动 Nest 或执行媒体脚本。
 * @param connection - 当前只读预演或应用事务连接。
 * @param definition - 待发布的新媒体定义。
 * @param references - 已验证的固定表单和规则版本。
 * @throws 脚本版本、源码摘要、依赖或映射不合法时拒绝发布。
 */
async function checkPublication(
  connection: Connection,
  definition: WorkflowBpmnDefinition,
  references: DesignResourcePlan['resources'],
): Promise<void> {
  const processes = new WorkflowProcessRegistry();
  processes.register(new MediaGovernanceWorkflow(undefined as never));
  const scripts = new WorkflowScriptRegistry();
  const parsed = await parseWorkflowBpmn(definition);
  const registered = new Set<string>();
  for (const node of Object.values(parsed.elements)) {
    const step = readBpmnStep(node);
    if (step?.kind !== 'business') continue;
    for (const call of step.scripts) {
      const key = `${call.key}@${call.version}`;
      if (registered.has(key)) continue;
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT sha256,target,declaration,source_text FROM automation_workflow_script WHERE script_key=? AND version=?',
        [call.key, call.version],
      );
      requireMatch(
        rows.length === 1 &&
          rows[0].sha256 === call.sha256 &&
          automationDigest(String(rows[0].source_text)) === call.sha256,
        '固定媒体脚本缺失或内容摘要漂移',
      );
      const declaration = jsonValue(rows[0].declaration);
      scripts.register({
        ...declaration,
        key: call.key,
        version: call.version,
        sha256: call.sha256,
        target: rows[0].target,
        path: resolve(
          'src/commands/automation-design-resources',
          `${call.key}.${declaration.runtime}`,
        ),
      });
      registered.add(key);
    }
  }
  const service = new WorkflowDefinitionService(
    {} as DataSource,
    {
      resolve: async (reference) => {
        requireMatch(
          isDeepStrictEqual(reference, references.rule),
          '规则引用不匹配',
        );
        return MEDIA_RULE;
      },
      evaluate: async () => {
        throw new Error('迁移校验不执行规则');
      },
    },
    {
      resolve: async (reference) => {
        requireMatch(
          isDeepStrictEqual(reference, references.form),
          '表单引用不匹配',
        );
        return MEDIA_FORM;
      },
      validate: async () => {
        throw new Error('迁移校验不提交表单');
      },
    },
    undefined,
    processes,
    scripts,
  );
  await service.checkForPublish(definition);
}

/**
 * 依据快照生成可核对计划，重复迁移保持原资源与工作流版本。
 * @param connection - 当前事务内的只读查询连接。
 * @param snapshot - 当前库、工作流和资源状态。
 * @param prior - 应用时已封存的预演计划，保证新资源身份不漂移。
 * @returns 完整目标封印、公用引用与转换定义。
 * @throws 草稿漂移、公用资源修改或发布校验失败时拒绝计划。
 */
async function createPlan(
  connection: Connection,
  snapshot: Snapshot,
  prior?: DesignResourcePlan,
): Promise<DesignResourcePlan> {
  checkResource(
    snapshot.form,
    snapshot.formPublished,
    MEDIA_FORM_NAME,
    MEDIA_FORM,
  );
  checkResource(
    snapshot.rule,
    snapshot.rulePublished,
    MEDIA_RULE_NAME,
    MEDIA_RULE,
  );
  const references = {
    form: {
      id: snapshot.form?.id || prior?.resources.form.id || createSnowflakeId(),
      version: 1,
    },
    rule: {
      id: snapshot.rule?.id || prior?.resources.rule.id || createSnowflakeId(),
      version: 1,
    },
  };
  let status: DesignResourcePlan['status'] = 'ready';
  let definition: WorkflowBpmnDefinition;
  if (await isExtractedMediaDefinition(snapshot.draft.definition, references)) {
    requireMatch(snapshot.form && snapshot.rule, '已抽离图的公用资源缺失');
    status = 'already-extracted';
    definition = snapshot.draft.definition;
  } else
    definition = await extractMediaDesignResources(
      snapshot.draft.definition,
      references,
    );
  await checkPublication(connection, definition, references);
  return {
    schemaVersion: 1,
    status,
    target: {
      ...snapshot.identity,
      workflowId: snapshot.draft.id,
      revision: snapshot.draft.revision,
      publishedVersion: snapshot.draft.published_version!,
      sourceDigest: designResourceDigest(snapshot.draft.definition),
      snapshotDigest: designResourceDigest(snapshot),
    },
    resources: references,
    definition,
    resultDigest: designResourceDigest(definition),
  };
}

/**
 * 在一致性只读事务中预演精确媒体转换，不创建资源、版本或业务绑定。
 * @param connection - 显式目标库的专用连接。
 * @returns 可保存并作为应用输入的封存计划。
 * @throws 未知结构、用户草稿或资源漂移时只读失败。
 */
export async function previewDesignResourceExtraction(
  connection: Connection,
): Promise<DesignResourcePlan> {
  await connection.query(
    'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
  );
  try {
    return await createPlan(connection, await readSnapshot(connection, false));
  } finally {
    await connection.rollback();
  }
}

/**
 * 插入来源唯一的独立资源及首个不可变发布版本，调用前必须完成全部冲突检查。
 * @param connection - 持有迁移锁的应用事务连接。
 * @param table - 白名单公用资源表。
 * @param reference - 预演冻结的资源身份。
 * @param sourceKey - 稳定来源键。
 * @param name - 有业务含义的资源名称。
 * @param definition - 已通过归一化的定义。
 */
async function insertResource(
  connection: Connection,
  table: 'automation_form' | 'automation_ruleset',
  reference: PublishedReference,
  sourceKey: string,
  name: string,
  definition: unknown,
): Promise<void> {
  await connection.query(
    `INSERT INTO ${table} (id,source_key,name,description,revision,published_version,definition) VALUES (?,?,?,'',1,1,?)`,
    [reference.id, sourceKey, name, JSON.stringify(definition)],
  );
  await connection.query(
    `INSERT INTO ${table}_revision (definition_id,version,name,description,definition) VALUES (?,1,?,'',?)`,
    [reference.id, name, JSON.stringify(definition)],
  );
}

/**
 * 绑定明确库身份和预演摘要后事务发布抽离版本，旧发布记录与实例完全保留。
 * @param connection - 使用字符串大整数的专用连接。
 * @param plan - 已审阅的只读预演计划。
 * @param options - 再次声明的库身份和绝对回滚快照目录。
 * @returns 本次是否写入、新版本和快照文件；重复应用不产生版本。
 * @throws 身份、完整快照、定义或事务写入失败时回滚全部数据库变化。
 */
export async function applyDesignResourceExtraction(
  connection: Connection,
  plan: DesignResourcePlan,
  options: {
    databaseName: string;
    serverUuid: string;
    backupDirectory: string;
  },
): Promise<{
  changed: boolean;
  workflowId: string;
  version: number;
  backupPath: string | null;
}> {
  requireMatch(
    plan.schemaVersion === 1 && isAbsolute(options.backupDirectory),
    '需要有效预演计划和绝对回滚目录',
  );
  requireMatch(
    options.databaseName === plan.target.databaseName &&
      options.serverUuid === plan.target.serverUuid,
    '应用声明与预演数据库身份不一致',
  );
  const locked = await withMysqlConnectionLock(
    connection,
    'kt:automation-design-resources:media-v1',
    0,
    async () => {
      await connection.beginTransaction();
      try {
        const snapshot = await readSnapshot(connection, true);
        requireMatch(
          isDeepStrictEqual(snapshot.identity, {
            databaseName: options.databaseName,
            serverUuid: options.serverUuid,
          }),
          '实际数据库身份不匹配',
        );
        const current = await createPlan(connection, snapshot, plan);
        requireMatch(
          isDeepStrictEqual(current, plan),
          '工作流身份、版本、完整源摘要或预演结果已变化，请重新预演',
        );
        if (current.status === 'already-extracted') {
          await connection.rollback();
          return {
            changed: false,
            workflowId: snapshot.draft.id,
            version: snapshot.draft.published_version!,
            backupPath: null,
          };
        }
        await mkdir(options.backupDirectory, { recursive: true });
        const backupPath = join(
          options.backupDirectory,
          `media-design-resources-${randomUUID()}.json`,
        );
        await writeFile(
          backupPath,
          JSON.stringify(
            {
              schemaVersion: 1,
              snapshot,
              plan,
              rollback:
                '恢复前核对新增版本尚无实例；按快照还原草稿与绑定，保留已产生实例引用的全部发布版本。',
            },
            null,
            2,
          ),
          { encoding: 'utf8', flag: 'wx', mode: 0o600 },
        );
        if (!snapshot.form)
          await insertResource(
            connection,
            'automation_form',
            plan.resources.form,
            MEDIA_FORM_SOURCE,
            MEDIA_FORM_NAME,
            MEDIA_FORM,
          );
        if (!snapshot.rule)
          await insertResource(
            connection,
            'automation_ruleset',
            plan.resources.rule,
            MEDIA_RULE_SOURCE,
            MEDIA_RULE_NAME,
            MEDIA_RULE,
          );
        const version = snapshot.draft.published_version! + 1;
        await connection.query(
          'INSERT INTO automation_workflow_revision (definition_id,version,name,description,definition) VALUES (?,?,?,?,?)',
          [
            snapshot.draft.id,
            version,
            snapshot.draft.name,
            snapshot.draft.description,
            JSON.stringify(plan.definition),
          ],
        );
        const [updated] = await connection.query<ResultSetHeader>(
          'UPDATE automation_workflow SET definition=?,published_version=?,revision=revision+2 WHERE id=? AND revision=? AND published_version=?',
          [
            JSON.stringify(plan.definition),
            version,
            snapshot.draft.id,
            snapshot.draft.revision,
            snapshot.draft.published_version,
          ],
        );
        requireMatch(updated.affectedRows === 1, '工作流草稿 CAS 更新失败');
        const [bound] = await connection.query<ResultSetHeader>(
          "UPDATE automation_workflow_business_binding SET workflow_version=?,revision=revision+1 WHERE process_key='media.governance' AND scope_id='business' AND process_version=1 AND workflow_id=? AND workflow_version=? AND revision=?",
          [
            version,
            snapshot.binding.workflow_id,
            snapshot.binding.workflow_version,
            snapshot.binding.revision,
          ],
        );
        requireMatch(bound.affectedRows === 1, '业务绑定 CAS 发布失败');
        await connection.commit();
        return {
          changed: true,
          workflowId: snapshot.draft.id,
          version,
          backupPath,
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    },
  );
  requireMatch(locked.acquired, '其他拥有者正在抽离媒体资源');
  return locked.value;
}
