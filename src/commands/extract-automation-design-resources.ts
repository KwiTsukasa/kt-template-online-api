import { createConnection } from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { closeMysqlLockConnection } from '../common/locks/database-lock';
import {
  applyDesignResourceExtraction,
  previewDesignResourceExtraction,
  type DesignResourcePlan,
} from './automation-design-resources/migration';

/**
 * 要求显式环境连接参数，避免命令静默回落到生产或默认数据库。
 * @param key - 所需环境变量名。
 * @returns 非空配置值。
 * @throws 参数缺失时在建立连接前停止命令。
 */
function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`公用设计资源抽离缺少 ${key}`);
  return value;
}

/**
 * 提供默认只读预演和显式应用入口，应用只能使用已审阅计划与同一数据库身份。
 * @throws 参数、身份或转换失败时返回非零退出码，数据库事务全部回滚。
 */
async function main(): Promise<void> {
  const argumentsSet = new Set(process.argv.slice(2));
  if (
    [...argumentsSet].some(
      (value) => !['--apply', '--preview'].includes(value),
    ) ||
    (argumentsSet.has('--apply') && argumentsSet.has('--preview'))
  )
    throw new Error(
      '仅支持 --preview（默认）或 --apply；连接与封存路径通过环境变量明确声明',
    );
  const applying = argumentsSet.has('--apply');
  let plan: DesignResourcePlan | undefined;
  let options:
    | { databaseName: string; serverUuid: string; backupDirectory: string }
    | undefined;
  if (applying) {
    plan = JSON.parse(
      await readFile(required('AUTOMATION_DESIGN_PLAN_PATH'), 'utf8'),
    );
    options = {
      databaseName: required('AUTOMATION_DESIGN_EXPECTED_DATABASE'),
      serverUuid: required('AUTOMATION_DESIGN_EXPECTED_SERVER_UUID'),
      backupDirectory: required('AUTOMATION_DESIGN_BACKUP_DIRECTORY'),
    };
  }
  const port = Number(required('DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('数据库端口不合法');
  const connection = await createConnection({
    host: required('DB_HOST'),
    port,
    database: required('DB_DATABASE'),
    user: required('DB_USERNAME'),
    password: required('DB_PASSWORD'),
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: 10000,
  });
  try {
    if (plan && options)
      process.stdout.write(
        JSON.stringify(
          await applyDesignResourceExtraction(connection, plan, options),
          null,
          2,
        ) + '\n',
      );
    else
      process.stdout.write(
        JSON.stringify(
          await previewDesignResourceExtraction(connection),
          null,
          2,
        ) + '\n',
      );
  } finally {
    await closeMysqlLockConnection(connection);
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    let message = '未知转换错误';
    if (error instanceof Error) message = error.message;
    process.stderr.write(`公用设计资源抽离失败：${message}\n`);
    process.exitCode = 1;
  });
}
