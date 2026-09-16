import { isDeepStrictEqual } from 'node:util';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  readMigrationCheckpoint,
  saveMigrationCheckpoint,
} from './queue-snapshot';

const rootId = '2041700000000300000';
const resourcesId = '2041700000000300800';
const navigation = [
  {
    id: '2041700000000300400',
    name: 'AutomationWorkflows',
    path: '/automation/workflows',
    permission: 'Automation:Workflow:List',
    title: '工作流管理',
    sort: 0,
  },
  {
    id: '2041700000000300600',
    name: 'AutomationSchedules',
    path: '/automation/schedules',
    permission: 'Automation:Schedule:List',
    title: '定时任务',
    sort: 1,
  },
  {
    id: '2041700000000300300',
    name: 'AutomationForms',
    path: '/automation/forms',
    permission: 'Automation:Form:List',
    title: '表单',
    sort: 0,
    parent: resourcesId,
  },
  {
    id: '2041700000000300200',
    name: 'AutomationRules',
    path: '/automation/rules',
    permission: 'Automation:Rule:List',
    title: '规则',
    sort: 1,
    parent: resourcesId,
  },
  {
    id: '2041700000000300500',
    name: 'AutomationTasks',
    path: '/automation/tasks',
    permission: 'Automation:Task:List',
    title: '执行动作',
    sort: 3,
    hidden: true,
  },
  {
    id: '2041700000000300100',
    name: 'AutomationTriggers',
    path: '/automation/triggers',
    permission: 'Automation:Trigger:List',
    title: '触发条件',
    sort: 4,
    hidden: true,
  },
  {
    id: '2041700000000300700',
    name: 'AutomationExecutions',
    path: '/automation/executions',
    permission: 'Automation:Monitor:List',
    title: '运行记录',
    sort: 5,
    hidden: true,
  },
];
const ids = [...navigation.map((item) => item.id), resourcesId];

/**
 * 读取本次导航调整涉及的精确菜单身份及权限关联，以便检测并发改动和恢复原始布局。
 * @param connection - 绑定当前数据库事务的连接。
 * @returns 不含时间戳的菜单与角色关联快照。
 */
async function navigationSnapshot(connection: Connection) {
  const placeholders = ids.map(() => '?').join(',');
  const [menus] = await connection.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) id,CAST(pid AS CHAR) pid,name,path,component,redirect,auth_code,type,meta,status,sort,is_deleted FROM admin_menu WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`,
    ids,
  );
  const [grants] = await connection.query<RowDataPacket[]>(
    `SELECT CAST(role_id AS CHAR) role_id,CAST(menu_id AS CHAR) menu_id FROM admin_role_menu WHERE menu_id IN (${placeholders}) ORDER BY role_id,menu_id`,
    ids,
  );
  return { menus, grants };
}

/**
 * 将自动化导航收敛为工作流、定时任务与设计资源，保留原有接口权限和全部深链接。
 * @param connection - 外层事务连接，调用方必须先建立迁移检查点表。
 * @returns 迁移状态及独立可恢复的导航备份键。
 * @throws 菜单身份冲突或已回滚状态尚未重新规划时拒绝迁移。
 */
export async function migrateAutomationNavigation(connection: Connection) {
  const current = await navigationSnapshot(connection);
  const after = await readMigrationCheckpoint(
    connection,
    'navigation-v2:after',
  );
  if (after) {
    if (await readMigrationCheckpoint(connection, 'navigation-v2:restored'))
      throw new Error('此导航迁移已回滚，重新应用前必须建立新的迁移版本');
    for (const item of navigation) {
      const actual = current.menus.find((row) => row.id === item.id);
      if (
        !actual ||
        actual.name !== item.name ||
        actual.path !== item.path ||
        actual.auth_code !== item.permission
      )
        throw new Error(`自动化导航身份不一致：${item.name}`);
    }
    const resources = current.menus.find((row) => row.id === resourcesId);
    if (
      !resources ||
      resources.name !== 'AutomationResources' ||
      resources.path !== '/automation/resources'
    )
      throw new Error('设计资源菜单身份已改变');
    return {
      repeated: true,
      backup: 'navigation-v2:before',
      preservedLaterChanges: !isDeepStrictEqual(current, after.payload),
    };
  }
  for (const item of navigation) {
    const actual = current.menus.find((row) => row.id === item.id);
    if (
      !actual ||
      actual.name !== item.name ||
      actual.path !== item.path ||
      actual.auth_code !== item.permission
    )
      throw new Error(`自动化导航身份不一致：${item.name}`);
    if (actual.is_deleted || actual.status !== 1)
      throw new Error(`自动化导航入口尚未启用：${item.name}`);
  }
  if (current.menus.some((row) => row.id === resourcesId))
    throw new Error('设计资源菜单身份已被占用');
  await saveMigrationCheckpoint(
    connection,
    'navigation-v2:before',
    current,
    'sealed',
  );
  await connection.query(
    `INSERT INTO admin_menu(id,pid,name,path,component,redirect,auth_code,type,meta,status,sort) VALUES(?,?,'AutomationResources','/automation/resources',NULL,NULL,NULL,'catalog',?,1,2)`,
    [
      resourcesId,
      rootId,
      JSON.stringify({ title: '设计资源', icon: 'lucide:library' }),
    ],
  );
  for (const item of navigation) {
    const actual = current.menus.find((row) => row.id === item.id);
    let meta = actual.meta;
    if (typeof meta === 'string') meta = JSON.parse(meta);
    meta = { ...meta, title: item.title, hideInMenu: Boolean(item.hidden) };
    await connection.query(
      'UPDATE admin_menu SET pid=?,meta=?,sort=? WHERE id=? AND name=?',
      [
        item.parent || rootId,
        JSON.stringify(meta),
        item.sort,
        item.id,
        item.name,
      ],
    );
  }
  const result = await navigationSnapshot(connection);
  if (!isDeepStrictEqual(result.grants, current.grants))
    throw new Error('导航迁移不允许修改角色权限');
  await saveMigrationCheckpoint(
    connection,
    'navigation-v2:after',
    result,
    'sealed',
  );
  return {
    repeated: false,
    backup: 'navigation-v2:before',
    ordinaryRoleGrantsChanged: false,
  };
}

/**
 * 在菜单及权限均未被后续修改的情况下恢复原导航，不触碰任何业务定义、运行或队列。
 * @param connection - 调用方提供的事务连接。
 * @returns 是否实际恢复过导航。
 * @throws 快照不完整、菜单漂移或角色关联变化时拒绝恢复。
 */
export async function restoreAutomationNavigation(connection: Connection) {
  const before = await readMigrationCheckpoint<
    Awaited<ReturnType<typeof navigationSnapshot>>
  >(connection, 'navigation-v2:before');
  const after = await readMigrationCheckpoint(
    connection,
    'navigation-v2:after',
  );
  if (!before && !after) return false;
  if (!before || !after) throw new Error('自动化导航快照不完整');
  const current = await navigationSnapshot(connection);
  if (isDeepStrictEqual(current, before.payload)) return false;
  if (!isDeepStrictEqual(current, after.payload))
    throw new Error('导航或角色权限已改变，拒绝覆盖');
  for (const row of before.payload.menus) {
    let meta = row.meta;
    if (typeof meta !== 'string') meta = JSON.stringify(meta);
    await connection.query(
      'UPDATE admin_menu SET pid=?,meta=?,sort=? WHERE id=? AND name=?',
      [row.pid, meta, row.sort, row.id, row.name],
    );
  }
  await connection.query('DELETE FROM admin_menu WHERE id=? AND name=?', [
    resourcesId,
    'AutomationResources',
  ]);
  await saveMigrationCheckpoint(
    connection,
    'navigation-v2:restored',
    await navigationSnapshot(connection),
    'sealed',
  );
  return true;
}
