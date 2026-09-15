import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  readMigrationCheckpoint,
  saveMigrationCheckpoint,
} from './queue-snapshot';

const LEGACY_MENU_IDS = [
  '2041700000000100411',
  '2041700000000120451',
  '2041700000000120452',
  '2041700000000120453',
  '2041700000000120454',
  '2041700000000120455',
];

/**
 * 从版本化菜单 SQL 提取身份并验证唯一性，避免仅按前缀覆盖已有业务菜单。
 * @param source - 当前发布包中的自动化菜单种子。
 * @returns 精确的新菜单身份列表。
 * @throws 种子数量、格式或身份不符合模块契约时拒绝迁移。
 */
function menuIds(source: string): string[] {
  const ids = [...source.matchAll(/^\((\d+),/gm)].map((match) => match[1]);
  if (
    ids.length !== 50 ||
    new Set(ids).size !== 50 ||
    ids.some((id) => !id.startsWith('204170000000030'))
  )
    throw new Error('自动化菜单身份清单不符合五十项契约');
  return ids;
}

/**
 * 备份精确菜单及关联，新增七模块菜单并退役旧巨型表单入口；普通角色不被自动扩大授权。
 * @param connection - 外层事务连接，迁移检查点表已创建。
 * @param sqlRoot - 发布包内 SQL 目录。
 * @returns 受影响菜单身份与只读备份信息。
 * @throws 任一系统 ID 被其他菜单占用时拒绝整批修改。
 */
export async function migrateAutomationMenus(
  connection: Connection,
  sqlRoot: string,
) {
  const source = readFileSync(join(sqlRoot, 'automation-menus-v1.sql'), 'utf8');
  const ids = menuIds(source);
  const allIds = [...ids, ...LEGACY_MENU_IDS];
  const placeholders = allIds.map(() => '?').join(',');
  await connection.query(
    'CREATE TEMPORARY TABLE _kt_automation_expected_menu LIKE admin_menu',
  );
  try {
    await connection.query(
      source.replace(
        'INSERT INTO admin_menu ',
        'INSERT INTO _kt_automation_expected_menu ',
      ),
    );
    const [conflicts] = await connection.query<RowDataPacket[]>(
      'SELECT CAST(actual.id AS CHAR) id FROM admin_menu actual JOIN _kt_automation_expected_menu expected ON expected.id=actual.id WHERE actual.name<>expected.name',
    );
    if (conflicts.length)
      throw new Error(
        `自动化菜单 ID 已被占用：${conflicts.map((row) => row.id).join(',')}`,
      );
    const [legacy] = await connection.query<RowDataPacket[]>(
      `SELECT CAST(id AS CHAR) id,auth_code FROM admin_menu WHERE id IN (${LEGACY_MENU_IDS.map(() => '?').join(',')}) FOR UPDATE`,
      LEGACY_MENU_IDS,
    );
    for (const row of legacy) {
      if (
        !/^(PluginPlatform|TaskScheduling):Task:(List|UpdateCron|Enable|Disable|Run|RunLog)$/.test(
          String(row.auth_code),
        )
      )
        throw new Error(`旧任务菜单身份被其他入口使用：${row.id}`);
    }
    const existing = await readMigrationCheckpoint(connection, 'menus:before');
    if (!existing) {
      const [menus] = await connection.query<RowDataPacket[]>(
        `SELECT *,CAST(create_time AS CHAR) create_time,CAST(update_time AS CHAR) update_time FROM admin_menu WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`,
        allIds,
      );
      const [grants] = await connection.query<RowDataPacket[]>(
        `SELECT CAST(role_id AS CHAR) role_id,CAST(menu_id AS CHAR) menu_id FROM admin_role_menu WHERE menu_id IN (${placeholders})`,
        allIds,
      );
      await saveMigrationCheckpoint(
        connection,
        'menus:before',
        { menus, grants, managedIds: allIds },
        'sealed',
      );
    }
    await connection.query(source);
    await connection.query(
      `UPDATE admin_menu SET status=0,is_deleted=1 WHERE id IN (${LEGACY_MENU_IDS.map(() => '?').join(',')})`,
      LEGACY_MENU_IDS,
    );
    await connection.query(`INSERT IGNORE INTO admin_role_menu(role_id,menu_id)
      SELECT role.id,menu.id FROM admin_role role CROSS JOIN _kt_automation_expected_menu menu
      WHERE role.role_code='super' AND role.status=1 AND role.is_deleted=0`);
    const [count] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) count FROM admin_menu actual JOIN _kt_automation_expected_menu expected ON expected.id=actual.id WHERE actual.name=expected.name AND actual.path<=>expected.path AND actual.component<=>expected.component AND actual.auth_code<=>expected.auth_code AND actual.status=1 AND actual.is_deleted=0',
    );
    if (Number(count[0].count) !== ids.length)
      throw new Error('自动化菜单路径、组件或权限验证失败');
    if (!(await readMigrationCheckpoint(connection, 'menus:after'))) {
      await saveMigrationCheckpoint(connection, 'menus:after', await readManagedMenus(connection, allIds), 'sealed');
    }
    return {
      newMenuCount: ids.length,
      retiredLegacyCount: legacy.length,
      backup: 'menus:before',
      ordinaryRoleGrantsChanged: false,
    };
  } finally {
    await connection.query('DROP TEMPORARY TABLE _kt_automation_expected_menu');
  }
}

/**
 * 读取精确菜单范围的语义配置和角色关联，为无使用窗口内的回滚核对提供依据。
 * @param connection - 当前迁移连接。
 * @param ids - 版本化迁移管理的完整菜单身份。
 * @returns 排序稳定的菜单字段及授权关联，不依赖时间戳判断修改。
 */
export async function readManagedMenus(connection: Connection, ids: string[]) {
  const placeholders = ids.map(() => '?').join(',');
  const [menus] = await connection.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) id,CAST(pid AS CHAR) pid,name,path,component,redirect,auth_code,type,meta,status,sort,is_deleted FROM admin_menu WHERE id IN (${placeholders}) ORDER BY id`, ids);
  const [grants] = await connection.query<RowDataPacket[]>(`SELECT CAST(role_id AS CHAR) role_id,CAST(menu_id AS CHAR) menu_id FROM admin_role_menu WHERE menu_id IN (${placeholders}) ORDER BY role_id,menu_id`, ids);
  return { menus, grants };
}
